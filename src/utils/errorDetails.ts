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

/** Just the sentence written for a person. For places with no room for a details dropdown. */
export function plainMessage(message: string | undefined | null): string {
  return splitDetails(message ?? '').plain
}

/** The sentence followed by its technical cause, for the activity log that gets sent to support. */
export function logMessage(message: string | undefined | null): string {
  const { plain, details } = splitDetails(message ?? '')
  return details ? `${plain} (Technical details: ${details})` : plain
}
