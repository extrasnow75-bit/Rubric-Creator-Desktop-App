import { describe, it, expect } from 'vitest'
import { redact } from '../electron/ipc/redact'

describe('redact', () => {
  it.each([
    ['key=AIzaSyA1234567890abcdefghijklmnop', 'key=[removed]'],
    ['token ya29.a0AfH6SMBx-12_34', 'token [removed]'],
    ['secret GOCSPX-abcDEF123_-xyz', 'secret [removed]'],
    ['Authorization: Bearer abcdefghijklmnop1234', 'Authorization: [removed]'],
    ['1234~' + 'a'.repeat(40), '[removed]'],
  ])('removes %s', (input, expected) => expect(redact(input)).toBe(expected))

  it('leaves ordinary text alone', () => {
    expect(redact('Canvas replied with status 404: The specified resource does not exist.')).toBe(
      'Canvas replied with status 404: The specified resource does not exist.',
    )
  })
})

describe('redact and the word Bearer', () => {
  it('leaves an ordinary phrase alone', () => {
    expect(redact('Bearer authentication failed')).toBe('Bearer authentication failed')
  })
})
