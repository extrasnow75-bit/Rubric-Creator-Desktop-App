/**
 * Credentials, encrypted at rest by the OS keychain.
 *
 * Three secrets live here: the Canvas access token and the Gemini and BoiseState.ai API keys. The Google refresh
 * token has its own store in googleAuth.ts, for no better reason than that it is written by the
 * sign-in flow rather than by the user typing into a box.
 *
 * The Canvas token is why this module exists and why it is shaped the way it is. A Canvas access
 * token acts as the instructor who issued it: enrollments, submissions, grades, student names,
 * emails and SIS IDs, across every course they teach. It is FERPA-protected data behind a single
 * long-lived string. In the web app that string sat in `localStorage` in plain text, readable by
 * any extension with host permissions and by anything that could run script on the origin.
 *
 * So the rule this module enforces is: **the token goes in, and never comes back out**.
 *
 *   - `setCanvasToken` is reachable from the renderer.
 *   - `getCanvasToken` is not. It is called only by canvas.ts, in the main process, at the moment
 *     a request is built.
 *   - What the renderer can read is `canvasTokenStatus()` — whether a token exists, and its last
 *     four characters so the user can tell which one they saved.
 *
 * That is deliberately stricter than the sibling Canvas Extractor Tools app, which hands the raw
 * token back to its renderer and keeps it in React state. The renderer here cannot leak a secret
 * it was never given, and with `connect-src 'none'` it has nowhere to send one anyway.
 */
import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const CREDS_PATH = join(app.getPath('userData'), 'credentials.enc')

interface StoredCredentials {
  canvasToken?: string
  geminiApiKey?: string
  boiseStateApiKey?: string
}

/** What the renderer is allowed to know about a stored secret. */
export interface CredentialStatus {
  hasValue: boolean
  /** Last four characters, so the user can recognise which key is saved. Empty when none is. */
  hint: string
}

/**
 * Thrown when the OS has no working keychain.
 *
 * On Windows and macOS this effectively cannot happen. On Linux it can, when no keyring daemon is
 * running. The correct response is to refuse the write and say so: falling back to plaintext
 * would quietly reintroduce exactly the exposure this app was built to remove, and the user would
 * have no way to know the difference.
 */
export const KEYCHAIN_UNAVAILABLE =
  'Your operating system keychain is not available, so credentials cannot be stored securely. ' +
  'Nothing has been saved. On Linux this usually means no keyring service is running.'

function readAll(): StoredCredentials {
  if (!existsSync(CREDS_PATH)) return {}
  if (!safeStorage.isEncryptionAvailable()) return {}
  try {
    const raw = readFileSync(CREDS_PATH)
    if (raw.length === 0) return {}
    return JSON.parse(safeStorage.decryptString(raw)) as StoredCredentials
  } catch {
    // A corrupt or unreadable store is treated as empty rather than fatal: the user can always
    // paste the credential again, and refusing to start would be worse.
    return {}
  }
}

function writeAll(creds: StoredCredentials): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error(KEYCHAIN_UNAVAILABLE)
  writeFileSync(CREDS_PATH, safeStorage.encryptString(JSON.stringify(creds)))
}

function statusOf(value: string | undefined): CredentialStatus {
  if (!value) return { hasValue: false, hint: '' }
  return { hasValue: true, hint: value.slice(-4) }
}

// ─── Canvas token ─────────────────────────────────────────────────────────────

/**
 * Store the Canvas token, or clear it when passed null.
 *
 * Canvas tokens are often pasted with surrounding whitespace, and sometimes with the word
 * "Bearer" in front because that is how the docs show them being used. Both would produce a 401
 * that looks like a bad token rather than a formatting slip, so normalise here.
 */
export function setCanvasToken(token: string | null): void {
  const creds = readAll()
  const cleaned = token?.trim().replace(/^Bearer\s+/i, '') ?? ''
  if (cleaned) creds.canvasToken = cleaned
  else delete creds.canvasToken
  writeAll(creds)
}

/** Main-process only. Never expose this over IPC. */
export function getCanvasToken(): string | null {
  return readAll().canvasToken ?? null
}

export function canvasTokenStatus(): CredentialStatus {
  return statusOf(readAll().canvasToken)
}

// ─── Gemini API key ───────────────────────────────────────────────────────────

export function setGeminiApiKey(key: string | null): void {
  const creds = readAll()
  const cleaned = key?.trim() ?? ''
  if (cleaned) creds.geminiApiKey = cleaned
  else delete creds.geminiApiKey
  writeAll(creds)
}

/** Main-process only. Never expose this over IPC. */
export function getGeminiApiKey(): string | null {
  return readAll().geminiApiKey ?? null
}

export function geminiKeyStatus(): CredentialStatus {
  return statusOf(readAll().geminiApiKey)
}


// ─── BoiseState.ai API key ────────────────────────────────────────────────────

export function setBoiseStateApiKey(key: string | null): void {
  const creds = readAll()
  const cleaned = key?.trim() ?? ''
  if (cleaned) creds.boiseStateApiKey = cleaned
  else delete creds.boiseStateApiKey
  writeAll(creds)
}

/** Main-process only. Never expose this over IPC. */
export function getBoiseStateApiKey(): string | null {
  return readAll().boiseStateApiKey ?? null
}

export function boiseStateKeyStatus(): CredentialStatus {
  return statusOf(readAll().boiseStateApiKey)
}
