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

  /*
    The real one, cell for cell, from a document a tester edited in Google Docs: the criterion's
    name in bold, the typed line under it, then the description that was already there. Three
    paragraphs in one cell, which is what Google's export makes of it.

    Where that line lands is worth stating, because it is not where the person typing it expects.
    It joins the criterion's description — so Canvas puts it in the criterion's long description,
    behind the "view longer description" link, rather than on the face of the rubric. Arriving
    and being visible are different things.
  */
  it("carries a line typed under the criterion's name, as its long description", () => {
    const edited = `
      <h1>Part 1: Systems Analysis</h1>
      <table>
      <tr><th>Criteria</th><th>Exemplary</th><th>Proficient</th><th>Developing</th>
          <th>Unsatisfactory</th><th>Points</th></tr>
      <tr>
        <td><p><span style="font-weight:700">Research and Fact-Finding</span></p>
            <p><span>I MADE A MANUAL CHANGE</span></p>
            <p><span>Thoroughness and reliability of data gathered.</span></p></td>
        <td><p><span>32-27</span></p><p><span>Provides comprehensive evidence.</span></p></td>
        <td><p><span>27-18</span></p><p><span>Provides solid evidence.</span></p></td>
        <td><p><span>18-9</span></p><p><span>Relies on superficial research.</span></p></td>
        <td><p><span>9-0</span></p><p><span>Fails to provide adequate research.</span></p></td>
        <td><p><span>32 points</span></p></td>
      </tr>
      </table>`

    const [read] = parseRubricsFromHtml(edited)
    expect(read.criteria[0].category).toBe('Research and Fact-Finding')
    expect(read.criteria[0].description).toBe(
      'I MADE A MANUAL CHANGE Thoroughness and reliability of data gathered.',
    )

    const payload = buildRubricPayload(generateCsvFromRubricObject(read, 'ranges'), '82')
    if (!payload.ok) throw new Error(payload.message)
    const criteria = Object.values(
      (payload.payload as { rubric: { criteria: Record<string, { long_description: string }> } })
        .rubric.criteria,
    )
    expect(criteria[0].long_description).toBe(
      'I MADE A MANUAL CHANGE Thoroughness and reliability of data gathered.',
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
