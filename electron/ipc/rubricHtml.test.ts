import { describe, it, expect } from 'vitest'
import { escapeHtml, buildRubricTable, buildRubricHtml, buildRubricSetHtml, rubricFileName } from './rubricHtml'
import type { RubricData } from './geminiTypes'

const rubric: RubricData = {
  title: 'Essay Rubric',
  totalPoints: 20,
  criteria: [
    {
      category: 'Clarity',
      description: 'Is the argument clear?',
      exemplary: { text: 'Very clear', points: '10' },
      proficient: { text: 'Mostly clear', points: '7' },
      developing: { text: 'Somewhat unclear', points: '4' },
      unsatisfactory: { text: 'Unclear', points: '0' },
      totalPoints: 10,
    },
    {
      category: 'Evidence',
      description: '',
      exemplary: { text: 'Well sourced', points: '10' },
      proficient: { text: 'Mostly sourced', points: '7' },
      developing: { text: 'Thin', points: '4' },
      unsatisfactory: { text: 'Absent', points: '0' },
      totalPoints: 10,
    },
  ],
}

describe('escapeHtml', () => {
  it('escapes the characters that would corrupt the table', () => {
    expect(escapeHtml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;')
  })

  it('escapes the ampersand first, so escapes are not double-escaped', () => {
    expect(escapeHtml('<')).toBe('&lt;')
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })

  it('survives null and undefined', () => {
    expect(escapeHtml(undefined as unknown as string)).toBe('')
    expect(escapeHtml(null as unknown as string)).toBe('')
  })
})

describe('buildRubricTable', () => {
  const html = buildRubricTable(rubric)

  // The regression this whole file exists to prevent. Google Docs takes column widths from the
  // first row without expanding spans, so a spanned header leaves later columns with no width.
  it('has no rowspan or colspan in the header row', () => {
    const headerRow = html.slice(html.indexOf('<tr>'), html.indexOf('</tr>'))
    expect(headerRow).not.toMatch(/rowspan/i)
    expect(headerRow).not.toMatch(/colspan/i)
  })

  it('declares one flat header cell per real column', () => {
    const headerRow = html.slice(html.indexOf('<tr>'), html.indexOf('</tr>'))
    expect((headerRow.match(/<th/g) ?? []).length).toBe(6)
    for (const label of ['Criteria', 'Exemplary', 'Proficient', 'Developing', 'Unsatisfactory', 'Points']) {
      expect(headerRow).toContain(`>${label}</th>`)
    }
  })

  it('declares a colgroup with one col per column, summing to 100%', () => {
    const colgroup = html.slice(html.indexOf('<colgroup>'), html.indexOf('</colgroup>'))
    const widths = [...colgroup.matchAll(/width:([\d.]+)%/g)].map((m) => Number(m[1]))
    expect(widths).toHaveLength(6)
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5)
  })

  it('renders one row per criterion, plus header and footer', () => {
    expect((html.match(/<tr>/g) ?? []).length).toBe(2 + rubric.criteria.length)
  })

  it('includes each criterion and its ratings', () => {
    expect(html).toContain('Clarity')
    expect(html).toContain('Is the argument clear?')
    expect(html).toContain('Very clear')
    expect(html).toContain('Well sourced')
  })

  it('puts the total in the footer', () => {
    expect(html).toContain('Total Points')
    expect(html).toContain('<strong>20 points</strong>')
  })

  it('escapes generated rubric text rather than emitting it as markup', () => {
    const risky: RubricData = {
      ...rubric,
      title: 'Q & A',
      criteria: [
        {
          ...rubric.criteria[0],
          category: 'Use of <em>emphasis</em>',
          description: 'Marks & symbols',
          exemplary: { text: '<script>alert(1)</script>', points: '10' },
        },
      ],
    }
    const out = buildRubricTable(risky)
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('Use of &lt;em&gt;emphasis&lt;/em&gt;')
    expect(out).toContain('Marks &amp; symbols')
  })

  it('renders an empty cell rather than failing when a rating is missing', () => {
    const sparse: RubricData = {
      ...rubric,
      criteria: [{ ...rubric.criteria[0], exemplary: undefined as never }],
    }
    expect(() => buildRubricTable(sparse)).not.toThrow()
  })

  it('handles a rubric with no criteria at all', () => {
    const empty: RubricData = { title: 'Empty', totalPoints: 0, criteria: [] }
    const out = buildRubricTable(empty)
    expect(out).toContain('Total Points')
    expect((out.match(/<tr>/g) ?? []).length).toBe(2)
  })
})

