import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * How pushRubric, verifyToken and getCourseName answer for each way Canvas can respond.
 * canvas.test.ts covers which host the token goes to; this covers what the user is told.
 */

vi.mock('./settings', () => ({
  readSettings: () => ({ canvasCourseUrl: 'https://school.instructure.com/courses/555' }),
  updateSettings: () => undefined,
}))
vi.mock('./credentials', () => ({ getCanvasToken: () => 'cnvs~TESTTOKEN0123456789' }))
// Same wrapper, but a retry does not really wait.
vi.mock('./httpRetry', async (importOriginal) => {
  const real = await importOriginal<typeof import('./httpRetry')>()
  return {
    ...real,
    fetchWithRetry: (url: string, init: RequestInit, options = {}) =>
      real.fetchWithRetry(url, init, { ...options, sleep: async () => undefined }),
  }
})

const { pushRubric, verifyToken, getCourseName } = await import('./canvas')
const { RequestTimeoutError } = await import('./httpRetry')

const CSV = 'Rubric Name,Criteria Name,Rating Name,Rating Description,Points\nR,Clarity,Good,Nice,5'
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('pushRubric', () => {
  it('reports success', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { rubric: {} }))
    const result = await pushRubric({ csvContent: CSV })
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/uploaded/i)
  })

  it('explains a 401 as an expired token', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {}))
    const result = await pushRubric({ csvContent: CSV })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/token/i)
  })

  it('explains a 403 as a permissions problem', async () => {
    fetchMock.mockResolvedValueOnce(json(403, {}))
    const result = await pushRubric({ csvContent: CSV })
    expect(result.message).toMatch(/permission/i)
  })

  it('shows Canvas\'s own sentence for another failure, after stripping the JSON guard', async () => {
    fetchMock.mockResolvedValueOnce(json(422, 'while(1);{"errors":[{"message":"Criterion 3 has no ratings"}]}'))
    const result = await pushRubric({ csvContent: CSV })
    expect(result.success).toBe(false)
    expect(result.message).toContain('Criterion 3 has no ratings')
  })

  it('does not repeat an upload after a server error, so it cannot make a duplicate', async () => {
    fetchMock.mockResolvedValueOnce(json(503, {}))
    const result = await pushRubric({ csvContent: CSV })
    expect(result.success).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('waits and retries when Canvas says it is throttling', async () => {
    fetchMock.mockResolvedValueOnce(json(429, {})).mockResolvedValueOnce(json(200, {}))
    const result = await pushRubric({ csvContent: CSV })
    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('tells the user Canvas is busy once retries run out, with no status code', async () => {
    fetchMock.mockResolvedValue(json(429, {}))
    const result = await pushRubric({ csvContent: CSV })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/busy/i)
    expect(result.message).not.toMatch(/\b429\b/)
  })

  it('says to check the course before retrying after a timeout', async () => {
    fetchMock.mockRejectedValueOnce(new RequestTimeoutError())
    const result = await pushRubric({ csvContent: CSV })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/may or may not have been created/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a network failure plainly', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const result = await pushRubric({ csvContent: CSV })
    expect(result.message).toMatch(/could not reach canvas/i)
  })
})

describe('verifyToken and getCourseName', () => {
  it('verifyToken returns the name on success', async () => {
    fetchMock.mockResolvedValueOnce(json(200, 'while(1);{"name":"Dr. Rivera"}'))
    expect(await verifyToken()).toEqual({ ok: true, name: 'Dr. Rivera' })
  })

  it('verifyToken retries a busy Canvas', async () => {
    fetchMock.mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(200, { name: 'Dr. Rivera' }))
    expect((await verifyToken()).ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('verifyToken explains a rejected token', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {}))
    const result = await verifyToken()
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/rejected that token/i)
  })

  it('getCourseName returns the course name', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { name: 'NURS 712' }))
    expect(await getCourseName()).toEqual({ ok: true, name: 'NURS 712' })
  })

  it('getCourseName says Canvas did not answer in time, without inviting a duplicate', async () => {
    fetchMock.mockRejectedValue(new RequestTimeoutError())
    const result = await getCourseName()
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/did not answer in time/i)
  })
})
