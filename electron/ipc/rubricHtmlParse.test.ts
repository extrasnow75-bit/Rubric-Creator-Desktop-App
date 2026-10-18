import { describe, it, expect } from 'vitest'
import { buildRubricSetHtml, buildRubricHtml } from './rubricHtml'
import { parseRubricsFromHtml, RubricHtmlError } from './rubricHtmlParse'
import type { RubricData } from './geminiTypes'

/**
 * The round trip is the guarantee this app rests on.
 *
 * What reaches Canvas has to be what is in the Google Doc, or the app is worse than useless: it
 * grades students with a rubric nobody approved. Every step between the two is deterministic
 * except the reading, and these tests are what hold the reading to the same standard — write a
 * rubric out as the document is written, read it back, and require the two to be identical.
 *
 * The awkward content is deliberate. Commas and quotation marks inside cells, an ampersand in a
 * criterion name, curly punctuation, a rating genuinely worth zero: each is a real thing a real
 * rubric contains, and each is a way an escape or a split can go wrong without anyone noticing
 * until a rubric is already in a course.
 */
function criterion(over: Partial<RubricData['criteria'][0]> = {}) {
  return {
    category: 'Research and Fact-Finding',
    description: 'Gathering relevant facts and identifying unknowns.',
    exemplary: { text: 'Provides exceptionally thorough facts.', points: '26-21' },
    proficient: { text: 'Gathers solid, relevant facts.', points: '21-11' },
    developing: { text: 'Includes limited factual research.', points: '11-4' },
    unsatisfactory: { text: 'Lacks sufficient factual research.', points: '4-0' },
    totalPoints: 26,
    ...over,
  }
}

const rubric: RubricData = {
  title: 'Part 1: Systems Analysis',
  criteria: [criterion(), criterion({ category: 'Stakeholder Mapping', description: '' })],
  totalPoints: 52,
}

