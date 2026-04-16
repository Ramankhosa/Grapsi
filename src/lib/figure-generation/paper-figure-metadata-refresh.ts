import { prisma } from '@/lib/prisma'

import { inferPaperFigureMetadataFromStoredImage, type PaperFigureInferenceMeta } from './paper-figure-metadata'
import {
  asPaperFigureMeta,
  getPaperFigureCaption,
  getPaperFigureCaptionSeed,
  getPaperFigureStoredImagePath,
} from './paper-figure-record'

export async function refreshStoredPaperFigureMetadata(params: {
  requestHeaders: Record<string, string>
  sessionId: string
  figureId: string
  fallbackTitle?: string
  fallbackPrompt?: string
  fallbackCategory?: string
  fallbackFigureType?: string
  overrideSuggestionMeta?: Record<string, unknown> | null
}): Promise<PaperFigureInferenceMeta | null> {
  const figure = await prisma.figurePlan.findFirst({
    where: { id: params.figureId, sessionId: params.sessionId }
  })

  if (!figure) return null

  const nodes = asPaperFigureMeta(figure.nodes)
  const storedImagePath = getPaperFigureStoredImagePath(nodes)
  const nextNodes = { ...nodes }

  if (!storedImagePath) {
    await prisma.figurePlan.update({
      where: { id: figure.id },
      data: {
        nodes: {
          ...nextNodes,
          inferredImageMeta: null
        } as any
      }
    })
    return null
  }

  const effectiveSuggestionMeta = params.overrideSuggestionMeta
    || (nodes.suggestionMeta && typeof nodes.suggestionMeta === 'object'
      ? nodes.suggestionMeta as Record<string, unknown>
      : null)
  const currentCaption = getPaperFigureCaption(nextNodes, figure.description || '')
    || getPaperFigureCaptionSeed({
      suggestionMeta: effectiveSuggestionMeta,
      inferredImageMeta: nextNodes.inferredImageMeta || null
    })

  const inferredImageMeta = await inferPaperFigureMetadataFromStoredImage({
    requestHeaders: params.requestHeaders,
    imagePath: storedImagePath,
    title: figure.title || params.fallbackTitle || `Figure ${figure.figureNo}`,
    caption: currentCaption || null,
    category: String(nodes.category || params.fallbackCategory || 'ILLUSTRATED_FIGURE'),
    figureType: String(nodes.figureType || params.fallbackFigureType || 'sketch'),
    suggestionMeta: effectiveSuggestionMeta
  })

  const nextCaption = currentCaption
    || inferredImageMeta?.summary
    || getPaperFigureCaptionSeed({
      suggestionMeta: effectiveSuggestionMeta,
      inferredImageMeta: inferredImageMeta ?? null
    })

  await prisma.figurePlan.update({
    where: { id: figure.id },
    data: {
      ...(nextCaption ? { description: nextCaption } : {}),
      nodes: {
        ...nextNodes,
        suggestionMeta: effectiveSuggestionMeta,
        caption: nextCaption || nextNodes.caption || '',
        generationPrompt: (typeof nextNodes.generationPrompt === 'string' && nextNodes.generationPrompt.trim())
          ? nextNodes.generationPrompt
          : params.fallbackPrompt || undefined,
        inferredImageMeta: inferredImageMeta ?? null
      } as any
    }
  })

  return inferredImageMeta
}

export function scheduleStoredPaperFigureMetadataRefresh(
  params: Parameters<typeof refreshStoredPaperFigureMetadata>[0],
  logLabel: string = 'PaperFigureMetadata'
) {
  setTimeout(() => {
    void refreshStoredPaperFigureMetadata(params).catch((error) => {
      console.warn(`[${logLabel}] Background metadata refresh failed:`, error)
    })
  }, 0)
}
