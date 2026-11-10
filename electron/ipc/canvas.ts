/**
 * Canvas API calls, made from the main process.
 *
 * In the web app these ran in the browser, which meant every request had to be bounced through a
 * proxy — a Vite dev-server plugin in development, a Vercel serverless function in production —
 * because Canvas sends no CORS headers. That proxy layer is gone: a main-process `fetch` is not
 * subject to CORS at all, so the requests go straight to Canvas. The README used to instruct
 * users to install a CORS-bypassing browser extension; that instruction is gone too.
 *
 * The token never travels through the renderer. Handlers here take the CSV and the course URL,
 * and load the token from the keychain themselves at the moment they build the request.
 */
import { canvasApiMessage, canvasUnreachableMessage } from './canvasMessages'
import { getCanvasToken } from './credentials'
import { fetchWithRetry, RequestTimeoutError } from './httpRetry'
import { readSettings } from './settings'
import { buildRubricPayload, parseCourseUrl, type CourseRef } from './canvasUtils'
import { chooseCourses, nextPageUrl, type CourseChoice, type RawCourse } from './courseList'

export interface CanvasResult {
  success: boolean
  message: string
}

const BAD_URL_MESSAGE =
  'That is not a recognised Canvas course URL. It should look like ' +
  'https://yourschool.instructure.com/courses/12345 — paste a link from inside your course.'

const NO_TOKEN_MESSAGE =
  'No Canvas token is saved. Add one in Initial Setup so rubrics can be sent to your course.'

const NO_COURSE_MESSAGE =
  'No Canvas course is saved yet. Add your course URL in Initial Setup first.'

const HOST_MISMATCH_MESSAGE =
  'That course is on a different Canvas site than the one saved in Initial Setup. ' +
  'Change the saved course URL first if you meant to switch institutions.'

/**
 * Resolve the course this request is for, refusing any host but the saved one.
 *
 * This is the actual host pinning, and it lives here because this is the only place that matters:
 * the function that attaches the token. An earlier version validated the renderer's URL —
 * requiring HTTPS, rejecting loopback and private ranges — and then used it. That is not pinning.
 * `https://attacker.example/courses/1` passes every one of those checks, so a single IPC call was
 * enough to send an instructor's Canvas token, and with it every student record it can read, to
 * any host on the internet. CSP does not help: this fetch happens in the main process.
 *
 * The renderer may still name a course, because the UI legitimately looks one up while the user
 * is typing — but only on the host already saved. Switching hosts goes through
 * `canvas:setCourseUrl`, which asks the user natively (see main.ts); a compromised renderer
 * cannot click that dialog.
 */
function resolveCourse(requested?: string): { ref: CourseRef } | { error: string } {
  const savedUrl = readSettings().canvasCourseUrl
  const pinned = savedUrl ? parseCourseUrl(savedUrl) : null
  if (!pinned) return { error: NO_COURSE_MESSAGE }

  if (!requested) return { ref: pinned }

  const ref = parseCourseUrl(requested)
  if (!ref) return { error: BAD_URL_MESSAGE }
  if (ref.host !== pinned.host) return { error: HOST_MISMATCH_MESSAGE }
  return { ref }
}

/**
 * Build the headers for a Canvas request.
 *
 * This is the only place the token is attached to anything, and it is reached only via
 * `parseCourseUrl`, which has already established that the destination is an HTTPS host that is
 * not loopback, private or link-local. The endpoint path is assembled here from a numeric course
 * id — never from rubric text, a filename, or anything else that passed through Gemini or a
 * user-supplied document — so there is no route by which generated content can redirect where
 * this token is sent.
 */
function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

/** Canvas prefixes some JSON responses with `while(1);` as an anti-hijacking measure. */
function stripJsonGuard(text: string): string {
  return text.replace(/^while\(1\);/, '')
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  try {
    const body = JSON.parse(stripJsonGuard(text)) as {
      errors?: Array<{ message?: string }>
      message?: string
    }
    return body.errors?.[0]?.message ?? body.message ?? response.statusText
  } catch {
    return response.statusText
  }
}

