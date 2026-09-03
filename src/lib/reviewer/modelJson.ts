/**
 * Parsing the reviewer models' JSON replies.
 *
 * Every reviewer call asks for a large JSON object — a section review carries
 * fourteen keys, a panel report eleven, and a revision review has to account
 * for every remark the previous draft collected. The parsing that guarded them
 * was two regexes and a bare `JSON.parse`, which throws on all of the ordinary
 * ways a model ends a long answer: a sentence before the object, an uppercase
 * or unterminated code fence, a trailing comma, and — the expensive one — a
 * reply that ran into the stage's output ceiling and simply stops mid-array.
 * The user then saw "the reviewer model returned an invalid review", and the
 * only thing they could do was press the button again and pay for the whole
 * call a second time.
 *
 * Revisions hit this hardest: `addressed_previous_points` asks for one entry
 * per earlier weakness and suggestion (up to sixteen, each with evidence) on
 * top of everything a first review returns, so a revision's reply is the
 * longest one the reviewer ever produces and the likeliest to be cut short.
 *
 * A cut-off object is not unrecoverable — everything before the cut is intact
 * JSON. `repairTruncatedJson` finds the last point at which the text was a
 * complete value and closes the structure there, so a report that lost two of
 * its eight priority actions is still a report rather than a paid failure.
 */

export class ReviewerModelJsonError extends Error {
  /** The reply ended mid-structure — the model hit its output ceiling. */
  truncated: boolean
  /** The tail of what came back, so a caller can log it without flooding. */
  sample: string

  constructor(message: string, options: { truncated: boolean; sample?: string }) {
    super(message)
    this.name = 'ReviewerModelJsonError'
    this.truncated = options.truncated
    this.sample = options.sample || ''
  }
}

export interface ReviewerModelJsonResult<T = any> {
  value: T
  /** True when the object had to be closed off — some content was lost. */
  repaired: boolean
}

/** Drop a markdown code fence, closed or not, whatever its casing. */
function stripFence(raw: string): string {
  const text = raw.trim()
  const closed = text.match(/```[ \t]*(?:json|jsonc)?[ \t]*\r?\n?([\s\S]*?)```/i)
  if (closed) return closed[1].trim()

  // An unterminated fence means the reply was cut off inside it; everything
  // after the opening marker is still the object we want.
  const open = text.match(/```[ \t]*(?:json|jsonc)?[ \t]*\r?\n?([\s\S]*)$/i)
  if (open) return open[1].trim()

  return text
}

/** Where the JSON value starts in a reply that may open with prose. */
function firstOpenerIndex(text: string): number {
  const firstObject = text.indexOf('{')
  const firstArray = text.indexOf('[')
  if (firstObject < 0) return firstArray
  if (firstArray < 0) return firstObject
  return Math.min(firstObject, firstArray)
}

/** The outermost JSON value in a reply that may be wrapped in prose. */
function sliceToOutermostValue(text: string): string {
  const start = firstOpenerIndex(text)
  if (start < 0) return text

  const closer = text[start] === '{' ? '}' : ']'
  const end = text.lastIndexOf(closer)
  return end > start ? text.slice(start, end + 1) : text.slice(start)
}

/**
 * Everything from the first opening bracket onwards.
 *
 * Repair has to see the whole tail: trimming to the last `}` would throw away
 * every key written after the last completed nested object, which on a
 * truncated reply is most of what survived.
 */
function sliceFromOpener(text: string): string {
  const start = firstOpenerIndex(text)
  return start < 0 ? text : text.slice(start)
}

/** Trailing commas before a closing bracket — legal for a model, not for JSON. */
function dropTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, '$1')
}

/**
 * Close off a reply that stopped mid-structure.
 *
 * Walks the text tracking string state and bracket depth, remembering the last
 * position at which the document was a complete value — after `{`, `[`, `}` or
 * `]`, or immediately before a comma. Cutting there and closing the brackets
 * that were open at that moment yields valid JSON holding everything the model
 * finished saying. Returns null when nothing was salvageable.
 */
export function repairTruncatedJson(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null

  const stack: string[] = []
  let inString = false
  let escaped = false
  let cutIndex = -1
  let cutStack: string[] = []

  const markCut = (index: number) => {
    cutIndex = index
    cutStack = [...stack]
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']')
      // An empty container is itself a complete value.
      markCut(i + 1)
    } else if (char === '}' || char === ']') {
      stack.pop()
      markCut(i + 1)
    } else if (char === ',') {
      // Everything before a comma is a finished sequence of values.
      markCut(i)
    }
  }

  if (cutIndex < 0) return null

  const closers = [...cutStack].reverse().join('')
  const candidate = `${text.slice(0, cutIndex)}${closers}`
  try {
    JSON.parse(candidate)
    return candidate
  } catch {
    return null
  }
}

/** Unbalanced brackets, or an unterminated string, mean the reply was cut off. */
export function looksTruncated(text: string): boolean {
  let depth = 0
  let inString = false
  let escaped = false

  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') depth--
  }

  return inString || depth > 0
}

/**
 * Parse a reviewer model's reply, recovering from the usual damage.
 *
 * Throws `ReviewerModelJsonError` only when nothing usable came back;
 * `truncated` says whether the reply was cut short, which is what a caller
 * needs in order to decide between re-asking and giving up.
 */
export function parseReviewerModelJson<T = any>(raw: unknown): ReviewerModelJsonResult<T> {
  const text = typeof raw === 'string' ? raw : ''
  if (!text.trim()) {
    throw new ReviewerModelJsonError('The reviewer model returned an empty reply.', {
      truncated: false,
      sample: '',
    })
  }

  const unfenced = stripFence(text)
  const sliced = sliceToOutermostValue(unfenced)

  for (const candidate of unfenced === sliced ? [unfenced] : [unfenced, sliced]) {
    try {
      return { value: JSON.parse(candidate) as T, repaired: false }
    } catch {
      /* try the same text with trailing commas removed */
    }
    try {
      return { value: JSON.parse(dropTrailingCommas(candidate)) as T, repaired: false }
    } catch {
      /* fall through to the next shape, then to repair */
    }
  }

  const repaired = repairTruncatedJson(sliceFromOpener(unfenced))
  if (repaired) {
    return { value: JSON.parse(repaired) as T, repaired: true }
  }

  throw new ReviewerModelJsonError('The reviewer model returned something that is not JSON.', {
    truncated: looksTruncated(unfenced),
    sample: unfenced.slice(-400),
  })
}

/**
 * Whether a repaired object still carries the keys that make it worth keeping.
 *
 * A reply cut off inside its very first string repairs to `{}`, which parses
 * but says nothing. Storing that would replace a real review with an empty one,
 * so callers check the salvage before accepting it.
 */
export function hasUsableKeys(value: unknown, requiredAnyOf: string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return requiredAnyOf.some((key) => {
    const entry = (value as Record<string, unknown>)[key]
    if (entry === undefined || entry === null) return false
    if (typeof entry === 'string') return entry.trim().length > 0
    if (Array.isArray(entry)) return entry.length > 0
    if (typeof entry === 'number') return Number.isFinite(entry)
    return true
  })
}
