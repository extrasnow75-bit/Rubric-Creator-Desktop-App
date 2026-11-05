/**
 * The list of courses a person can choose from, instead of pasting a course address.
 *
 * Ported from Canvas Extractor Tools, so both apps offer the same list in the same order.
 *
 * Only courses where the person is a teacher, TA or designer are offered: those are the ones a
 * rubric can be added to, and a student cannot create rubrics at all. Pure logic lives here so it
 * can be tested without Canvas or Electron; the request itself is `listCourses` in canvas.ts.
 */
import { parseCourseUrl } from './canvasUtils'

/** 'admin' is someone who administers the Canvas account the course sits in, with no enrollment in it. */
export type CourseRole = 'teacher' | 'ta' | 'designer' | 'admin'

export interface CourseChoice {
  id: string
  name: string
  code: string
  role: CourseRole
  /** Term name, or NO_TERM for courses with none (and for Canvas's "Default Term"), such as masters. */
  term: string
  /** Start of the term, for ordering newest first. Null when Canvas has none. */
  termStart: string | null
  ended: boolean
  /** A Blueprint (master) course. False when Canvas does not say. */
  blueprint: boolean
}

export interface RawCourse {
  id: number
  name?: string
  course_code?: string
  workflow_state?: string
  blueprint?: boolean
  end_at?: string | null
  term?: { name?: string; start_at?: string | null; end_at?: string | null } | null
  enrollments?: Array<{ type?: string }>
}

/** The group for masters and templates, which belong to no real term. */
// The picker adds "master and template courses" beside this name; src/components/courseFilter.ts
// holds the same word, since the screen cannot import from here.
export const NO_TERM = 'No term'

const isRealTerm = (name: string | undefined): boolean =>
  Boolean(name?.trim()) && !/^default term$/i.test(name as string)

/** Canvas writes the same role as "teacher" in some places and "TeacherEnrollment" in others. */
export function roleOf(type: string | undefined): CourseRole | null {
  const t = (type ?? '').toLowerCase().replace(/enrollment$/, '')
  if (t === 'teacher') return 'teacher'
  if (t === 'ta') return 'ta'
  if (t === 'designer') return 'designer'
  return null
}

const PRIORITY: CourseRole[] = ['teacher', 'designer', 'ta']

/**
 * Reduces Canvas's course records to the ones to offer, newest term first, then by name.
 *
 * `adminRaw` is the courses of accounts the person administers. An account admin usually has no
 * enrollment, so these never appear in their own course list; any not already listed there are
 * added with the 'admin' role. A course the person is also enrolled in keeps the enrollment role.
 */
export function chooseCourses(raw: RawCourse[], now = new Date(), adminRaw: RawCourse[] = []): CourseChoice[] {
  const seen = new Set<number>()
  const out: CourseChoice[] = []
  const add = (c: RawCourse, role: CourseRole) => {
    seen.add(c.id)
    const real = isRealTerm(c.term?.name)
    const endAt = real ? (c.term?.end_at ?? c.end_at ?? null) : null
    out.push({
      id: String(c.id),
      name: c.name?.trim() || `Course ${c.id}`,
      code: c.course_code?.trim() ?? '',
      role,
      term: real ? (c.term?.name as string).trim() : NO_TERM,
      termStart: real ? (c.term?.start_at ?? null) : null,
      // A course with no term is never "ended": masters stay in use, and the group is not labelled by it.
      ended: real && (c.workflow_state === 'completed' || (endAt !== null && Date.parse(endAt) < now.getTime())),
      blueprint: c.blueprint === true,
    })
  }
  for (const c of raw) {
    if (seen.has(c.id)) continue
    const roles = (c.enrollments ?? []).map((e) => roleOf(e.type)).filter((r): r is CourseRole => r !== null)
    if (roles.length === 0) continue
    add(c, PRIORITY.find((p) => roles.includes(p)) as CourseRole)
  }
  for (const c of adminRaw) {
    if (!seen.has(c.id)) add(c, 'admin')
  }
  return out.sort((a, b) => {
    // Masters and templates first, by name: for a designer they are the courses opened most.
    // Then terms, newest first, with a term name breaking ties between equal dates.
    if ((a.term === NO_TERM) !== (b.term === NO_TERM)) return a.term === NO_TERM ? -1 : 1
    const sa = a.termStart ? Date.parse(a.termStart) : -Infinity
    const sb = b.termStart ? Date.parse(b.termStart) : -Infinity
    return sb - sa || a.term.localeCompare(b.term) || a.name.localeCompare(b.name)
  })
}

/**
 * Turns whatever was typed for a Canvas site into its origin, or null when it cannot be one.
 * "myschool.instructure.com", "https://myschool.instructure.com/" and a full course address all
 * give "https://myschool.instructure.com".
 *
 * Goes through `parseCourseUrl` so the site gets exactly the checks a pasted course address
 * gets: HTTPS only, and no loopback, private or link-local hosts. This origin is where the
 * Canvas token is sent. (Unlike the extractor, this app has never limited itself to
 * instructure.com, because schools with their own Canvas domain use it.)
 */
export function normalizeSite(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  let origin: string
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    origin = url.origin
  } catch {
    return null
  }
  return parseCourseUrl(`${origin}/courses/0`)?.origin ?? null
}

/**
 * The `rel="next"` address from a Canvas `Link` header, or null when this is the last page or
 * the next page is on a different origin.
 *
 * The address is chosen by the server and fetched with the token attached, so one that named
 * another host would walk the token off to it. A cross-origin hop ends paging instead.
 */
export function nextPageUrl(linkHeader: string | null, origin: string): string | null {
  const match = (linkHeader ?? '').match(/<([^>]+)>;\s*rel="next"/)
  if (!match) return null
  try {
    return new URL(match[1]).origin === origin ? match[1] : null
  } catch {
    return null
  }
}