describe('buildRubricHtml', () => {
  it('wraps the table in a complete document with the title', () => {
    const html = buildRubricHtml(rubric)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>Essay Rubric</title>')
    expect(html).toContain('<table')
    expect(html).toContain('</body></html>')
  })

  it('escapes the title in both the tag and the heading', () => {
    const html = buildRubricHtml({ ...rubric, title: 'A & B <c>' })
    expect(html).toContain('<title>A &amp; B &lt;c&gt;</title>')
    expect(html).not.toContain('<c>')
  })

  it('asks for landscape, since six columns portrait squeezes the descriptions', () => {
    expect(buildRubricHtml(rubric)).toContain('size: landscape')
  })
})

describe('rubricFileName', () => {
  it('turns a title into a safe filename', () => {
    expect(rubricFileName({ ...rubric, title: 'Essay Rubric' }, 'html')).toBe('Essay_Rubric.html')
  })

  it('strips characters Windows refuses in a filename', () => {
    expect(rubricFileName({ ...rubric, title: 'A/B:C*D?E"F' }, 'html')).toBe('ABCDEF.html')
  })

  it('falls back to a default when the title reduces to nothing', () => {
    expect(rubricFileName({ ...rubric, title: '///' }, 'html')).toBe('Rubric.html')
    expect(rubricFileName({ ...rubric, title: '' }, 'html')).toBe('Rubric.html')
  })

  it('does not produce a leading-dot hidden file', () => {
    expect(rubricFileName({ ...rubric, title: '...hidden' }, 'html').startsWith('.')).toBe(false)
  })

  it('caps a very long title', () => {
    const name = rubricFileName({ ...rubric, title: 'x'.repeat(300) }, 'html')
    expect(name.length).toBeLessThanOrEqual(85)
  })
})

describe('buildRubricSetHtml', () => {
  const second: RubricData = { ...rubric, title: 'Presentation Rubric' }

  it('puts every rubric in one document, each with its own heading', () => {
    const html = buildRubricSetHtml([rubric, second])
    expect(html).toContain('Essay Rubric')
    expect(html).toContain('Presentation Rubric')
    expect((html.match(/<table/g) ?? []).length).toBe(2)
  })

  /** Without this the tables run together and read as one long rubric. */
  it('starts each rubric after the first on a new page', () => {
    const html = buildRubricSetHtml([rubric, second])
    expect((html.match(/page-break-before:always/g) ?? []).length).toBe(1)
  })

  it('escapes titles, which are AI-written and user-edited', () => {
    const html = buildRubricSetHtml([{ ...rubric, title: 'A & B <script>' }])
    expect(html).toContain('A &amp; B &lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('takes a document title when one is given, and falls back when not', () => {
    expect(buildRubricSetHtml([rubric, second], 'Wicked Problems')).toContain(
      '<title>Wicked Problems</title>',
    )
    expect(buildRubricSetHtml([rubric, second])).toContain('<title>Essay Rubric</title>')
  })

  it('handles a single rubric without a page break', () => {
    expect(buildRubricSetHtml([rubric])).not.toContain('page-break-before')
  })
})

describe('buildRubricSetHtml heading structure', () => {
  const second: RubricData = { ...rubric, title: 'Presentation Rubric' }

  /**
   * Google Docs imported only the first rubric's title as Heading 1. The later ones sat inside
   * `<div style="page-break-before:always;">`, and Docs flattens a styled block container and
   * loses the heading mapping of its contents. A heading wrapped in a styled div is the shape
   * that caused it, so it is the shape pinned against.
   */
  it('never wraps a heading in a styled container', () => {
    const html = buildRubricSetHtml([rubric, second])
    expect(html).not.toMatch(/<div[^>]*style[^>]*>\s*<h1/)
  })

  it('carries the page break on the heading itself', () => {
    const html = buildRubricSetHtml([rubric, second])
    expect(html).toMatch(/<h1 style="page-break-before:always;/)
  })

  it('gives every rubric an h1', () => {
    const html = buildRubricSetHtml([rubric, second, { ...rubric, title: 'Third' }])
    expect((html.match(/<h1/g) ?? []).length).toBe(3)
  })
})
