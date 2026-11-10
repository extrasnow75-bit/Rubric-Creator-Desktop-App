/**
 * Google OAuth configuration for The Rubric Creator Desktop App.
 *
 * Setting this up (one-time, in the Google Cloud Console):
 *   1. APIs & Services → enable the **Google Drive API**.
 *   2. OAuth consent screen → External → add your users as **Test users**. Keep it in Testing;
 *      see the note on scopes below for why publishing is not a casual step.
 *   3. Credentials → Create OAuth client ID → Application type: **Desktop app**.
 *      A "Web application" client will not work: this app signs in through the system browser
 *      with a loopback redirect (RFC 8252), which web clients do not permit.
 *   4. Paste the client ID below, and put the secret in `.env.local` (see below).
 *
 * The client ID is a PUBLIC identifier and is safe to commit.
 */
export const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ?? '831368374697-njsla93amtodc6osc4n1djt6cjvf25ec.apps.googleusercontent.com'

/**
 * Google requires a client_secret on the token exchange even for "Desktop app" clients using
 * PKCE. Google's own documentation notes it is not a true secret in this context — it ships
 * inside the installed app — but it must be sent.
 *
 * It is deliberately NOT hardcoded: this repository is public, and GitHub secret scanning
 * auto-reports Google client secrets, after which Google revokes them and every installed copy
 * stops being able to sign in. Provide it locally instead, via either:
 *   - a `.env.local` file in the project root:  MAIN_VITE_GOOGLE_CLIENT_SECRET=GOCSPX-...
 *   - or a GOOGLE_CLIENT_SECRET environment variable
 *
 * For release builds it is injected at build time from the CI secret of the same name.
 */
const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env

export const GOOGLE_CLIENT_SECRET: string =
  viteEnv?.MAIN_VITE_GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? ''

export function isGoogleSecretConfigured(): boolean {
  return GOOGLE_CLIENT_SECRET.length > 0
}

/**
 * Scopes.
 *
 * `drive.file` alone would be the least-privilege choice — it grants access only to files this
 * app itself creates — and it is what the sibling Canvas Extractor Tools app uses. It is not
 * enough here: this app has an in-app Drive browser that lists and searches the user's existing
 * documents so they can pick a rubric to convert, and `drive.file` cannot see a file the app did
 * not create.
 *
 * `drive.readonly` is one of Google's **restricted** scopes. The consequences are worth stating
 * plainly, because they are not obvious:
 *   - While the consent screen stays in **Testing** with an explicit test-user allowlist, this is
 *     fine and needs no review.
 *   - **Publishing** the consent screen with a restricted scope requires an annual third-party
 *     security assessment, which is expensive. Do not publish this app casually.
 *   - Testing mode expires refresh tokens after **7 days**, so users re-authorise about weekly.
 *     That is a real annoyance, and it is why every document the app produces can also be saved
 *     locally without signing in at all.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'openid',
  'email',
  'profile',
].join(' ')

export function isGoogleConfigured(): boolean {
  return !GOOGLE_CLIENT_ID.startsWith('REPLACE_WITH')
}
