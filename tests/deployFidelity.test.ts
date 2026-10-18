import { describe, it, expect } from 'vitest'
import { buildRubricSetHtml } from '../electron/ipc/rubricHtml'
import { parseRubricsFromHtml } from '../electron/ipc/rubricHtmlParse'
import { buildRubricPayload } from '../electron/ipc/canvasUtils'
import { generateCsvFromRubricObject } from '../src/utils/rubricCsv'
import type { RubricData } from '../electron/ipc/geminiTypes'

/**
 * The whole journey, end to end: what is in the Google Doc is what reaches Canvas.
 *
 * ── Why this one test lives outside src/ and electron/ ──
 *
 * It is the only test that spans both. The two halves of this app compile as separate TypeScript
 * projects on purpose — the main process is built without DOM types, which is why geminiTypes.ts
 * exists as a deliberate copy — and each project lists only its own directory. A file importing
 * from both therefore belongs to neither, and putting it in either one would mean widening a
 * boundary that is there for a reason.
 *
 * So it sits here, where vitest finds it and neither tsconfig claims it. The cost is that `npm
 * run typecheck` does not cover this file; the chain it guards is checked every time the tests
 * run, which is what matters. The narrower round-trip test in electron/ipc/rubricHtmlParse.test.ts
 * is fully typechecked and covers the link that was actually broken.
 *
 * The claim this app lives or dies by, and until now nothing held it to account. The chain has
 * four links — the document is read, the rubrics become a Canvas CSV, the CSV becomes the
 * payload Canvas is sent, and Canvas renders it — and three of them are in this repository. This
 * walks all three with one rubric and requires every word and every number to arrive.
 *
 * It is deliberately not a unit test of any one step. Each of those already has its own, and
 * each passed while a hand-typed line was being lost between them: the fault was never inside a
 * link, it was that nobody had checked the chain end to end.
 *
 * The one difference it does allow is the one that is on purpose. A criterion description that
 * duplicates its own top rating is sent empty, because the AI used to copy the top rating into
 * the description and a course developer was deleting it by hand on every criterion of every
 * rubric. It fires only on an exact match, which is why it needs a test of its own below rather
 * than an exception in the main one.
 */
const rubric: RubricData = {
  title: 'Part 1: Systems Analysis',
  criteria: [
    {
      category: 'Research & Fact-Finding',
      description: 'Gathering relevant facts, identifying unknowns — in full.',
      exemplary: { text: 'Provides exceptionally thorough, "primary" sources.', points: '26-21' },
      proficient: { text: 'Gathers solid, relevant facts.', points: '21-11' },
      developing: { text: 'Includes limited factual research.', points: '11-4' },
      unsatisfactory: { text: "Doesn't gather facts at all.", points: '4-0' },
      totalPoints: 26,
    },
    {
      category: 'Stakeholder Mapping',
      description: '',
      exemplary: { text: 'Maps all relevant groups.', points: '24' },
      proficient: { text: 'Maps most groups.', points: '18' },
      developing: { text: 'Maps a few groups.', points: '9' },
      unsatisfactory: { text: 'Maps none.', points: '0' },
      totalPoints: 24,
    },
  ],
  totalPoints: 50,
}

/** Document → app → CSV → the object posted to Canvas. */
function throughTheWholeChain(source: RubricData, edit?: (html: string) => string) {
  const html = edit ? edit(buildRubricSetHtml([source])) : buildRubricSetHtml([source])
  const [read] = parseRubricsFromHtml(html)
  const csv = generateCsvFromRubricObject(read, 'ranges')
  const payload = buildRubricPayload(csv, '123')
  if (!payload.ok) throw new Error(payload.message)
  return { read, payload }
}

describe('what is in the document is what reaches Canvas', () => {
  it('carries every criterion, rating and point value through to the payload', () => {
    const { payload } = throughTheWholeChain(rubric)
    const criteria = Object.values(
      (payload.payload as { rubric: { criteria: Record<string, unknown> } }).rubric.criteria,
    ) as Array<{
      description: string
      long_description: string
      ratings: Record<string, { description: string; long_description: string; points: number }>
    }>

    expect(criteria).toHaveLength(2)

    expect(criteria[0].description).toBe('Research & Fact-Finding')
    expect(criteria[0].long_description).toBe(
      'Gathering relevant facts, identifying unknowns — in full.',
    )
    expect(Object.values(criteria[0].ratings).map((r) => r.long_description)).toEqual([
      'Provides exceptionally thorough, "primary" sources.',
      'Gathers solid, relevant facts.',
      'Includes limited factual research.',
      "Doesn't gather facts at all.",
    ])
    /* The top of each band, which is what Canvas stores and grades on. */
    expect(Object.values(criteria[0].ratings).map((r) => r.points)).toEqual([26, 21, 11, 4])

    expect(criteria[1].description).toBe('Stakeholder Mapping')
    expect(Object.values(criteria[1].ratings).map((r) => r.points)).toEqual([24, 18, 9, 0])
  })

  /*
    The failure that prompted all of this. A line typed into a cell in Google Docs reached the
    app through a plain-text export and an AI reconstruction, and arrived in Canvas gone.
  */
  it('carries a line typed into the document by hand all the way to Canvas', () => {
    const { payload } = throughTheWholeChain(rubric, (html) =>
      html.replace(
        'Gathering relevant facts, identifying unknowns — in full.',
        'Gathering relevant facts, identifying unknowns — in full. MANUAL EDIT #1',
      ),
    )
    const criteria = Object.values(
      (payload.payload as { rubric: { criteria: Record<string, { long_description: string }> } })
        .rubric.criteria,
    )
    expect(criteria[0].long_description).toBe(
      'Gathering relevant facts, identifying unknowns — in full. MANUAL EDIT #1',
    )
  })

  it('carries a criterion added to the document by hand', () => {
    const { read, payload } = throughTheWholeChain(rubric, (html) =>
      html.replace(
        '</table>',
        '<tr>' +
          '<td><strong>APA formatting</strong><div>Added in Google Docs.</div></td>' +
          '<td><div>10</div>Flawless.</td>' +
          '<td><div>7</div>Minor errors.</td>' +
          '<td><div>4</div>Several errors.</td>' +
          '<td><div>0</div>Absent.</td>' +
          '<td>10 points</td>' +
          '</tr></table>',
      ),
    )
    expect(read.criteria).toHaveLength(3)
    const criteria = Object.values(
      (payload.payload as { rubric: { criteria: Record<string, { description: string }> } }).rubric
        .criteria,
    )
    expect(criteria.map((c) => c.description)).toContain('APA formatting')
  })

  /*
    The one deliberate difference, pinned so it stays deliberate: an exact duplicate of the top
    rating is dropped, and anything else is kept.
  */
  it('drops a criterion description only when it duplicates the top rating exactly', () => {
    const duplicated: RubricData = {
      ...rubric,
      criteria: [{ ...rubric.criteria[0], description: rubric.criteria[0].exemplary.text }],
    }
    const { payload } = throughTheWholeChain(duplicated)
    const criteria = Object.values(
      (payload.payload as { rubric: { criteria: Record<string, { long_description: string }> } })
        .rubric.criteria,
    )
    expect(criteria[0].long_description).toBe('')
  })
})
