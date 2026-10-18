/**
 * Read rubrics back out of the HTML of a document the app wrote.
 *
 * The other half of rubricHtml.ts, and the reason it exists: the Google Doc is the thing people
 * edit, so it has to be the thing the app reads. Until now the only way back in was to export
 * the document as plain text and ask Gemini to work out from a wall of words which of them had
 * been a criterion, which a rating, and which a number. That is a reconstruction, not a reading,
 * and it lost things — a hand-typed marker in the middle of a cell came back gone, because
 * nothing in flattened text says it was ever content.
 *
 * Exporting the document as HTML keeps the table, and the table is the rubric. Parsing it is
 * exact, costs nothing, needs no model, and cannot drift between runs.
 *
 * ── Why this does not look for the app's own markup ──
 *
 * Drive does not hand back what was uploaded. The HTML goes to Drive, Drive converts it into a
 * native Google Doc, and an export converts that back into Google's own HTML: its classes, its
 * inline styles, `<strong>` re-expressed as a styled `<span>`, every cell wrapped in `<p>`. None
 * of the markup written by rubricHtml.ts survives that round trip.
 *
 * What does survive is the structure, because a table stays a table and a heading stays a
 * heading. So this keys off the shape: a table whose header row reads Criteria, the four rating
 * levels, Points, under a heading that names the rubric. That holds for a document the app wrote
 * however Google chooses to re-express it, and it has a second benefit — a criterion row typed
 * in by hand is simply another row, and arrives as a criterion.
 *
 * ── Why a table that does not fit is an error ──
 *
 * A rubric that reaches Canvas wrong is worse than one that does not reach it at all: it grades
 * students. So a table whose header is not recognised is reported rather than guessed at, and
 * nothing here falls back to asking a model to have a go. The caller decides what to do about a
 * document this cannot read; it never receives a plausible invention.
 */
import type { RubricData, RubricCriterion, RubricRating } from './geminiTypes'

const RATING_LEVELS = ['exemplary', 'proficient', 'developing', 'unsatisfactory'] as const

/** What `parseRubricsFromHtml` could not read, in the words the user needs to fix it. */
export class RubricHtmlError extends Error {}

/**
 * Entities, including the numeric forms Google's exporter favours.
 *
 * `&amp;` is last deliberately: decoding it first would turn `&amp;lt;` into `<`, inventing
 * markup out of text that said "&lt;".
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

/**
 * A cell's text, split into the lines it was laid out as.
 *
 * The split is what carries the meaning here, which is why this does not simply strip tags and
 * return a string. rubricHtml.ts puts a criterion's name and its description in one cell, and a
 * rating's points and its descriptor in one cell, separated by a block element in each case. The
 * boundary between them is a line break, and after Google's conversion it is a `<p>` boundary
 * rather than the `<div>` or `<strong>` that was written — so the blocks are what this reads,
 * never the styling.
 */
function cellLines(html: string): string[] {
  /*
    Both ends of a block, not just the closing tag. rubricHtml.ts writes a criterion as
    `<strong>Name</strong><div>Description</div>`, where the only thing between the two is the
    opening `<div>` — break on the closing tag alone and the name and the description come back
    as one run of words with no space between them.
  */
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')

  return decodeEntities(withBreaks)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
}

/** A cell's text as one string, for the places where the layout carries nothing. */
function cellText(html: string): string {
  return cellLines(html).join(' ')
}

function matchAll(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((match) => match[1] ?? '')
}

const ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi
const CELL = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi

/**
 * Whether a row is the header this parser recognises.
 *
 * Six columns, in the order rubricHtml.ts writes them. Compared case-insensitively and with
 * whitespace collapsed, because Google's export is free to re-case and re-space anything, but
 * not reordered or guessed at: a table whose columns are in a different order is a different
 * table, and reading it as this one would put rating text under the wrong level.
 */
function isHeaderRow(cells: string[]): boolean {
  if (cells.length !== RATING_LEVELS.length + 2) return false
  const text = cells.map((cell) => cellText(cell).toLowerCase())
  return (
    text[0] === 'criteria' &&
    RATING_LEVELS.every((level, i) => text[i + 1] === level) &&
    text[text.length - 1] === 'points'
  )
}

/** The closing row, which states the total rather than a criterion. */
function isTotalRow(cells: string[]): boolean {
  return cells.length > 0 && /^total points\b/i.test(cellText(cells[0]))
}

