import { describe, it, expect } from 'vitest'
import { chooseCourses, nextPageUrl, normalizeSite, roleOf, NO_TERM } from './courseList'

const NOW = new Date('2026-11-04T12:00:00Z')
const course = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  name: `Course ${id}`,
  course_code: `DEP-${id}`,
  enrollments: [{ type: 'teacher' }],
  term: { name: 'Fall 2026', start_at: '2026-08-24T00:00:00Z', end_at: '2026-12-18T00:00:00Z' },
  ...over,
})

describe('roleOf', () => {
  it('accepts both spellings and rejects student', () => {
    expect(roleOf('TeacherEnrollment')).toBe('teacher')
    expect(roleOf('ta')).toBe('ta')
    expect(roleOf('DesignerEnrollment')).toBe('designer')
    expect(roleOf('StudentEnrollment')).toBeNull()
    expect(roleOf(undefined)).toBeNull()
  })
})

describe('chooseCourses', () => {
  it('drops courses where the person is only a student or observer', () => {
    const list = chooseCourses([course(1), course(2, { enrollments: [{ type: 'student' }] }), course(3, { enrollments: [{ type: 'observer' }] })], NOW)
    expect(list.map((c) => c.id)).toEqual(['1'])
  })
  it('keeps the strongest role and lists a course once', () => {
    const list = chooseCourses([course(1, { enrollments: [{ type: 'ta' }, { type: 'teacher' }] }), course(1)], NOW)
    expect(list).toHaveLength(1)
    expect(list[0].role).toBe('teacher')
  })
  it('puts masters (no term) first, then terms newest first', () => {
    const spring = { name: 'Spring 2026', start_at: '2026-01-12T00:00:00Z', end_at: '2026-05-01T00:00:00Z' }
    const list = chooseCourses([course(1, { term: spring }), course(2), course(3, { term: null })], NOW)
    expect(list.map((c) => c.id)).toEqual(['3', '2', '1'])
    expect(list[0].term).toBe(NO_TERM)
  })
  it('marks ended courses by term end date or completed state', () => {
    const spring = { name: 'Spring 2026', start_at: '2026-01-12T00:00:00Z', end_at: '2026-05-01T00:00:00Z' }
    const list = chooseCourses([course(1, { term: spring }), course(2), course(3, { workflow_state: 'completed' })], NOW)
    expect(Object.fromEntries(list.map((c) => [c.id, c.ended]))).toEqual({ '1': true, '2': false, '3': true })
  })
  it('treats the Default Term as no term, and never calls such a course ended', () => {
    const list = chooseCourses([
      course(1, { term: { name: 'Default Term', start_at: '2020-01-01T00:00:00Z', end_at: '2020-02-01T00:00:00Z' }, workflow_state: 'completed' }),
      course(2),
    ], NOW)
    expect(list.map((c) => [c.id, c.term === NO_TERM, c.ended])).toEqual([['1', true, false], ['2', false, false]])
  })
  it('marks a Blueprint course', () => {
    const list = chooseCourses([course(1, { blueprint: true }), course(2)], NOW)
    expect(Object.fromEntries(list.map((c) => [c.id, c.blueprint]))).toEqual({ '1': true, '2': false })
  })
  it('falls back to a name when Canvas gives none', () => {
    expect(chooseCourses([course(9, { name: '' })], NOW)[0].name).toBe('Course 9')
  })
})

describe('normalizeSite', () => {
  it('accepts a bare host, a site address and a course address', () => {
    expect(normalizeSite('myschool.instructure.com')).toBe('https://myschool.instructure.com')
    expect(normalizeSite(' https://myschool.instructure.com/ ')).toBe('https://myschool.instructure.com')
    expect(normalizeSite('https://myschool.instructure.com/courses/12')).toBe('https://myschool.instructure.com')
  })
  it('accepts a school with its own Canvas domain, as pasted course addresses already do', () => {
    expect(normalizeSite('canvas.school.edu')).toBe('https://canvas.school.edu')
  })
  it('refuses plain http, loopback and private addresses, and empty input', () => {
    expect(normalizeSite('http://myschool.instructure.com')).toBeNull()
    expect(normalizeSite('localhost')).toBeNull()
    expect(normalizeSite('https://127.0.0.1')).toBeNull()
    expect(normalizeSite('192.168.1.5')).toBeNull()
    expect(normalizeSite('169.254.169.254')).toBeNull()
    expect(normalizeSite('')).toBeNull()
    expect(normalizeSite('not a site')).toBeNull()
  })
})

describe('nextPageUrl', () => {
  const origin = 'https://myschool.instructure.com'
  const link = (next: string) => `<${origin}/api/v1/courses?page=1>; rel="current", <${next}>; rel="next"`
  it('follows a next link on the same site', () => {
    expect(nextPageUrl(link(`${origin}/api/v1/courses?page=2`), origin)).toBe(`${origin}/api/v1/courses?page=2`)
  })
  it('stops when there is no next link', () => {
    expect(nextPageUrl(`<${origin}/api/v1/courses?page=1>; rel="current"`, origin)).toBeNull()
    expect(nextPageUrl(null, origin)).toBeNull()
  })
  it('refuses a next link that leaves the site, so the token is never sent there', () => {
    expect(nextPageUrl(link('https://evil.example.com/api/v1/courses?page=2'), origin)).toBeNull()
  })
})
