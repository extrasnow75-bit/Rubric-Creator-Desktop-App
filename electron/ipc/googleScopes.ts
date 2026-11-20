/**
 * Which permissions Google's consent screen left unticked. Kept free of Electron imports so it
 * can be unit tested.
 *
 * Google shows each permission as its own box and still finishes the sign-in when one is left
 * empty, so a sign-in that "worked" could not open or save Drive files — people only found out
 * later, then had to sign in all over again. Google always reports what was granted; if it ever
 * says nothing, nothing is assumed missing.
 */
export function missingScopes(granted: string | undefined, required: string): string[] {
  if (!granted) return []
  const have = new Set(granted.split(/\s+/))
  return required.split(/\s+/).filter((s) => s.includes('/auth/drive') && !have.has(s))
}

export const MSG_DRIVE_NOT_ALLOWED =
  'You signed in, but the Google Drive boxes were not all ticked on Google’s screen, so the app ' +
  'cannot use your Drive. Choose Sign In with Google again and tick every Google Drive box this time.'

/** What the renderer shows nothing for: the person chose to stop. */
export const SIGN_IN_STOPPED = 'Google sign-in was cancelled.'
