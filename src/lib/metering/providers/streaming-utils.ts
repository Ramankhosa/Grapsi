import type { LLMRequest, LLMResponse } from '../types'

export function readStreamTokenNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed)
    }
  }
  return 0
}

export function estimateTokensFromText(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

function findEventBoundary(value: string): { index: number; length: number } {
  const lf = value.indexOf('\n\n')
  const crlf = value.indexOf('\r\n\r\n')
  if (lf < 0 && crlf < 0) return { index: -1, length: 0 }
  if (lf < 0) return { index: crlf, length: 4 }
  if (crlf < 0) return { index: lf, length: 2 }
  return lf < crlf ? { index: lf, length: 2 } : { index: crlf, length: 4 }
}

export function normalizeStreamDelta(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''

  return value
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object') {
        const record = part as Record<string, unknown>
        if (typeof record.text === 'string') return record.text
        if (typeof record.content === 'string') return record.content
      }
      return ''
    })
    .join('')
}

export function extractThoughtTokensFromUsage(usage: Record<string, unknown> | undefined): number {
  if (!usage) return 0
  const completionDetails =
    usage.completion_tokens_details && typeof usage.completion_tokens_details === 'object'
      ? (usage.completion_tokens_details as Record<string, unknown>)
      : {}
  const outputDetails =
    usage.output_tokens_details && typeof usage.output_tokens_details === 'object'
      ? (usage.output_tokens_details as Record<string, unknown>)
      : {}

  return readStreamTokenNumber(
    usage.reasoning_tokens ??
    usage.reasoningTokens ??
    usage.thinking_tokens ??
    usage.thinkingTokens ??
    usage.thought_tokens ??
    usage.thoughtTokens ??
    completionDetails.reasoning_tokens ??
    completionDetails.thinking_tokens ??
    outputDetails.reasoning_tokens ??
    outputDetails.thinking_tokens
  )
}

export async function emitLLMStreamToken(
  request: LLMRequest,
  delta: string,
  output: string,
  metadata: {
    provider: string
    modelClass: string
    model: string
  }
): Promise<void> {
  if (!delta) return
  await request.stream?.onToken?.({
    delta,
    output,
    provider: metadata.provider,
    modelClass: metadata.modelClass,
    model: metadata.model
  })
}

export async function collectOpenAICompatibleChatCompletionStream(args: {
  client: any
  createParams: Record<string, any>
  request: LLMRequest
  providerName: string
  modelClass: string
  actualModel: string
  startedAt: number
  metadata?: Record<string, unknown>
}): Promise<LLMResponse> {
  const stream = await args.client.chat.completions.create({
    ...args.createParams,
    stream: true
  })

  let output = ''
  let finishReason: unknown
  let usage: Record<string, unknown> | undefined

  for await (const chunk of stream as AsyncIterable<Record<string, any>>) {
    if (chunk?.usage && typeof chunk.usage === 'object') {
      usage = chunk.usage as Record<string, unknown>
    }

    const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined
    if (choice?.finish_reason) {
      finishReason = choice.finish_reason
    }

    const delta = normalizeStreamDelta(
      choice?.delta?.content ??
      choice?.message?.content ??
      choice?.text
    )

    if (delta) {
      output += delta
      await emitLLMStreamToken(args.request, delta, output, {
        provider: args.providerName,
        modelClass: args.modelClass,
        model: args.actualModel
      })
    }
  }

  const inputTokens = readStreamTokenNumber(usage?.prompt_tokens) || args.request.inputTokens || 0
  const outputTokens =
    readStreamTokenNumber(usage?.completion_tokens) ||
    readStreamTokenNumber(usage?.output_tokens) ||
    estimateTokensFromText(output)
  const thoughtTokens = extractThoughtTokensFromUsage(usage)
  const totalTokens = readStreamTokenNumber(usage?.total_tokens) || (inputTokens + outputTokens + thoughtTokens)
  const latency = Date.now() - args.startedAt

  return {
    output,
    outputTokens,
    modelClass: args.modelClass,
    metadata: {
      provider: args.providerName,
      model: args.actualModel,
      inputTokens,
      outputTokens,
      thoughtTokens,
      totalTokens,
      latencyMs: latency,
      finishReason,
      usage,
      streamed: true,
      ...args.metadata
    }
  }
}

export async function collectOpenAICompatibleSSEStream(args: {
  response: Response
  request: LLMRequest
  providerName: string
  modelClass: string
  actualModel: string
  startedAt: number
  metadata?: Record<string, unknown>
}): Promise<LLMResponse> {
  const reader = args.response.body?.getReader()
  if (!reader) {
    throw new Error('Streaming response body is unavailable')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let output = ''
  let finishReason: unknown
  let usage: Record<string, unknown> | undefined

  const processDataPayload = async (payload: string): Promise<boolean> => {
    const data = payload.trim()
    if (!data) return false
    if (data === '[DONE]') return true

    const parsed = JSON.parse(data) as Record<string, any>
    if (parsed?.usage && typeof parsed.usage === 'object') {
      usage = parsed.usage as Record<string, unknown>
    }

    const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : undefined
    if (choice?.finish_reason) {
      finishReason = choice.finish_reason
    }

    const delta = normalizeStreamDelta(
      choice?.delta?.content ??
      choice?.message?.content ??
      choice?.text
    )

    if (delta) {
      output += delta
      await emitLLMStreamToken(args.request, delta, output, {
        provider: args.providerName,
        modelClass: args.modelClass,
        model: args.actualModel
      })
    }

    return false
  }

  const processEventBlock = async (block: string): Promise<boolean> => {
    const lines = block.split(/\r?\n/)
    let isDone = false
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const done = await processDataPayload(line.slice(5))
      isDone = isDone || done
    }
    return isDone
  }

  let doneFromPayload = false
  while (!doneFromPayload) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    let boundary = findEventBoundary(buffer)
    while (boundary.index >= 0) {
      const block = buffer.slice(0, boundary.index)
      buffer = buffer.slice(boundary.index + boundary.length)
      doneFromPayload = await processEventBlock(block)
      if (doneFromPayload) break
      boundary = findEventBoundary(buffer)
    }
  }

  const trailing = `${buffer}${decoder.decode()}`
  if (!doneFromPayload && trailing.trim()) {
    await processEventBlock(trailing)
  }

  const inputTokens = readStreamTokenNumber(usage?.prompt_tokens) || args.request.inputTokens || 0
  const outputTokens =
    readStreamTokenNumber(usage?.completion_tokens) ||
    readStreamTokenNumber(usage?.output_tokens) ||
    estimateTokensFromText(output)
  const thoughtTokens = extractThoughtTokensFromUsage(usage)
  const totalTokens = readStreamTokenNumber(usage?.total_tokens) || (inputTokens + outputTokens + thoughtTokens)
  const latency = Date.now() - args.startedAt

  return {
    output,
    outputTokens,
    modelClass: args.modelClass,
    metadata: {
      provider: args.providerName,
      model: args.actualModel,
      inputTokens,
      outputTokens,
      thoughtTokens,
      totalTokens,
      latencyMs: latency,
      finishReason,
      usage,
      streamed: true,
      ...args.metadata
    }
  }
}