/**
 * A rating cell: its points, then its descriptor.
 *
 * The first line is the points only when it reads as points. A rating whose descriptor happens
 * to start with a number is ordinary — "4 or more citations are missing" — so the test is the
 * whole line, anchored at both ends, not a number appearing somewhere in it.
 *
 * The notations are the ones Canvas and real rubrics use, and the same ones parseRatingPoints
 * accepts on the way out: a band ("26-21", "26 to >21", "26 to >21 pts"), a single value, and
 * either with a "points"/"pts" suffix.
 */
const POINTS_LINE =
  /^\d+(?:\.\d+)?\s*(?:(?:-|–|—|to)\s*>?\s*\d+(?:\.\d+)?)?\s*(?:points?|pts?\.?)?$/i

function parseRating(cellHtml: string): RubricRating {
  const lines = cellLines(cellHtml)
  if (lines.length === 0) return { text: '', points: '' }
  if (POINTS_LINE.test(lines[0])) {
    return { points: lines[0], text: lines.slice(1).join(' ') }
  }
  return { points: '', text: lines.join(' ') }
}

/** The number in "26 points", or in "26". */
function parsePointsCell(cellHtml: string): number {
  const match = cellText(cellHtml).match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

/**
 * A criterion row.
 *
 * The first line of the first cell is the criterion's name and everything after it is its
 * description — the layout rubricHtml.ts writes, read back as laid out. A cell holding one line
 * is a criterion with no description of its own, which is most of them.
 */
function parseCriterion(cells: string[]): RubricCriterion {
  const lines = cellLines(cells[0])
  const ratings = RATING_LEVELS.map((_, i) => parseRating(cells[i + 1]))

  return {
    category: lines[0] ?? '',
    description: lines.slice(1).join(' '),
    exemplary: ratings[0],
    proficient: ratings[1],
    developing: ratings[2],
    unsatisfactory: ratings[3],
    totalPoints: parsePointsCell(cells[cells.length - 1]),
  }
}

/** The heading nearest above a table, which is the rubric's title. */
const HEADING = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi
const TABLE = /<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi

interface Block {
  kind: 'heading' | 'table'
  at: number
  text: string
}

function documentBlocks(html: string): Block[] {
  const blocks: Block[] = []
  for (const match of html.matchAll(HEADING)) {
    blocks.push({ kind: 'heading', at: match.index ?? 0, text: cellText(match[2]) })
  }
  for (const match of html.matchAll(TABLE)) {
    blocks.push({ kind: 'table', at: match.index ?? 0, text: match[1] })
  }
  return blocks.sort((a, b) => a.at - b.at)
}

/**
 * Every rubric in a document, in the order it appears.
 *
 * Throws RubricHtmlError rather than returning what it managed, because a partial read is the
 * dangerous answer: a rubric silently missing a criterion deploys to Canvas looking complete.
 */
export function parseRubricsFromHtml(html: string): RubricData[] {
  const blocks = documentBlocks(html)
  const rubrics: RubricData[] = []
  let lastHeading = ''
  let tablesSeen = 0

  for (const block of blocks) {
    if (block.kind === 'heading') {
      lastHeading = block.text
      continue
    }

    tablesSeen += 1
    const rows = matchAll(block.text, ROW).map((row) => matchAll(row, CELL))
    const headerAt = rows.findIndex(isHeaderRow)
    if (headerAt === -1) {
      throw new RubricHtmlError(
        `A table in this document is not laid out as a rubric the app can read. It needs the ` +
          `columns Criteria, Exemplary, Proficient, Developing, Unsatisfactory and Points, in ` +
          `that order. If you changed the table itself — removed a column, or merged cells — ` +
          `undo that and try again.`,
      )
    }

    const criteria = rows
      .slice(headerAt + 1)
      .filter((cells) => !isTotalRow(cells))
      .filter((cells) => cells.length === RATING_LEVELS.length + 2)
      .filter((cells) => cells.some((cell) => cellText(cell).length > 0))
      .map(parseCriterion)

    if (criteria.length === 0) {
      throw new RubricHtmlError(
        `"${lastHeading || 'A rubric'}" in this document has no criteria the app can read. ` +
          `Check that its table still has a row for each criterion.`,
      )
    }

    rubrics.push({
      title: lastHeading,
      criteria,
      /*
        Added up from the criteria rather than read from the Total Points row, for the reason
        rubricHtml.ts states on the way out: only the rating strings reach Canvas, so a total
        taken from anywhere else is a second number free to disagree with the rubric.
      */
      totalPoints: criteria.reduce((sum, c) => sum + c.totalPoints, 0),
    })
    lastHeading = ''
  }

  if (tablesSeen === 0) {
    throw new RubricHtmlError(
      'No rubric tables were found in that document. Check that it is the rubric document ' +
        'rather than the assignment description.',
    )
  }

  return rubrics
}