/**
 * Check that the saved token works, and say who it belongs to.
 *
 * Worth doing before an upload rather than after: a 401 at the end of a long workflow reads as
 * "the app is broken", whereas the same failure in the setup panel reads as "my token expired",
 * which is both true and actionable.
 */
export async function verifyToken(args?: {
  courseUrl?: string
}): Promise<{ ok: boolean; name?: string; message?: string }> {
  const resolved = resolveCourse(args?.courseUrl)
  if ('error' in resolved) return { ok: false, message: resolved.error }
  const { ref } = resolved

  const token = getCanvasToken()
  if (!token) return { ok: false, message: NO_TOKEN_MESSAGE }

  try {
    const response = await fetchWithRetry(
      `${ref.origin}/api/v1/users/self/profile`,
      { headers: authHeaders(token) },
      { idempotent: true },
    )
    if (!response.ok) {
      return { ok: false, message: canvasApiMessage(response.status, await readError(response)) }
    }
    const profile = JSON.parse(stripJsonGuard(await response.text())) as { name?: string }
    return { ok: true, name: profile.name }
  } catch (e) {
    return {
      ok: false,
      message: unreachableMessage(e),
    }
  }
}

/** Look up the course name, so the UI can confirm the user is pointed at the right course. */
export async function getCourseName(args?: {
  courseUrl?: string
}): Promise<{ ok: boolean; name?: string; message?: string }> {
  const resolved = resolveCourse(args?.courseUrl)
  if ('error' in resolved) return { ok: false, message: resolved.error }
  const { ref } = resolved

  const token = getCanvasToken()
  if (!token) return { ok: false, message: NO_TOKEN_MESSAGE }

  try {
    const response = await fetchWithRetry(
      `${ref.origin}/api/v1/courses/${ref.courseId}`,
      { headers: authHeaders(token) },
      { idempotent: true },
    )
    if (!response.ok) {
      return { ok: false, message: canvasApiMessage(response.status, await readError(response)) }
    }
    const course = JSON.parse(stripJsonGuard(await response.text())) as { name?: string }
    return { ok: true, name: course.name }
  } catch (e) {
    return {
      ok: false,
      message: unreachableMessage(e),
    }
  }
}

const COURSE_QUERY = 'include[]=term&state[]=available&state[]=unpublished'
/** A person with thousands of courses would still fit; this only stops a server that never ends. */
const MAX_COURSE_PAGES = 50
/** Pages (100 courses each) read across all the accounts a person administers. */
const ADMIN_COURSE_PAGES = 30

/** Every page of one listing, following Canvas's Link headers. Stops early at `maxPages`. */
async function fetchPages<T>(
  origin: string,
  path: string,
  token: string,
  maxPages = MAX_COURSE_PAGES,
): Promise<{ items: T[]; truncated: boolean }> {
  const all: T[] = []
  let url: string | null = `${origin}/api/v1${path}${path.includes('?') ? '&' : '?'}per_page=100`
  let page = 0
  for (; url && page < maxPages; page++) {
    const response: Response = await fetchWithRetry(url, { headers: authHeaders(token) }, { idempotent: true })
    if (!response.ok) throw new CourseListError(canvasApiMessage(response.status, await readError(response)))
    const data: unknown = JSON.parse(stripJsonGuard(await response.text()))
    if (Array.isArray(data)) all.push(...(data as T[]))
    url = nextPageUrl(response.headers.get('link'), origin)
  }
  return { items: all, truncated: url !== null }
}

/** A failure whose text is already fit to show the user. */
class CourseListError extends Error {}

/**
 * The courses the saved token's owner teaches, assists in or designs, on one Canvas site.
 *
 * `origin` must already have been checked by the caller (see the `canvas:listCourses` handler in
 * main.ts): this function attaches the token to whatever origin it is handed.
 */
