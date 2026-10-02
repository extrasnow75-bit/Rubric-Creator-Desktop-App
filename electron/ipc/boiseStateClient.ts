/**
 * BoiseState.ai, shaped like the part of the Gemini SDK that gemini.ts uses.
 *
 * gemini.ts makes about fifteen calls of the form `ai.models.generateContent({ model, contents,
 * config })` and reads `.text` off the result, plus one `ai.chats.create(...).sendMessage(...)`.
 * Rather than fork every call site, this file answers those two shapes and nothing else, so the
 * prompts, schemas and post-checks stay exactly as they are and only the transport changes.
 *
 * What the BoiseState.ai API is (from Boise State's own "Using API Keys" guide):
 *   POST https://api.boisestate.ai/chat/api-converse
 *   header  X-API-Key
 *   body    { message | messages:[{role,content}], modelId, systemPrompt, temperature, maxTokens }
 *   reply   { text, usage:{ inputTokens, outputTokens } }
 *
 * What it is not, and what that costs here:
 *   - No documented way to attach a file or an image. `content` is a string. So a PDF or a
 *     screenshot cannot be sent, and this client refuses them with a message that says so rather
 *     than sending garbage. .docx is unaffected — it is turned into text before it gets here.
 *   - No structured-output mode. The schema the caller supplied is written into the prompt and the
 *     reply is parsed, with one corrective retry. The callers' own checks (rubric parsing, the
 *     CSV repair gates) still run afterwards, exactly as they do for Gemini.
 *   - No documented output ceiling beyond the guide's "1000–2000 recommended". MAX_TOKENS below is
 *     a guess and is the first thing to adjust if long rubrics come back truncated.
 *
 * Kept free of Electron imports so it can be unit-tested; the key arrives through a callback.
 */

export const BOISESTATE_API_URL = 'https://api.boisestate.ai/chat/api-converse'
export const BOISESTATE_KEYS_URL = 'https://boisestate.ai/api-keys'

/** Nova Pro: the guide's own recommendation for general work. */
export const BOISESTATE_MODEL = 'us.amazon.nova-pro-v1:0'

/** Not documented — see the note above. Revisit if answers arrive cut off. */
const MAX_TOKENS = 4096

/** A document-sized prompt on a slow model can take a while; the guide's 30 s example is for chat. */
const REQUEST_TIMEOUT_MS = 180_000

/** An error carrying a flag the retry loop in gemini.ts reads: waiting will not fix this one. */
export class BoiseStateError extends Error {
  hardQuota = false
}

// ─── What the caller handed us ────────────────────────────────────────────────

type Part = { text?: string; inlineData?: { mimeType?: string; data?: string } }

/** Gemini accepts a string, one content object, or an array of them. Flatten all three. */
function partsOf(contents: unknown): Part[] {
  if (typeof contents === 'string') return [{ text: contents }]
  const list = Array.isArray(contents) ? contents : [contents]
  const parts: Part[] = []
  for (const item of list) {
    if (typeof item === 'string') parts.push({ text: item })
    else if (item && Array.isArray((item as any).parts)) parts.push(...(item as any).parts)
    else if (item) parts.push(item as Part)
  }
  return parts
}

/** Join the text parts; refuse the parts this API has no way to carry. */
export function toMessageText(contents: unknown): string {
  const texts: string[] = []
  for (const part of partsOf(contents)) {
    if (part.inlineData) {
      const mime = part.inlineData.mimeType ?? ''
      if (mime.startsWith('image/')) {
        throw new BoiseStateError(
          'BoiseState.ai cannot read images, so this feature needs Gemini. ' +
            'Switch the AI service under Initial Setup.',
        )
      }
      throw new BoiseStateError(
        'BoiseState.ai cannot read PDF files directly. Use a Word document or a Google Doc ' +
          'instead, or switch to Gemini under Initial Setup.',
      )
    }
    if (typeof part.text === 'string') texts.push(part.text)
  }
  return texts.join('\n')
}

// ─── Structured output, done in the prompt ────────────────────────────────────

/** Gemini's schema uses upper-case type names (`'OBJECT'`); JSON Schema wants lower-case. */
export function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema)
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      out[key] = key === 'type' && typeof value === 'string' ? value.toLowerCase() : toJsonSchema(value)
    }
    return out
  }
  return schema
}

function jsonInstruction(schema: unknown): string {
  return (
    'OUTPUT FORMAT: Reply with ONLY one JSON value that conforms to the JSON Schema below. ' +
    'No markdown code fences, no commentary before or after it. Every string must be properly ' +
    'escaped, including quotation marks and line breaks inside text.\n\nJSON Schema:\n' +
    JSON.stringify(toJsonSchema(schema))
  )
}

/**
 * Pull a JSON document out of a model reply, or return null.
 *
 * Models asked for "only JSON" still wrap it in a fence or add a sentence often enough that
 * parsing the raw reply would fail a meaningful share of calls for no real reason.
 */
