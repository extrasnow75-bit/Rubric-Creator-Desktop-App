/**
 * Removes anything that looks like a credential from text the person may copy and send to support.
 *
 * Nothing in the app puts a key or token into an error today. This is the guard for the day an SDK
 * or an API starts echoing one: the technical details are meant to be pasted into email.
 */
const PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{20,}/g, // Google API keys (Gemini)
  /ya29\.[0-9A-Za-z_.-]+/g, // Google access tokens
  /GOCSPX-[0-9A-Za-z_-]+/g, // Google client secrets
  /\b\d{2,6}~[A-Za-z0-9]{30,}/g, // Canvas access tokens
  /Bearer\s+(?=[A-Za-z0-9._~+/=-]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]{10,}/gi, // a bearer credential, not the word
]

export function redact(text: string): string {
  return PATTERNS.reduce((out, re) => out.replace(re, '[removed]'), text)
}
