import { describe, it, expect } from 'vitest'
import { canvasApiMessage, canvasUnreachableMessage } from '../electron/ipc/canvasMessages'
import { splitDetails } from '../src/utils/errorDetails'
import { diagnoseCanvasError } from '../src/utils/diagnoseCanvasError'

describe('canvasApiMessage', () => {
  it.each([401, 403, 404, 429, 500, 503, 422, 400])('status %i: plain sentence, cause behind the marker', (status) => {
    const { plain, details } = splitDetails(canvasApiMessage(status, 'some canvas text'))
    expect(plain).toMatch(/What to do:/)
    expect(plain).not.toMatch(/\b(40\d|42\d|5\d\d)\b|API|HTTP/)
    expect(details).toContain(`status ${status}`)
    expect(details).toContain('some canvas text')
  })
  it('names the roles a designer may hold', () => {
    expect(canvasApiMessage(403)).toMatch(/teacher, designer or course administrator/)
  })
  it('does not mention a VPN', () => {
    expect(canvasUnreachableMessage('fetch failed')).not.toMatch(/vpn/i)
  })
})

describe('diagnoseCanvasError reads the new wording', () => {
  it('401 → token', () => expect(diagnoseCanvasError(canvasApiMessage(401, 'Invalid access token')).action.kind).toBe('open-setup'))
  it('403 → permission, even if the details say "invalid"', () => {
    expect(diagnoseCanvasError(canvasApiMessage(403, 'invalid role')).cause).toMatch(/not allowed/)
  })
  it('404 → course not found', () => expect(diagnoseCanvasError(canvasApiMessage(404, 'x')).cause).toMatch(/no course/))
  it('429 and 5xx are worth one retry', () => {
    expect(diagnoseCanvasError(canvasApiMessage(429)).transient).toBe(true)
    expect(diagnoseCanvasError(canvasApiMessage(503)).transient).toBe(true)
  })
  it('a 422 about the rubric still offers the AI repair', () => {
    const d = diagnoseCanvasError(canvasApiMessage(422, 'Criterion 3 has no ratings'))
    expect(d.repairable).toBe(true)
  })
  it('no connection → retry', () => expect(diagnoseCanvasError(canvasUnreachableMessage('fetch failed')).transient).toBe(true))
})
