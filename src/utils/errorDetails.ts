/**
 * The reverse of electron/ipc/errorDetails.ts: split an error into the sentence written for a
 * person and the technical details kept behind a "Show technical details" link.
 *
 * The marker must match the one in the main process.
 */
const DETAILS_MARKER = '\n\n[[technical details]]\n'

export function splitDetails(message: string): { plain: string; details?: string } {
  const at = message.indexOf(DETAILS_MARKER)
  if (at === -1) return { plain: message }
  const details = message.slice(at + DETAILS_MARKER.length).trim()
  return { plain: message.slice(0, at).trim(), details: details || undefined }
}
