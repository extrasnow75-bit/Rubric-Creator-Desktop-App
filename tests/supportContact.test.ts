import { describe, it, expect } from 'vitest'
import { SUPPORT_CONTACT as main } from '../electron/ipc/errorDetails'
import { SUPPORT_CONTACT as renderer } from '../src/utils/supportContact'

describe('support contact', () => {
  it('is the same in the main process and the renderer', () => {
    expect(renderer).toBe(main)
  })
})
