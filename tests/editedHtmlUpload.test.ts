import { describe, it, expect } from 'vitest'
import { buildRubricSetHtml } from '../electron/ipc/rubricHtml'
import { parseRubricsFromHtml } from '../electron/ipc/rubricHtmlParse'
import { generateCsvFromRubricObject } from '../src/utils/rubricCsv'
import { scoringMethodOf } from '../src/utils/htmlRubricFile'
import type { RubricData } from '../electron/ipc/geminiTypes'

/**
 * The path for someone with no Google account: save the rubrics as a web page, edit the page in
 * Notepad, upload it again.
 *
 * Like deployFidelity.test.ts this spans the main process and the renderer, so it lives here and
 * not under either tsconfig. What it holds the app to: a word changed in the file is the word in
 * the CSV that goes to Canvas, and nothing else moves.
 */
const rating = (text: string, points: string) => ({ text, points })

const rubrics: RubricData[] = [
  {
    title: 'Part 1: Systems Analysis',
    totalPoints: 20,
    criteria: [
      {
        category: 'Clarity',
        description: 'How clear the writing is.',
        exemplary: rating('Exceptionally clear.', '10-9'),
        proficient: rating('Mostly clear and organised.', '9-7'),
        developing: rating('Sometimes clear.', '7-4'),
        unsatisfactory: rating('Unclear.', '4-0'),
        totalPoints: 10,
      },
      {
        category: 'Evidence',
        description: 'Use of sources.',
        exemplary: rating('Uses sources expertly.', '10-9'),
        proficient: rating('Uses sources well.', '9-7'),
        developing: rating('Uses few sources.', '7-4'),
        unsatisfactory: rating('Uses no sources.', '4-0'),
        totalPoints: 10,
      },
    ],
  },
  {
    title: 'Part 2: Reflection',
    totalPoints: 10,
    criteria: [
      {
        category: 'Insight',
        description: 'Depth of reflection.',
        exemplary: rating('Deep and personal.', '10-9'),
        proficient: rating('Thoughtful.', '9-7'),
        developing: rating('Surface level.', '7-4'),
        unsatisfactory: rating('Absent.', '4-0'),
        totalPoints: 10,
      },
    ],
  },
]

describe('an edited, saved web page', () => {
  const saved = buildRubricSetHtml(rubrics, 'Wicked Problems')

  it('reads back every rubric exactly as saved when nothing was edited', () => {
    expect(parseRubricsFromHtml(saved)).toEqual(rubrics)
  })

  it('carries a hand edit into the CSV for that rubric and changes nothing else', () => {
    const edited = saved.replace('Mostly clear and organised.', 'Mostly clear and organised, see Smith (2019), ch. 3.')
    expect(edited).not.toBe(saved)

    const read = parseRubricsFromHtml(edited)
    const csvs = read.map((r) => generateCsvFromRubricObject(r, scoringMethodOf(r)))
    const originals = rubrics.map((r) => generateCsvFromRubricObject(r, scoringMethodOf(r)))

    expect(csvs[0]).toContain('Smith (2019), ch. 3')
    expect(csvs[0]).not.toBe(originals[0])
    expect(csvs[1]).toBe(originals[1])
  })

  it('treats a file saved with the table damaged as unreadable instead of guessing', () => {
    const damaged = saved.replace(/<th[^>]*>\s*Proficient\s*<\/th>/i, '')
    expect(() => parseRubricsFromHtml(damaged)).toThrow()
  })

  it('reads ranges from the points, so the CSV keeps its ranges', () => {
    const [first] = parseRubricsFromHtml(saved)
    expect(scoringMethodOf(first)).toBe('ranges')
  })
})
