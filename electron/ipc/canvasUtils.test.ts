import { describe, it, expect } from 'vitest'
import { parseCSV, parseCourseUrl, buildRubricPayload, parseRatingPoints } from './canvasUtils'

describe('parseCSV', () => {
  it('splits a simple grid', () => {
    expect(parseCSV('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('keeps commas inside quoted fields', () => {
    // The case that makes a naive split(',') wrong on real rubric text.
    expect(parseCSV('name,desc\nClarity,"Clear, well-organised argument"')).toEqual([
      ['name', 'desc'],
      ['Clarity', 'Clear, well-organised argument'],
    ])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCSV('a\n"She said ""hello"""')).toEqual([['a'], ['She said "hello"']])
  })

  it('keeps newlines inside quoted fields', () => {
    expect(parseCSV('a,b\n"line one\nline two",x')).toEqual([
      ['a', 'b'],
      ['line one\nline two', 'x'],
    ])
  })

  it('handles CRLF line endings', () => {
    // Files that have been through Excel on Windows arrive this way.
    expect(parseCSV('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('does not emit a trailing empty row for a trailing newline', () => {
    expect(parseCSV('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('trims surrounding whitespace on each field', () => {
    expect(parseCSV('a ,  b\n 1 , 2 ')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('parseCourseUrl', () => {
  it('extracts origin and course id', () => {
    expect(parseCourseUrl('https://boisestate.instructure.com/courses/12345')).toEqual({
      origin: 'https://boisestate.instructure.com',
      host: 'boisestate.instructure.com',
      courseId: '12345',
    })
  })

  it('accepts a deep link from inside the course', () => {
    const ref = parseCourseUrl('https://school.instructure.com/courses/999/assignments/42')
    expect(ref?.courseId).toBe('999')
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseCourseUrl('  https://s.instructure.com/courses/7  ')?.courseId).toBe('7')
  })

  it('preserves a non-default port in the origin', () => {
    const ref = parseCourseUrl('https://canvas.example.edu:8443/courses/5')
    expect(ref?.origin).toBe('https://canvas.example.edu:8443')
  })

  // Everything below returns null, which means the Canvas token is never attached to a request
  // aimed at it. These are the security-relevant cases.

  it('rejects plain HTTP, which would send the token in the clear', () => {
    expect(parseCourseUrl('http://school.instructure.com/courses/1')).toBeNull()
  })

  it('rejects a URL with no course id', () => {
    expect(parseCourseUrl('https://school.instructure.com/')).toBeNull()
  })

  it('rejects unparseable input', () => {
    expect(parseCourseUrl('not a url')).toBeNull()
    expect(parseCourseUrl('')).toBeNull()
  })

  it('rejects loopback hosts', () => {
    expect(parseCourseUrl('https://localhost/courses/1')).toBeNull()
    expect(parseCourseUrl('https://127.0.0.1/courses/1')).toBeNull()
  })

  it('rejects private and link-local ranges', () => {
    expect(parseCourseUrl('https://10.0.0.5/courses/1')).toBeNull()
    expect(parseCourseUrl('https://172.16.4.4/courses/1')).toBeNull()
    expect(parseCourseUrl('https://192.168.1.1/courses/1')).toBeNull()
    // Cloud instance-metadata endpoint.
    expect(parseCourseUrl('https://169.254.169.254/courses/1')).toBeNull()
  })

  it('allows a public IPv4 host outside the private ranges', () => {
    // 172.32 is outside 172.16.0.0/12, so the range check must not over-reach.
    expect(parseCourseUrl('https://172.32.0.1/courses/1')?.courseId).toBe('1')
  })
})

describe('parseRatingPoints', () => {
  it('reads a plain value, with or without the unit', () => {
    expect(parseRatingPoints('4')).toBe(4)
    expect(parseRatingPoints('3.5')).toBe(3.5)
    expect(parseRatingPoints('  10 pts  ')).toBe(10)
    expect(parseRatingPoints('15 points')).toBe(15)
  })

  it("reads Canvas's own range notation as the top of the band", () => {
    // Straight out of a rubric copied from Canvas: "4 to >3 pts" is one rating worth 4, and the
    // ">3" is Canvas restating the next rating down. Canvas stores only the 4.
    expect(parseRatingPoints('4 to >3 pts')).toBe(4)
    expect(parseRatingPoints('1 to >0 pts')).toBe(1)
    expect(parseRatingPoints('0.5 to >0 pts')).toBe(0.5)
    expect(parseRatingPoints('15 to >10 pts')).toBe(15)
  })

  it('reads a hand-written band in either direction', () => {
    expect(parseRatingPoints('4-3.5 points')).toBe(4) // descending, as most rubrics write it
    expect(parseRatingPoints('2.4-0 points')).toBe(2.4)
    expect(parseRatingPoints('40–50 pts')).toBe(50) // ascending, en dash
    expect(parseRatingPoints('90-100')).toBe(100)
  })

  it('keeps a rating that is genuinely worth nothing', () => {
    // Distinct from unreadable. Nearly every rubric has a bottom rating worth 0.
    expect(parseRatingPoints('0')).toBe(0)
    expect(parseRatingPoints('0 pts')).toBe(0)
  })

  it('reads every form Canvas Extractor Tools writes', () => {
    // A contract between the two apps, not a guess. Extractor's ratingPointsLabel
    // (electron/ipc/rubricExport.ts) emits exactly two shapes:
    //
    //     `${upper} to >${lower} points`   when the criterion uses ranges
    //     `${upper} points`                when it does not
    //
    // and in both the number Canvas stores for that rating is `upper`. A rubric pulled out of
    // Canvas by Extractor, pasted into a document, and pushed back by this app must land on the
    // same points it started with, so these cases are the round trip.
    expect(parseRatingPoints('4 to >3 points')).toBe(4)
    expect(parseRatingPoints('3 to >2.5 points')).toBe(3)
    expect(parseRatingPoints('0.5 to >0 points')).toBe(0.5)
    expect(parseRatingPoints('10 points')).toBe(10)
    expect(parseRatingPoints('0 points')).toBe(0)
    // Older exports, and the eCampus template itself, say "pts" instead.
    expect(parseRatingPoints('4 to >3 pts')).toBe(4)
  })

  it('reads a decimal written without its leading zero', () => {
    // ".5 pts" gave 5 and ".25" gave 25 when this scanned for digit runs and took the largest —
    // a tenfold and a hundredfold error respectively, landing silently on a student's rubric.
    expect(parseRatingPoints('.5 pts')).toBe(0.5)
    expect(parseRatingPoints('.25')).toBe(0.25)
    expect(parseRatingPoints('.5 to >0 points')).toBe(0.5)
  })

  it('refuses a cell whose comma could mean either of two numbers', () => {
    // "1,000" is a thousand to most of the world and one to the rest of it. The digit-scanning
    // version answered 1. There is no safe guess, so there is no guess.
    expect(parseRatingPoints('1,000 points')).toBeNull()
    expect(parseRatingPoints('3,5')).toBeNull()
  })

  it('refuses a cell that merely contains a number', () => {
    // A closed grammar, not "find the numbers". Anything unrecognised is refused visibly rather
    // than reduced to whichever digits happened to be in it.
    expect(parseRatingPoints('Level 3: 5 pts')).toBeNull()
    expect(parseRatingPoints('see rubric, 4')).toBeNull()
    expect(parseRatingPoints('4 or 5')).toBeNull()
  })

  it('refuses an open-ended band, which has no maximum to take', () => {
    // The number is there, but it is the wrong end of the band — ">90" tops out at whatever the
    // criterion is worth, which this cell does not say. Guessing 90 would understate it.
    expect(parseRatingPoints('>90')).toBeNull()
    expect(parseRatingPoints('<70')).toBeNull()
    expect(parseRatingPoints('≥ 3')).toBeNull()
  })

  it('refuses a cell with no number in it', () => {
    expect(parseRatingPoints('')).toBeNull()
    expect(parseRatingPoints('   ')).toBeNull()
    expect(parseRatingPoints('N/A')).toBeNull()
    expect(parseRatingPoints('varies')).toBeNull()
    expect(parseRatingPoints(undefined)).toBeNull()
    expect(parseRatingPoints(null)).toBeNull()
  })
})

describe('buildRubricPayload', () => {
  const HEADER =
    'Rubric Name,Criteria Name,Criteria Description,Rating Name,Rating Description,Points'

  it('builds criteria and ratings from a single row', () => {
    const result = buildRubricPayload(`${HEADER}\nMy Rubric,Clarity,Is it clear?,Good,Very clear,10`, '555')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.payload.rubric.title).toBe('My Rubric')
    expect(result.payload.rubric_association.association_id).toBe('555')
    expect(result.payload.rubric.criteria['1']).toEqual({
      description: 'Clarity',
      long_description: 'Is it clear?',
      ratings: {
        '1': { description: 'Good', long_description: 'Very clear', points: 10 },
      },
    })
  })

  it('drops a criterion description that is a copy of the top rating', () => {
    // The fault a course developer reported: every criterion arrived in Canvas with its highest
    // band's words sitting in the Criterion Description field, to be deleted by hand.
    const text = 'Gathers comprehensive, highly relevant facts with clear documentation.'
    const result = buildRubricPayload(
      `${HEADER}\nR,Research,"${text}",Exemplary,"${text}",35`,
      '1',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const criterion = result.payload.rubric.criteria['1'] as { long_description: string }
    expect(criterion.long_description).toBe('')
  })

  it('ignores spacing and case when matching the top rating', () => {
    const result = buildRubricPayload(
      `${HEADER}\nR,Research,"Gathers  relevant   facts.",Exemplary,"gathers relevant facts.",35`,
      '1',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect((result.payload.rubric.criteria['1'] as { long_description: string }).long_description)
      .toBe('')
  })

  it('keeps a criterion description that is the author\'s own words', () => {
    const result = buildRubricPayload(
      `${HEADER}\nR,Research,Thoroughness and accuracy of research.,Exemplary,Gathers relevant facts.,35`,
      '1',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect((result.payload.rubric.criteria['1'] as { long_description: string }).long_description)
      .toBe('Thoroughness and accuracy of research.')
  })

  it('keeps a criterion description when only a lower band repeats it', () => {
    // Only the top rating is matched: a gate that fired on any of four ratings would be four
    // times as likely to throw away something a user wrote.
    const header = `${HEADER},Rating Name,Rating Description,Points`
    const row = 'R,Research,Needs work,Exemplary,Gathers relevant facts.,35,Poor,Needs work,0'
    const result = buildRubricPayload(`${header}\n${row}`, '1')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect((result.payload.rubric.criteria['1'] as { long_description: string }).long_description)
      .toBe('Needs work')
  })

  it('reads repeating rating triples across the row', () => {
    const header = `${HEADER},Rating Name,Rating Description,Points`
    const row = 'R,Clarity,,Excellent,Top marks,10,Poor,Needs work,2'
    const result = buildRubricPayload(`${header}\n${row}`, '1')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const ratings = (result.payload.rubric.criteria['1'] as { ratings: Record<string, unknown> })
      .ratings
    expect(Object.keys(ratings)).toEqual(['1', '2'])
    expect(ratings['2']).toEqual({ description: 'Poor', long_description: 'Needs work', points: 2 })
  })

  it('locates columns by header name, not position', () => {
    // The rating triple stays contiguous — that part is positional by definition, since the
    // columns repeat under identical names — but everything around it moves.
    const shuffled = 'Criteria Description,Criteria Name,Rubric Name,Rating Name,Rating Description,Points'
    const result = buildRubricPayload(`${shuffled}\n,Clarity,My Rubric,Good,Nice,5`, '1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.rubric.title).toBe('My Rubric')
    expect((result.payload.rubric.criteria['1'] as { description: string }).description).toBe(
      'Clarity',
    )
  })

  it('sets criterion_use_range only when the column says true', () => {
    const header = `${HEADER},Enable Range`
    const on = buildRubricPayload(`${header}\nR,C,,Good,Nice,5,TRUE`, '1')
    const off = buildRubricPayload(`${header}\nR,C,,Good,Nice,5,false`, '1')
    expect(on.ok && 'criterion_use_range' in (on.payload.rubric.criteria['1'] as object)).toBe(true)
    expect(off.ok && 'criterion_use_range' in (off.payload.rubric.criteria['1'] as object)).toBe(
      false,
    )
  })

  it('refuses points it cannot read instead of sending a silent zero', () => {
    // This used to be `parseFloat(x) || 0`, so "not-a-number" deployed as a rating worth nothing
    // and Canvas accepted it without a word. A visible refusal beats a quietly wrong grade.
    const result = buildRubricPayload(`${HEADER}\nR,C,,Good,Nice,not-a-number`, '1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('Rating Points')
    expect(result.message).toContain('Good')
  })

  it('takes a whole rubric copied out of Canvas', () => {
    // The shape of the eCampus demo rubrics: every rating written as "X to >Y pts", range enabled.
    const header = `${HEADER},Rating Name,Rating Description,Points,Rating Name,Rating Description,Points`
    const row = 'Discussion Board,Overall quality,,Met,Refers to the readings,4 to >3 pts,Partially Met,Some gaps,3 to >1 pts,Not Met,No reference,1 to >0 pts'
    const result = buildRubricPayload(`${header}\n${row}`, '1')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const ratings = (
      result.payload.rubric.criteria['1'] as { ratings: Record<string, { points: number }> }
    ).ratings
    expect([ratings['1'].points, ratings['2'].points, ratings['3'].points]).toEqual([4, 3, 1])
  })

  it('takes a hand-written descending band', () => {
    // The shape of the pull-request rubric: "4-3.5 points", "3.4-3 points", and so on.
    const header = `${HEADER},Rating Name,Rating Description,Points`
    const row = 'PR Review,Setup and context,,Exemplary,Tight scope,4-3.5 points,Proficient,Understandable,3.4-3 points'
    const result = buildRubricPayload(`${header}\n${row}`, '1')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const ratings = (
      result.payload.rubric.criteria['1'] as { ratings: Record<string, { points: number }> }
    ).ratings
    expect([ratings['1'].points, ratings['2'].points]).toEqual([4, 3.4])
  })

  it('names every rating it could not read, not just the first', () => {
    const header = `${HEADER},Rating Name,Rating Description,Points`
    const row = 'R,Clarity,,Excellent,Top marks,>90,Poor,Needs work,N/A'
    const result = buildRubricPayload(`${header}\n${row}`, '1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('Excellent')
    expect(result.message).toContain('Poor')
    expect(result.message).toContain('>90')
  })

  it('says so when a rating name has no points beside it at all', () => {
    const result = buildRubricPayload(`${HEADER}\nR,Clarity,,Good,Nice,`, '1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('nothing')
  })

  it('skips rows with no criteria name', () => {
    const result = buildRubricPayload(`${HEADER}\nR,Clarity,,Good,Nice,5\nR,,,,,`, '1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.payload.rubric.criteria)).toEqual(['1'])
  })

  it('reports unrecognised headers rather than producing an empty rubric', () => {
    const result = buildRubricPayload('col1,col2\nfoo,bar', '1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('CSV headers not recognized')
  })

  it('reports an empty CSV', () => {
    expect(buildRubricPayload('', '1').ok).toBe(false)
    expect(buildRubricPayload(HEADER, '1').ok).toBe(false)
  })

  it('carries quoted rubric text through intact', () => {
    const result = buildRubricPayload(
      `${HEADER}\n"Essay, Final","Clarity & ""voice""",,Good,Nice,5`,
      '1',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.rubric.title).toBe('Essay, Final')
    expect((result.payload.rubric.criteria['1'] as { description: string }).description).toBe(
      'Clarity & "voice"',
    )
  })
})
