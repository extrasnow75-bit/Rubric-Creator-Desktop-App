import React, { useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import type { CourseChoice } from '../types'
import { countCourses, NO_TERM_GROUP, siteHost, visibleGroups } from './courseFilter'

const ROLE_LABEL = { teacher: 'Teacher', ta: 'TA', designer: 'Designer' } as const
const ROLE_STYLE = {
  teacher: 'bg-indigo-100 text-indigo-900',
  ta: 'bg-amber-100 text-amber-900',
  designer: 'bg-green-100 text-green-900',
} as const

interface Props {
  /** Where to look first: the site of the course address already typed, else Boise State's. */
  defaultSite: string
  /** Called with the chosen course's address, e.g. https://school.instructure.com/courses/123. */
  onChoose(courseUrl: string): void
}

/**
 * "Choose from my courses": a searchable list of the courses the person teaches, assists in
 * or designs, on any Canvas site. Typing the address by hand stays available beside it.
 */
export function CoursePicker({ defaultSite, onChoose }: Props) {
  const [open, setOpen] = useState(false)
  const [site, setSite] = useState(defaultSite)
  const [editingSite, setEditingSite] = useState(false)
  const [siteInput, setSiteInput] = useState('')
  const [courses, setCourses] = useState<CourseChoice[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const latest = useRef(0)
  const id = useId()

  const load = async (target: string) => {
    const mine = ++latest.current
    setLoading(true)
    setError(null)
    setCourses(null)
    try {
      const res = await window.api.canvas.listCourses({ site: target })
      if (mine !== latest.current) return
      if (res.ok) {
        setSite(res.site)
        setCourses(res.courses)
      } else setError(res.message)
    } catch (err) {
      if (mine === latest.current) setError(err instanceof Error ? err.message : 'Could not load your courses.')
    } finally {
      if (mine === latest.current) setLoading(false)
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    // Loaded on first opening, and again if the course address now points at another site.
    if (next && (courses === null || defaultSite !== site) && !loading) {
      setSite(defaultSite)
      void load(defaultSite)
    }
  }

  const groups = courses ? visibleGroups(courses, query) : []
  const shown = countCourses(groups)

  return (
    <div>
      <button
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        className="w-full flex items-center justify-center gap-1.5 rounded-xl border-2 border-brand text-brand hover:bg-blue-50 font-black text-sm px-4 py-2.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        Choose from my courses
        {open ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
      </button>

      {open && (
        <div id={`${id}-list`} className="mt-2.5 rounded-xl border-2 border-gray-200 overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-2.5 bg-gray-50 border-b border-gray-200">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by course name or code"
              aria-label="Search your courses"
              spellCheck={false}
              className="flex-1 min-w-[10rem] border-2 border-gray-500 rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-brand"
            />
          </div>

          <div className="px-3 py-2 text-xs text-gray-700 border-b border-gray-200 flex flex-wrap items-center gap-2">
            {editingSite ? (
              <>
                <label htmlFor={`${id}-site`}>Canvas site</label>
                <input
                  id={`${id}-site`}
                  type="text"
                  value={siteInput}
                  onChange={(e) => setSiteInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setEditingSite(false)
                      void load(siteInput)
                    }
                  }}
                  placeholder="yourschool.instructure.com"
                  spellCheck={false}
                  className="flex-1 min-w-[10rem] border-2 border-gray-500 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-brand"
                />
                <button
                  onClick={() => {
                    setEditingSite(false)
                    void load(siteInput)
                  }}
                  className="font-black text-brand underline underline-offset-2"
                >
                  Load courses
                </button>
              </>
            ) : (
              <>
                <span>
                  Canvas site: <b>{siteHost(site)}</b>
                </span>
                <button
                  onClick={() => {
                    setSiteInput(siteHost(site))
                    setEditingSite(true)
                  }}
                  className="font-black text-brand underline underline-offset-2"
                >
                  Change
                </button>
              </>
            )}
          </div>

          <div className="max-h-[290px] overflow-auto" role="region" aria-label="Your courses">
            {loading && (
              <p className="p-3.5 text-[13px] text-gray-700 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading your courses…
              </p>
            )}
            {error && <p className="p-3.5 text-[13px] text-red-700">{error}</p>}
            {courses && shown === 0 && (
              <p className="p-3.5 text-[13px] text-gray-700">
                No courses match. Try fewer words.
              </p>
            )}
            {groups.map((g) => (
              <div key={g.term + g.ended}>
                {/* Pale blue with navy text: 10.8 to 1 contrast, well over the 4.5 to 1 needed. */}
                <div className="sticky top-0 z-10 bg-[#dbe7fb] text-[#0a2a6b] text-[12px] font-black uppercase tracking-wider px-3 py-1.5">
                  {g.term}
                  <span className="ml-2 font-normal normal-case tracking-normal">
                    {g.term === NO_TERM_GROUP ? 'master and template courses · ' : g.ended ? 'ended · ' : ''}
                    {g.courses.length}
                  </span>
                </div>
                {g.courses.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setOpen(false)
                      onChoose(`${site}/courses/${c.id}`)
                    }}
                    className="w-full flex items-center gap-2.5 text-left border-t border-gray-100 px-3 py-2 hover:bg-blue-50 focus:outline-none focus-visible:bg-blue-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                  >
                    <span className="flex-1 min-w-0">
                      <b className="block text-[13.5px]">{c.name}</b>
                      {c.code && <small className="text-xs text-gray-600">{c.code}</small>}
                    </span>
                    {c.blueprint && (
                      <span className="text-[11px] font-black rounded-full px-2 py-0.5 bg-gray-100 text-gray-800">Blueprint</span>
                    )}
                    <span className={`text-[11px] font-black rounded-full px-2 py-0.5 ${ROLE_STYLE[c.role]}`}>
                      {ROLE_LABEL[c.role]}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-gray-600 mt-2.5" role="status" aria-live="polite">
        {open && courses
          ? `Showing ${shown} course${shown === 1 ? '' : 's'} where you are a teacher, TA or designer. Student courses are not listed.`
          : ''}
      </p>
    </div>
  )
}