export async function listCourses(
  origin: string,
): Promise<{ ok: true; site: string; courses: CourseChoice[]; truncated: boolean } | { ok: false; message: string }> {
  const token = getCanvasToken()
  if (!token) return { ok: false, message: NO_TOKEN_MESSAGE }

  try {
    const current = (await fetchPages<RawCourse>(origin, `/courses?${COURSE_QUERY}`, token)).items
    let past: RawCourse[] = []
    try {
      past = (await fetchPages<RawCourse>(origin, `/courses?${COURSE_QUERY}&state[]=completed&enrollment_state=completed`, token)).items
    } catch {
      // The current list is still useful if the past one fails.
    }

    // Account admins have no enrollment in the courses they manage, so those never show up above.
    // Canvas lists accounts only for people who can manage them; for everyone else this is empty.
    // A failure here leaves the enrolled courses in place rather than failing the whole list.
    let adminCourses: RawCourse[] = []
    let truncated = false
    try {
      const accounts = (await fetchPages<{ id: number }>(origin, '/accounts', token, 5)).items
      for (const account of accounts) {
        const room = ADMIN_COURSE_PAGES - Math.floor(adminCourses.length / 100)
        if (room <= 0) {
          truncated = true
          break
        }
        const res = await fetchPages<RawCourse>(origin, `/accounts/${account.id}/courses?${COURSE_QUERY}`, token, room)
        adminCourses.push(...res.items)
        if (res.truncated) truncated = true
      }
    } catch {
      adminCourses = []
    }
    return { ok: true, site: origin, courses: chooseCourses([...current, ...past], new Date(), adminCourses), truncated }
  } catch (e) {
    if (e instanceof CourseListError) return { ok: false, message: e.message }
    return { ok: false, message: unreachableMessage(e) }
  }
}

/**
 * What the user is told when the request to Canvas failed before any answer came back.
 *
 * A timeout is different from "cannot connect": the request may have arrived. For an upload that
 * means the rubric might already be in the course, so the message says to look before retrying,
 * rather than inviting a second attempt that would make a duplicate.
 */
function unreachableMessage(e: unknown, creating = false): string {
  if (e instanceof RequestTimeoutError) {
    return creating
      ? 'Canvas did not answer in time. The rubric may or may not have been created, so check the Rubrics page in your course before trying again.'
      : 'Canvas did not answer in time. Please try again.'
  }
  return canvasUnreachableMessage(e instanceof Error ? e.message : String(e))
}

/** Push one rubric CSV to a course's Rubrics list. */
export async function pushRubric(args: {
  csvContent: string
  courseUrl?: string
  /** Cancels the request, and any wait between retries. */
  signal?: AbortSignal
}): Promise<CanvasResult> {
  const resolved = resolveCourse(args.courseUrl)
  if ('error' in resolved) return { success: false, message: resolved.error }
  const { ref } = resolved

  const token = getCanvasToken()
  if (!token) return { success: false, message: NO_TOKEN_MESSAGE }

  const built = buildRubricPayload(args.csvContent, ref.courseId)
  if (!built.ok) return { success: false, message: built.message }

  try {
    // Creating a rubric is not safe to repeat: only a 429 ("not processed, wait") is retried.
    const response = await fetchWithRetry(
      `${ref.origin}/api/v1/courses/${ref.courseId}/rubrics`,
      { method: 'POST', headers: authHeaders(token), body: JSON.stringify(built.payload) },
      { idempotent: false, signal: args.signal },
    )

    if (!response.ok) {
      return {
        success: false,
        message: canvasApiMessage(response.status, await readError(response)),
      }
    }

    return {
      success: true,
      message:
        "Success. The rubric has been uploaded and can now be found in your Canvas 'Rubrics' list.",
    }
  } catch (e) {
    if (args.signal?.aborted) {
      return {
        success: false,
        message:
          'Upload cancelled. If it had already been sent, the rubric may still appear in your course.',
      }
    }
    // No CORS case to explain any more: this request is made from the main process, so a failure
    // here is a real network problem rather than the browser refusing to make the call.
    return {
      success: false,
      message: unreachableMessage(e, true),
    }
  }
}
