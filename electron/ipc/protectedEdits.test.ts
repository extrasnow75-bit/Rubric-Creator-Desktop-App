import { describe, it, expect } from 'vitest'
import { protectedEditsPrompt } from './protectedEdits'

describe('protectedEditsPrompt', () => {
  it('adds nothing when there is nothing to protect', () => {
    expect(protectedEditsPrompt(undefined)).toBe('')
    expect(protectedEditsPrompt([])).toBe('')
    expect(protectedEditsPrompt([{ criterion: 'Clarity', where: 'Proficient rating', passages: ['  '] }])).toBe('')
  })

  it('names the criterion, the cell and each passage', () => {
    const text = protectedEditsPrompt([
      {
        criterion: 'Evidence',
        where: 'Proficient rating',
        passages: ['see Smith (2019), ch. 3', 'MANUAL EDIT #1'],
      },
    ])
    expect(text).toContain('Criterion "Evidence", Proficient rating: "see Smith (2019), ch. 3"')
    expect(text).toContain('"MANUAL EDIT #1"')
  })

  it('asks for the passage to be kept without freezing the cell', () => {
    const text = protectedEditsPrompt([{ criterion: 'A', where: 'description', passages: ['x'] }])
    expect(text).toMatch(/word for word/)
    expect(text).toMatch(/around a passage only as far as the requested changes require/)
  })
})
