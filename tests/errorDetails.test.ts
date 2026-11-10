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
