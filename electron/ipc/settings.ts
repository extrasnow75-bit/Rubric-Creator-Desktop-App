/**
 * Plain user preferences, persisted across launches.
 *
 * No credentials live here — the Canvas token, the Gemini and BoiseState.ai keys and the Google refresh token all go
 * through safeStorage (see credentials.ts and googleAuth.ts) — so this is ordinary JSON on disk.
 * Read and write go through one module so that two features storing different keys in the same
 * file cannot clobber each other: every write is a read-modify-write of the whole object.
 *
 * The Canvas course URL is the one borderline case. It is not a secret — it is a public course
 * address, visible in the browser bar of anyone enrolled — so it lives here rather than in the
 * keychain. It matters for a different reason: it decides which host the Canvas token may be sent
 * to (see canvas.ts) and which host `openExternal` will open (see externalLinks.ts).
 */
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'

const SETTINGS_PATH = join(app.getPath('userData'), 'settings.json')

/** One entry in the "recently used" lists the dashboard and screenshot converter show. */
export interface RecentEntry {
  fileId: string
  name: string
  url?: string
  at: number
}

/** Which service does the AI work. Absent means Gemini, so existing installs are unchanged. */
export type AiProvider = 'gemini' | 'boisestate'

export interface Settings {
  aiProvider?: AiProvider
  zoomLevel?: number
  /** The user ticked "Don't show this again" on the local-save notice. */
  hideLocalSaveNotice?: boolean
  /** Canvas course URL. Not a secret, but it pins where the token may be sent. */
  canvasCourseUrl?: string
  recentDocs?: RecentEntry[]
  recentImages?: RecentEntry[]
}

export function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as Settings
  } catch {
    return {}
  }
}

export function getAiProvider(): AiProvider {
  return readSettings().aiProvider === 'boisestate' ? 'boisestate' : 'gemini'
}

/** Merge `patch` into the stored settings. */
export function updateSettings(patch: Settings): void {
  try {
    writeFileSync(SETTINGS_PATH, JSON.stringify({ ...readSettings(), ...patch }), 'utf-8')
  } catch {
    // A preference that cannot be saved is not worth failing anything over.
  }
}
