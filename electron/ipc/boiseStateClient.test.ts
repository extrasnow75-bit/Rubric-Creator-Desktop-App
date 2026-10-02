import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createBoiseStateClient,
  extractJson,
  toJsonSchema,
  toMessageText,
  validateBoiseStateApiKey,
  BoiseStateError,
} from './boiseStateClient'

/** Replace fetch with a queue of canned replies; returns the requests it saw. */
function mockFetch(...replies: Array<{ status?: number; body: unknown }>) {
  const seen: any[] = []
  const queue = [...replies]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: any) => {
      seen.push({ url: _url, headers: init.headers, body: JSON.parse(init.body) })
      const next = queue.shift() ?? { body: { text: '' } }
      const status = next.status ?? 200
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => next.body,
        text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
      }
    }),
  )
  return seen
}

afterEach(() => vi.unstubAllGlobals())

describe('extractJson', () => {
  it('accepts plain JSON', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}')
  })
  it('strips a code fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it('finds JSON inside a sentence', () => {
    expect(extractJson('Here you go: {"a":[1,2]} Hope that helps!')).toBe('{"a":[1,2]}')
  })
  it('returns null for text that is not JSON, or JSON cut off mid-way', () => {
    expect(extractJson('no json here')).toBeNull()
    expect(extractJson('{"a":"unterminated')).toBeNull()
  })
})

describe('toJsonSchema', () => {
  it('lower-cases Gemini type names all the way down, leaving other keys alone', () => {
    const out: any = toJsonSchema({
      type: 'OBJECT',
      properties: { name: { type: 'STRING' }, items: { type: 'ARRAY', items: { type: 'NUMBER' } } },
      required: ['name'],
    })
    expect(out.type).toBe('object')
    expect(out.properties.items.items.type).toBe('number')
    expect(out.required).toEqual(['name'])
  })
  it('does not touch a property that is merely called "type"', () => {
    const out: any = toJsonSchema({ type: 'OBJECT', properties: { type: { type: 'STRING' } } })
    expect(out.properties.type).toEqual({ type: 'string' })
  })
})

describe('toMessageText', () => {
  it('joins text parts from every shape Gemini accepts', () => {
    expect(toMessageText('hi')).toBe('hi')
    expect(toMessageText([{ parts: [{ text: 'a' }, { text: 'b' }] }])).toBe('a\nb')
    expect(toMessageText({ parts: [{ text: 'a' }] })).toBe('a')
  })
  it('refuses a PDF and an image, and says what to do instead', () => {
    expect(() => toMessageText([{ parts: [{ inlineData: { mimeType: 'application/pdf', data: 'x' } }] }])).toThrow(/PDF/)
    expect(() => toMessageText({ parts: [{ inlineData: { mimeType: 'image/png', data: 'x' } }] })).toThrow(/images/)
  })
})

describe('the client', () => {
  const client = () => createBoiseStateClient(() => 'KEY')

  it('sends the key in X-API-Key and the instruction as systemPrompt', async () => {
    const seen = mockFetch({ body: { text: 'hello' } })
    const out = await client().models.generateContent({
      contents: 'question',
      config: { systemInstruction: 'be brief', temperature: 0.1 },
    })
    expect(out.text).toBe('hello')
    expect(seen[0].url).toBe('https://api.boisestate.ai/chat/api-converse')
    expect(seen[0].headers['X-API-Key']).toBe('KEY')
    expect(seen[0].body.message).toBe('question')
    expect(seen[0].body.messages).toBeUndefined()
    expect(seen[0].body.systemPrompt).toBe('be brief')
  })

  it('puts the schema in the prompt and returns clean JSON from a fenced reply', async () => {
    const seen = mockFetch({ body: { text: '```json\n{"ok":true}\n```' } })
    const out = await client().models.generateContent({
      contents: 'x',
      config: {
        systemInstruction: 'sys',
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } } },
      },
    })
    expect(JSON.parse(out.text)).toEqual({ ok: true })
    expect(seen[0].body.systemPrompt).toContain('"type":"boolean"')
    expect(seen[0].body.systemPrompt.startsWith('sys')).toBe(true)
  })

  it('retries once when the first reply is not JSON, and shows the model its own answer', async () => {
    const seen = mockFetch({ body: { text: 'Sure! Here is' } }, { body: { text: '{"a":1}' } })
    const out = await client().models.generateContent({
      contents: 'x',
      config: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' } },
    })
    expect(out.text).toBe('{"a":1}')
    expect(seen).toHaveLength(2)
    expect(seen[1].body.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('gives up with a readable error after the retry', async () => {
    mockFetch({ body: { text: 'nope' } }, { body: { text: 'still nope' } })
    await expect(
      client().models.generateContent({
        contents: 'x',
        config: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' } },
      }),
    ).rejects.toThrow(/could not read/)
  })

  it('replays earlier turns in a chat, since the API keeps no memory', async () => {
    const seen = mockFetch({ body: { text: 'one' } }, { body: { text: 'two' } })
    const chat = client().chats.create({ config: { systemInstruction: 'sys' } })
    await chat.sendMessage({ message: [{ text: 'first' }] })
    await chat.sendMessage({ message: [{ text: 'second' }] })
    expect(seen[0].body.message).toBe('first')
    expect(seen[1].body.message).toBeUndefined()
    expect(seen[1].body.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'one' },
      { role: 'user', content: 'second' },
    ])
  })

  it('says to make a new key on a 401, because they expire every 90 days', async () => {
    mockFetch({ status: 401, body: { error: 'Unauthorized' } })
    await expect(client().models.generateContent({ contents: 'x' })).rejects.toThrow(/90 days/)
  })

  it('flags a spent monthly allowance so the retry loop does not wait it out', async () => {
    mockFetch({ status: 429, body: 'Monthly token quota exceeded' })
    const err: any = await client().models.generateContent({ contents: 'x' }).catch((e) => e)
    expect(err).toBeInstanceOf(BoiseStateError)
    expect(err.hardQuota).toBe(true)
  })

  it('leaves an ordinary 429 retryable and carrying its status code', async () => {
    mockFetch({ status: 429, body: 'Too Many Requests' })
    const err: any = await client().models.generateContent({ contents: 'x' }).catch((e) => e)
    expect(err.hardQuota).toBe(false)
    expect(err.message).toContain('429')
  })

  it('asks for a key when none is saved', async () => {
    await expect(
      createBoiseStateClient(() => null).models.generateContent({ contents: 'x' }),
    ).rejects.toThrow(/No BoiseState\.ai API key/)
  })
})

describe('validateBoiseStateApiKey', () => {
  it('is false only for a rejected key', async () => {
    mockFetch({ status: 401, body: 'no' })
    expect(await validateBoiseStateApiKey('bad')).toBe(false)
    mockFetch({ status: 200, body: { text: 'ok' } })
    expect(await validateBoiseStateApiKey('good')).toBe(true)
    mockFetch({ status: 429, body: 'slow down' })
    expect(await validateBoiseStateApiKey('good')).toBe(true)
  })
  it('throws, rather than calling a key bad, when the service cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(validateBoiseStateApiKey('k')).rejects.toThrow(/Could not reach/)
  })
})
