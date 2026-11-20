import { describe, it, expect } from 'vitest'
import { missingScopes, MSG_DRIVE_NOT_ALLOWED } from './googleScopes'

const required =
  'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly openid email profile'

describe('missingScopes', () => {
  it('finds each unticked Drive box', () => {
    expect(missingScopes('openid https://www.googleapis.com/auth/drive.file', required)).toEqual([
      'https://www.googleapis.com/auth/drive.readonly',
    ])
    expect(missingScopes('openid https://www.googleapis.com/auth/userinfo.email', required)).toHaveLength(2)
  })

  it('passes when both Drive boxes were ticked, in any order', () => {
    expect(
      missingScopes(
        'https://www.googleapis.com/auth/drive.readonly openid https://www.googleapis.com/auth/drive.file',
        required,
      ),
    ).toEqual([])
  })

  it('assumes nothing when Google reports nothing', () => {
    expect(missingScopes(undefined, required)).toEqual([])
  })

  it('tells the person what to do', () => {
    expect(MSG_DRIVE_NOT_ALLOWED).toMatch(/tick every Google Drive box/)
  })
})