export function extractJson(reply: string): string | null {
  let text = reply.trim()
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) text = fenced[1].trim()

  const attempt = (candidate: string): string | null => {
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      return null
    }
  }

  const direct = attempt(text)
  if (direct) return direct

  // Fall back to the outermost object or array in the text.
  const open = text.search(/[{[]/)
  if (open === -1) return null
  const closer = text[open] === '{' ? '}' : ']'
  const close = text.lastIndexOf(closer)
  return close > open ? attempt(text.slice(open, close + 1)) : null
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

type Turn = { role: 'user' | 'assistant'; content: string }

interface CallArgs {
  apiKey: string
  turns: Turn[]
  systemPrompt?: string
  temperature?: number
}

async function post(args: CallArgs): Promise<string> {
  // The API takes either `message` or `messages`, never both. A single turn goes as `message`
  // because that is the form the guide shows working.
  const body: Record<string, unknown> = {
    modelId: BOISESTATE_MODEL,
    maxTokens: MAX_TOKENS,
  }
  if (args.turns.length === 1) body.message = args.turns[0].content
  else body.messages = args.turns
  if (args.systemPrompt) body.systemPrompt = args.systemPrompt
  if (args.temperature !== undefined) body.temperature = Math.min(1, Math.max(0, args.temperature))

  let response: Response
  try {
    response = await fetch(BOISESTATE_API_URL, {
      method: 'POST',
      headers: { 'X-API-Key': args.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err: any) {
    if (err?.name === 'TimeoutError') {
      throw new BoiseStateError('BoiseState.ai took too long to answer. Please try again.')
    }
    // Phrased to include "connection" so the app's network-error wording applies.
    throw new BoiseStateError(
      'Could not reach BoiseState.ai — check your internet connection and try again.',
    )
  }

  if (!response.ok) throw await httpError(response)

  const data: any = await response.json().catch(() => null)
  if (!data || typeof data.text !== 'string') {
    throw new BoiseStateError('BoiseState.ai sent back a reply the app could not read.')
  }
  return data.text
}

async function httpError(response: Response): Promise<BoiseStateError> {
  const detail = (await response.text().catch(() => '')).slice(0, 300)

  if (response.status === 401 || response.status === 403) {
    return new BoiseStateError(
      `BoiseState.ai rejected your API key (${response.status}). Keys expire after 90 days — ` +
        `make a new one at boisestate.ai/api-keys and save it under Initial Setup.`,
    )
  }

  const error = new BoiseStateError(
    `BoiseState.ai request failed (${response.status})${detail ? `: ${detail}` : ''}`,
  )
  // A spent monthly allocation will not recover in the few minutes the retry loop would wait.
  if (response.status === 429 && /monthly|quota|allocation|exceeded your/i.test(detail)) {
    error.hardQuota = true
    error.message =
      `BoiseState.ai says your monthly usage allowance is used up (429). It resets with your ` +
      `monthly quota; until then, switch to Gemini under Initial Setup.`
  }
  return error
}

// ─── The two shapes gemini.ts calls ───────────────────────────────────────────

interface GenerateParams {
  model?: string
  contents: unknown
  config?: {
    systemInstruction?: string
    temperature?: number
    responseMimeType?: string
    responseSchema?: unknown
  }
}

/**
 * One request, with the JSON handling when the caller asked for JSON.
 *
 * `history` carries earlier turns for the chat; a standalone call passes none.
 */
async function run(
  getApiKey: () => string | null,
  history: Turn[],
  contents: unknown,
  config: GenerateParams['config'] = {},
): Promise<string> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new BoiseStateError(
      'No BoiseState.ai API key is saved. Add one under Initial Setup to use the AI features.',
    )
  }

  const wantsJson = config.responseMimeType === 'application/json'
  let systemPrompt = config.systemInstruction
  if (wantsJson && config.responseSchema) {
    systemPrompt = [systemPrompt, jsonInstruction(config.responseSchema)].filter(Boolean).join('\n\n')
  }

  const userTurn: Turn = { role: 'user', content: toMessageText(contents) }
  const turns = [...history, userTurn]
  const reply = await post({ apiKey, turns, systemPrompt, temperature: config.temperature })

  if (!wantsJson) return reply
  const json = extractJson(reply)
  if (json) return json

  // One corrective round. Most bad replies are a stray sentence or an unescaped quote, which the
  // model fixes when it is shown its own output.
  const retry = await post({
    apiKey,
    systemPrompt,
    temperature: config.temperature,
    turns: [
      ...turns,
      { role: 'assistant', content: reply },
      {
        role: 'user',
        content:
          'That was not valid JSON. Reply again with ONLY the complete, valid JSON — no fences, ' +
          'no commentary.',
      },
    ],
  })
  const fixed = extractJson(retry)
  if (fixed) return fixed
  throw new BoiseStateError(
    'BoiseState.ai returned an answer the app could not read, possibly cut off because it was ' +
      'too long. Please try again, or convert fewer rubrics at once.',
  )
}

export interface BoiseStateClient {
  models: { generateContent(params: GenerateParams): Promise<{ text: string }> }
  chats: {
    create(params: { config?: GenerateParams['config'] }): {
      sendMessage(params: { message: unknown }): Promise<{ text: string }>
    }
  }
}

export function createBoiseStateClient(getApiKey: () => string | null): BoiseStateClient {
  return {
    models: {
      async generateContent({ contents, config }) {
        return { text: await run(getApiKey, [], contents, config) }
      },
    },
    chats: {
      create({ config }) {
        // The API keeps no memory between requests, so the chat is held here and replayed.
        const history: Turn[] = []
        return {
          async sendMessage({ message }) {
            const text = await run(getApiKey, history, message, config)
            history.push({ role: 'user', content: toMessageText(message) })
            history.push({ role: 'assistant', content: text })
            return { text }
          },
        }
      },
    },
  }
}

/**
 * Check a key before it is saved.
 *
 * True when the key was accepted or the failure was not about the key (a 429, a 500); false only
 * for 401/403. Throws when BoiseState.ai could not be reached at all, so the caller can say that
 * instead of calling a good key bad.
 */
export async function validateBoiseStateApiKey(apiKey: string): Promise<boolean> {
  try {
    await post({
      apiKey,
      turns: [{ role: 'user', content: 'Say "ok"' }],
      temperature: 0,
    })
    return true
  } catch (err: any) {
    if (/rejected your API key/.test(err?.message ?? '')) return false
    if (/Could not reach|took too long/.test(err?.message ?? '')) throw err
    return true
  }
}
