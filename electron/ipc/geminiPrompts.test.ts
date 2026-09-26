import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Which prompt carries which rule.
 *
 * gemini.ts cannot be imported here — it opens a Gemini client at module load and pulls in
 * Electron — so this reads the source, the way externalLinks.test.ts checks the link allowlist.
 * That is enough, because what needs pinning is not behaviour but *placement*: two rules that are
 * correct in one prompt and harmful in another.
 *
 * The harm is specific. RATING_BREVITY_RULE tells the model to write short rating descriptions,
 * which is right when the model is the author. Attached to an extraction prompt it would quietly
 * shorten an instructor's own rubric on the way out of their document — the CSV would deploy,
 * Canvas would accept it, and students would be graded against wording nobody approved. The
 * omission looks like an oversight to anyone tidying these prompts up, which is exactly why it
 * is pinned here.
 */

const SOURCE = readFileSync(join(__dirname, 'gemini.ts'), 'utf-8')

/** The body of one top-level function, from its declaration to the next one. */
function bodyOf(name: string): string {
  const start = SOURCE.search(new RegExp(`^(export )?(async )?function ${name}\\b`, 'm'))
  expect(start, `${name} not found in gemini.ts`).toBeGreaterThan(-1)
  const rest = SOURCE.slice(start + 1)
  const next = rest.search(/^(export )?(async )?function \w/m)
  return next === -1 ? rest : rest.slice(0, next)
}

/** Prompts where the model writes rubric language of its own. */
const AUTHORING = ['generateRubricFromDescription', 'applyRubricChanges']

/** Prompts that copy a rubric someone else already wrote and approved. */
const EXTRACTING = [
  'generateRubricFromScreenshot',
  'extractRubricFromDocument',
  'generateCsvForRubric',
  'runBatchExtraction',
]

describe('RATING_BREVITY_RULE placement', () => {
  it.each(AUTHORING)('is used by %s, which writes its own text', (fn) => {
    expect(bodyOf(fn)).toContain('RATING_BREVITY_RULE')
  })

  it.each(EXTRACTING)('is kept out of %s, which copies verbatim', (fn) => {
    expect(bodyOf(fn)).not.toContain('RATING_BREVITY_RULE')
  })

  /**
   * The rule's own first line. Without it the model read "be brief" as being about the rubric
   * rather than the sentences, and returned one criterion holding all 100 points.
   */
  it('says in its first line that it governs wording, not structure', () => {
    const rule = SOURCE.slice(SOURCE.indexOf('const RATING_BREVITY_RULE'))
    const firstBullet = rule.slice(0, rule.indexOf('- One sentence per rating'))
    expect(firstBullet).toContain('WORDING INSIDE one cell')
    expect(firstBullet).toContain('never a reason to')
    expect(firstBullet).toMatch(/fewer criteria/)
  })
})

describe('CRITERIA_COVERAGE_RULE placement', () => {
  it('is used when a rubric is generated from a description', () => {
    expect(bodyOf('generateRubricFromDescription')).toContain('CRITERIA_COVERAGE_RULE')
  })

  it.each(EXTRACTING)('is kept out of %s', (fn) => {
    expect(bodyOf(fn)).not.toContain('CRITERIA_COVERAGE_RULE')
  })

  it('forbids a single criterion holding the whole total', () => {
    const rule = SOURCE.slice(SOURCE.indexOf('const CRITERIA_COVERAGE_RULE'))
    expect(rule.slice(0, rule.indexOf('`;'))).toContain('Never return a single criterion')
  })
})

describe('pointsBudgetRule placement', () => {
  it('is used when a rubric is generated from a description', () => {
    expect(bodyOf('generateRubricFromDescription')).toContain('pointsBudgetRule')
  })

  /*
   * Kept out of extraction for the same reason as the other two rules, and more sharply: these
   * prompts read totals off someone's existing rubric. Telling the model there what the points
   * ought to add up to would invite it to correct their arithmetic on the way past, silently
   * changing a rubric that was already approved.
   */
  it.each(EXTRACTING)('is kept out of %s, which reads totals off an existing rubric', (fn) => {
    expect(bodyOf(fn)).not.toContain('pointsBudgetRule')
  })

  it('puts the real number in every line, not the word "total"', () => {
    const rule = bodyOf('pointsBudgetRule')
    const body = rule.slice(0, rule.indexOf('`;'))
    // Five bullets plus the heading, each carrying ${totalPoints} at least once.
    expect((body.match(/\$\{totalPoints\}/g) ?? []).length).toBeGreaterThanOrEqual(6)
  })

  it('states the sum requirement and forbids repeating the total on every criterion', () => {
    const body = bodyOf('pointsBudgetRule')
    expect(body).toContain('ADD UP to exactly')
    expect(body).toContain('NEVER give every criterion')
  })

  /* The bands, not the points column, are what actually went wrong — see the note on the rule. */
  it("ties a criterion's share to the top of its highest rating", () => {
    expect(bodyOf('pointsBudgetRule')).toContain('HIGHEST NUMBER in its top rating')
  })
})
