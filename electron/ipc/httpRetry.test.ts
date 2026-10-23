import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchWithRetry, RequestTimeoutError } from './httpRetry'

const sleeps: number[] = []
const sleep = async (ms: number) => {
  sleeps.push(ms)
}
const opts = { sleep, random: () => 0 }

function reply(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : 'body', { status, headers })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  sleeps.length = 0
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('fetchWithRetry', () => {
  it('returns a success without waiting', async () => {
    fetchMock.mockResolvedValueOnce(reply(200))
    const res = await fetchWithRetry('https://x.test/', {}, opts)
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleeps).toEqual([])
  })

  it('retries a 429 with backoff, then succeeds', async () => {
    fetchMock.mockResolvedValueOnce(reply(429)).mockResolvedValueOnce(reply(429)).mockResolvedValueOnce(reply(200))
    const res = await fetchWithRetry('https://x.test/', { method: 'POST' }, opts)
    expect(res.status).toBe(200)
    expect(sleeps).toEqual([1000, 2000])
  })

  it('honours Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(reply(429, { 'Retry-After': '7' })).mockResolvedValueOnce(reply(200))
    await fetchWithRetry('https://x.test/', {}, opts)
    expect(sleeps).toEqual([7000])
  })

  it('caps a very long Retry-After at a minute', async () => {
    fetchMock.mockResolvedValueOnce(reply(429, { 'Retry-After': '3600' })).mockResolvedValueOnce(reply(200))
    await fetchWithRetry('https://x.test/', {}, opts)
    expect(sleeps).toEqual([60_000])
  })

  it('gives the last response back once retries run out', async () => {
    fetchMock.mockResolvedValue(reply(429))
    const res = await fetchWithRetry('https://x.test/', {}, { ...opts, retries: 2 })
    expect(res.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry a 5xx for a request that creates something', async () => {
    fetchMock.mockResolvedValueOnce(reply(503))
    const res = await fetchWithRetry('https://x.test/', { method: 'POST' }, { ...opts, idempotent: false })
    expect(res.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a 503 for a request that is safe to repeat', async () => {
    fetchMock.mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(reply(200))
    const res = await fetchWithRetry('https://x.test/', {}, { ...opts, idempotent: true })
    expect(res.status).toBe(200)
  })

  it('does not retry a 4xx other than 429', async () => {
    fetchMock.mockResolvedValueOnce(reply(404))
    const res = await fetchWithRetry('https://x.test/', {}, { ...opts, idempotent: true })
    expect(res.status).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a network error when repeating is safe', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(reply(200))
    const res = await fetchWithRetry('https://x.test/', {}, { ...opts, idempotent: true })
    expect(res.status).toBe(200)
  })

  it('does not retry a network error for a request that creates something', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(fetchWithRetry('https://x.test/', { method: 'POST' }, opts)).rejects.toThrow('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a timeout as a RequestTimeoutError', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    await expect(fetchWithRetry('https://x.test/', {}, { ...opts, timeoutMs: 10 })).rejects.toBeInstanceOf(
      RequestTimeoutError,
    )
  })

  it('never retries when the caller cancelled', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    fetchMock.mockRejectedValue(controller.signal.reason)
    await expect(
      fetchWithRetry('https://x.test/', {}, { ...opts, idempotent: true, signal: controller.signal }),
    ).rejects.toThrow('cancelled')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