describe('parseRubricsFromHtml', () => {
  it('reads back a rubric exactly as it was written', () => {
    const [read] = parseRubricsFromHtml(buildRubricHtml(rubric))
    expect(read).toEqual(rubric)
  })

  it('reads back every rubric in a set, in order, with their own titles', () => {
    const second: RubricData = { ...rubric, title: 'Part 2: Ethical Frameworks' }
    const html = buildRubricSetHtml([rubric, second], 'Wicked Problems')
    const read = parseRubricsFromHtml(html)

    expect(read.map((r) => r.title)).toEqual([
      'Part 1: Systems Analysis',
      'Part 2: Ethical Frameworks',
    ])
    expect(read).toEqual([rubric, second])
  })

  /*
    The document's own heading is not a rubric. A set titles itself first and each rubric after,
    so the heading nearest above each table is the one that names it — taking the first heading
    in the document would label every rubric with the set's name.
  */
  it('does not mistake the document title for the first rubric name', () => {
    const html = buildRubricSetHtml([rubric, { ...rubric, title: 'Part 2' }], 'Wicked Problems')
    expect(parseRubricsFromHtml(html)[0].title).toBe('Part 1: Systems Analysis')
  })

  it('survives punctuation that HTML or a split could eat', () => {
    const awkward: RubricData = {
      title: 'Ethics, Evidence & "Rigour"',
      criteria: [
        criterion({
          category: 'Sources & Citations',
          description: 'Uses quotation marks, commas, and an ampersand: A & B.',
          exemplary: { text: 'Cites "primary" sources — consistently, and in full.', points: '10' },
          unsatisfactory: { text: "Doesn't cite anything at all.", points: '0' },
          totalPoints: 10,
        }),
      ],
      totalPoints: 10,
    }
    expect(parseRubricsFromHtml(buildRubricHtml(awkward))).toEqual([awkward])
  })

  /*
    A rating worth nothing is a real rating, and the one most easily lost: "0" is falsy, and an
    empty points cell and a zero-point cell look the same to anything that tests for truthiness.
  */
  it('keeps a rating that is genuinely worth zero', () => {
    const [read] = parseRubricsFromHtml(buildRubricHtml(rubric))
    expect(read.criteria[0].unsatisfactory.points).toBe('4-0')
  })

  it('keeps a criterion that has no description of its own', () => {
    const [read] = parseRubricsFromHtml(buildRubricHtml(rubric))
    expect(read.criteria[1].description).toBe('')
    expect(read.criteria[1].category).toBe('Stakeholder Mapping')
  })

  /*
    The case this whole change exists for: a line typed into a cell by hand in Google Docs. The
    plain-text route lost one of these, because nothing in a flattened wall of words said it had
    ever been part of a criterion.
  */
  it('keeps text added to a cell by hand', () => {
    const html = buildRubricHtml(rubric).replace(
      'Gathering relevant facts and identifying unknowns.',
      'Gathering relevant facts and identifying unknowns. MANUAL EDIT #1',
    )
    const [read] = parseRubricsFromHtml(html)
    expect(read.criteria[0].description).toBe(
      'Gathering relevant facts and identifying unknowns. MANUAL EDIT #1',
    )
  })

  /*
    Google does not give back the HTML it was given: the document is converted on the way in and
    re-expressed on the way out, with its own classes, `<strong>` as a styled span, and every
    cell wrapped in a paragraph. This is that shape, written by hand, because the parser has to
    read the document as Google returns it rather than as the app wrote it.
  */
  it("reads Google's own export shape, not just the app's markup", () => {
    const googleish = `
      <html><body>
        <h1 class="c4"><span class="c2">Part 1: Systems Analysis</span></h1>
        <table class="c9">
          <tr class="c1">
            <td class="c0"><p class="c3"><span class="c2">Criteria</span></p></td>
            <td class="c0"><p class="c3"><span class="c2">Exemplary</span></p></td>
            <td class="c0"><p class="c3"><span class="c2">Proficient</span></p></td>
            <td class="c0"><p class="c3"><span class="c2">Developing</span></p></td>
            <td class="c0"><p class="c3"><span class="c2">Unsatisfactory</span></p></td>
            <td class="c0"><p class="c3"><span class="c2">Points</span></p></td>
          </tr>
          <tr class="c1">
            <td class="c0">
              <p class="c3"><span style="font-weight:700">Research &amp; Fact-Finding</span></p>
              <p class="c3"><span class="c2">Gathering relevant facts.</span></p>
            </td>
            <td class="c0"><p class="c3"><span>26-21</span></p><p class="c3"><span>Thorough.</span></p></td>
            <td class="c0"><p class="c3"><span>21-11</span></p><p class="c3"><span>Solid.</span></p></td>
            <td class="c0"><p class="c3"><span>11-4</span></p><p class="c3"><span>Limited.</span></p></td>
            <td class="c0"><p class="c3"><span>4-0</span></p><p class="c3"><span>Lacking.</span></p></td>
            <td class="c0"><p class="c3"><span>26 points</span></p></td>
          </tr>
          <tr class="c1">
            <td class="c0" colspan="5"><p class="c3"><span>Total Points</span></p></td>
            <td class="c0"><p class="c3"><span>26 points</span></p></td>
          </tr>
        </table>
      </body></html>`

    expect(parseRubricsFromHtml(googleish)).toEqual([
      {
        title: 'Part 1: Systems Analysis',
        criteria: [
          {
            category: 'Research & Fact-Finding',
            description: 'Gathering relevant facts.',
            exemplary: { text: 'Thorough.', points: '26-21' },
            proficient: { text: 'Solid.', points: '21-11' },
            developing: { text: 'Limited.', points: '11-4' },
            unsatisfactory: { text: 'Lacking.', points: '4-0' },
            totalPoints: 26,
          },
        ],
        totalPoints: 26,
      },
    ])
  })

  /*
    A row added by hand is a criterion. This is new ground rather than a regression guard: under
    the plain-text route there was no way to add a criterion in the document and have the app
    see it.
  */
  it('reads a criterion row added by hand', () => {
    const html = buildRubricHtml(rubric).replace(
      '</table>',
      '<tr>' +
        '<td><strong>APA formatting</strong><div>Added in Google Docs.</div></td>' +
        '<td><div>10</div>Flawless.</td>' +
        '<td><div>7</div>Minor errors.</td>' +
        '<td><div>4</div>Several errors.</td>' +
        '<td><div>0</div>Absent.</td>' +
        '<td>10 points</td>' +
        '</tr></table>',
    )
    const [read] = parseRubricsFromHtml(html)
    expect(read.criteria).toHaveLength(3)
    expect(read.criteria[2]).toEqual({
      category: 'APA formatting',
      description: 'Added in Google Docs.',
      exemplary: { text: 'Flawless.', points: '10' },
      proficient: { text: 'Minor errors.', points: '7' },
      developing: { text: 'Several errors.', points: '4' },
      unsatisfactory: { text: 'Absent.', points: '0' },
      totalPoints: 10,
    })
  })

  /*
    A descriptor that opens with a number is ordinary writing, not a points cell. Treating it as
    one would silently delete the first sentence of a rating.
  */
  it('does not read a descriptor starting with a number as points', () => {
    const numeric: RubricData = {
      ...rubric,
      criteria: [
        criterion({
          exemplary: { text: '4 or more sources are cited in full.', points: '10' },
          totalPoints: 10,
        }),
      ],
    }
    const [read] = parseRubricsFromHtml(buildRubricHtml(numeric))
    expect(read.criteria[0].exemplary).toEqual({
      text: '4 or more sources are cited in full.',
      points: '10',
    })
  })

  it('refuses a table whose columns are not a rubric', () => {
    const wrong =
      '<h1>Part 1</h1><table>' +
      '<tr><th>Criteria</th><th>Great</th><th>Fine</th><th>Poor</th></tr>' +
      '<tr><td>Research</td><td>a</td><td>b</td><td>c</td></tr>' +
      '</table>'
    expect(() => parseRubricsFromHtml(wrong)).toThrow(RubricHtmlError)
    expect(() => parseRubricsFromHtml(wrong)).toThrow(/Criteria, Exemplary/)
  })

  it('refuses a document with no table at all', () => {
    expect(() => parseRubricsFromHtml('<h1>Assignment description</h1><p>Write an essay.</p>')).toThrow(
      /No rubric tables/,
    )
  })

  it('refuses a rubric table that has lost its criteria', () => {
    const empty =
      '<h1>Part 1</h1><table>' +
      '<tr><th>Criteria</th><th>Exemplary</th><th>Proficient</th>' +
      '<th>Developing</th><th>Unsatisfactory</th><th>Points</th></tr>' +
      '<tr><td colspan="5">Total Points</td><td>0 points</td></tr>' +
      '</table>'
    expect(() => parseRubricsFromHtml(empty)).toThrow(/no criteria/)
  })
})
