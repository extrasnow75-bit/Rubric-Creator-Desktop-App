/**
 * `fetch` with a timeout and a polite retry, for the Canvas and Google Drive calls.
 *
 * A bare `fetch` has no timeout, so a stalled connection left "Uploading…" on screen forever, and
 * it treats a busy server as a hard failure. Canvas answers 429 when it is throttling and Drive
 * answers 429 or 503 when it is busy; both are asking the caller to wait and try again.
 *
 * Whether a retry is safe depends on the request:
 *
 *   - A request that can be repeated without harm (a read, or an overwrite of the same file) is
 *     retried on 429 and on 500/502/503/504, and on a network error or a timeout.
 *   - A request that creates something (a new rubric, a new Drive file) is retried only on 429,
 *     where the server has said it did NOT process the request. After a 5xx, a dropped
 *     connection or a timeout the server may well have done the work, and sending it again would
 *     make a second copy — so those are reported rather than retried.
 */

export interface RetryOptions {
  /** True when sending the same request twice is harmless. Default false. */
  idempotent?: boolean
  /** How long to wait for each attempt before giving up. Default 30 s. */
  timeoutMs?: number
  /** How many times to retry after the first attempt. Default 3. */
  retries?: number
  /** Aborts the whole call, including any wait between attempts. */
  signal?: AbortSignal
  /** Replaceable so tests do not really wait. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Replaceable so tests are deterministic. Returns a number in [0, 1). */
  random?: () => number
}

/** The request got no answer in time. Whether the server acted on it is unknown. */
export class RequestTimeoutError extends Error {
  constructor() {
    super('The server did not answer in time.')
    this.name = 'RequestTimeoutError'
  }
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_RETRIES = 3
const MAX_WAIT_MS = 60_000

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Seconds from a Retry-After header, or null. HTTP dates are not worth supporting here. */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('Retry-After')
  if (!header) return null
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null
}

function shouldRetryStatus(status: number, idempotent: boolean): boolean {
  if (status === 429) return true
  return idempotent && (status === 500 || status === 502 || status === 503 || status === 504)
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<Response> {
  const {
    idempotent = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    signal,
    sleep = defaultSleep,
    random = Math.random,
  } = options

  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs)
    const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout

    let response: Response
    try {
      response = await fetch(url, { ...init, signal: attemptSignal })
    } catch (err) {
      // The caller cancelling is not a fault, and is never retried.
      if (signal?.aborted) throw err
      const timedOut = timeout.aborted
      if (idempotent && attempt < retries) {
        await sleep(backoffMs(attempt, random), signal)
        continue
      }
      throw timedOut ? new RequestTimeoutError() : err
    }

    if (!shouldRetryStatus(response.status, idempotent) || attempt >= retries) return response

    const wait = Math.min(retryAfterMs(response) ?? backoffMs(attempt, random), MAX_WAIT_MS)
    // The body of a response we are discarding has to be drained or the connection is held open.
    await response.body?.cancel().catch(() => undefined)
    await sleep(wait, signal)
  }
}

/** 1 s, 2 s, 4 s, plus up to a quarter more so a batch of callers does not retry in step. */
function backoffMs(attempt: number, random: () => number): number {
  const base = 1000 * 2 ** attempt
  return Math.round(base + base * 0.25 * random())
}
