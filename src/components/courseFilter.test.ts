import { describe, it, expect } from 'vitest'
import { visibleGroups, countCourses, siteOf, DEFAULT_SITE } from './courseFilter'
import type { CourseChoice } from '../types'

const c = (id: string, name: string, term: string, ended = false, code = ''): CourseChoice => ({
  id, name, code, role: 'teacher', term, termStart: null, ended, blueprint: false,
})
const all = [
  c('1', 'Intro to Health', 'Fall 2026', false, 'HLTH-101'),
  c('2', 'Respiratory Care', 'Fall 2026', false, 'RESPCARE-560'),
  c('3', 'Data Structures', 'Spring 2026', true, 'CS-321'),
]

describe('visibleGroups', () => {
  it('lists every course, ended ones included', () => {
    expect(countCourses(visibleGroups(all, ''))).toBe(3)
  })
  it('groups by term in the given order', () => {
    expect(visibleGroups(all, '').map((g) => g.term)).toEqual(['Fall 2026', 'Spring 2026'])
  })
  it('matches every typed word against name and code', () => {
    expect(visibleGroups(all, 'resp 560')[0].courses[0].id).toBe('2')
    expect(visibleGroups(all, 'health care')).toEqual([])
  })
})

describe('siteOf', () => {
  it('uses the site of a typed course address', () => {
    expect(siteOf('https://school.instructure.com/courses/12')).toBe('https://school.instructure.com')
    expect(siteOf(' https://canvas.school.edu/courses/12/modules')).toBe('https://canvas.school.edu')
  })
  it('falls back to Boise State while the address is not usable yet', () => {
    expect(siteOf('')).toBe(DEFAULT_SITE)
    expect(siteOf('https://boisestatecanvas.instructure.com/courses/')).toBe(DEFAULT_SITE)
    expect(siteOf('http://school.instructure.com/courses/1')).toBe(DEFAULT_SITE)
    expect(siteOf('not a url')).toBe(DEFAULT_SITE)
  })
})
