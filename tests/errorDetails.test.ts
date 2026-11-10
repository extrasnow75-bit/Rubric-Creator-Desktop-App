import { describe, it, expect } from 'vitest'
import { splitDetails } from '../src/utils/errorDetails'
import { withDetails } from '../electron/ipc/errorDetails'

describe('splitDetails', () => {
  it('returns a plain message untouched', () => {
    expect(splitDetails('Sign in again.')).toEqual({ plain: 'Sign in again.' })
  })
  it('round-trips what the main process writes', () => {
    const err = withDetails('Google would not let you in.', 'error=access_denied')
    expect(splitDetails(err.message)).toEqual({
      plain: 'Google would not let you in.',
      details: 'error=access_denied',
    })
  })
  it('adds no marker when there is nothing technical to say', () => {
    expect(withDetails('Hello.', '  ').message).toBe('Hello.')
  })
})

import { appendToPlain } from '../src/utils/errorDetails'
describe('appendToPlain', () => {
  it('keeps the added sentence in the visible part', () => {
    const err = withDetails('Google is busy.', 'status 503').message
    expect(splitDetails(appendToPlain(err, 'Wrote 3 of 8.'))).toEqual({
      plain: 'Google is busy. Wrote 3 of 8.',
      details: 'status 503',
    })
  })
  it('works when there are no details', () => {
    expect(appendToPlain('Google is busy.', 'Wrote 3 of 8.')).toBe('Google is busy. Wrote 3 of 8.')
  })
})
