import { redact } from './redact'

/**
 * An error written for a person, with the technical facts attached behind it.
 *
 * Electron hands the renderer only an error's text, so there is no room for a second field. The
 * technical part travels inside the message after a marker, and the renderer splits it back out
 * (src/utils/errorDetails.ts, which must use the same marker). The sentence before the marker is
 * the whole message for anyone who never opens the details.
 */
export const DETAILS_MARKER = '\n\n[[technical details]]\n'

/** Who someone stuck on a sign-in problem should ask. Change this one line to change every message. */
export const SUPPORT_CONTACT = 'Greg Snow (gregsnow@boisestate.edu or extrasnow75@gmail.com)'

export function withDetails(plain: string, technical: string | undefined): Error {
  const details = redact(technical ?? '').trim().slice(0, 1500)
  return new Error(details ? `${plain}${DETAILS_MARKER}${details}` : plain)
}
