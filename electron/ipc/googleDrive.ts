/**
 * Google Drive, from the main process.
 *
 * Ported from src/services/googleDriveService.ts, with two changes:
 *
 *   1. No access token crosses the IPC boundary. Every function here calls `getAccessToken()`
 *      itself, which reads the refresh token from the OS keychain and exchanges it as needed. The
 *      renderer names a file id; it never holds a credential.
 *   2. The Google Picker is gone. It is a browser widget that needs a real http origin for
 *      `setOrigin`, and a packaged app is served from file://. `listFiles` below replaces it, and
 *      the in-app browser built on it is better in the ways that were annoying anyway: no
 *      separate Picker API key, no 403 overlay, no ten-second timeout.
 */
import { randomBytes } from 'crypto'
import { getAccessToken } from './googleAuth'

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
export const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  iconLink?: string
  isFolder: boolean
}

export interface UploadResult {
  fileId: string
  webViewLink: string
  /** The name Drive settled on, which is what to show rather than what we asked for. */
  name?: string
  /** Recorded after a write, so the next write can tell whether anyone else has been in. */
  modifiedTime?: string
  version?: string
}

/** Pull a useful sentence out of a Google error body, which is nested several layers deep. */
async function parseGoogleError(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> }
    }
    const err = body?.error
    if (!err) return ''
    const reason = err.errors?.[0]?.reason ?? ''
    const message = err.message ?? ''
    return reason ? `${reason}: ${message}` : message
  } catch {
    try {
      return (await response.clone().text()).slice(0, 200)
    } catch {
      return ''
    }
  }
}

/**
 * Turn a Google API failure into something the user can act on.
 *
 * The 403 split matters: "you are not allowed to open this document" and "this app was never
 * granted Drive access" look identical in the status code but need opposite responses from the
 * user — ask a colleague to share the file, versus sign in again and tick the Drive box.
 */
async function driveError(response: Response, noun: string): Promise<Error> {
  if (response.status === 404) {
    return new Error(`That ${noun} was not found. Check the link and try again.`)
  }
  if (response.status === 401) {
    return new Error('Your Google sign-in has expired. Sign in again under Initial Setup.')
  }
  if (response.status === 403) {
    const detail = (await parseGoogleError(response)).toLowerCase()
    const scopeProblem =
      detail.includes('insufficientpermissions') ||
      detail.includes('insufficient permissions') ||
      detail.includes('insufficient authentication scopes')
    if (scopeProblem) {
      return new Error(
        'This app was not granted access to your Google Drive. Sign out and sign in again, ' +
          'and allow Drive access on the Google consent screen.',
      )
    }
    return new Error(
      `You do not have access to that ${noun}. Ask whoever owns it to share it with your ` +
        'Google account.',
    )
  }
  const detail = await parseGoogleError(response)
  return new Error(`Google Drive error (${response.status})${detail ? `: ${detail}` : ''}`)
}

/**
 * A Drive file id, checked before it is interpolated into an API path.
 *
 * Drive ids are URL-safe base64, so this is their real alphabet rather than a guess. Without the
 * check, an id of `../../../oauth2/v3/userinfo` normalises out of the Drive namespace and issues
 * an authorized request to a different googleapis endpoint; `?` or `#` would let the renderer
 * append its own query parameters. The host cannot be changed either way, so this widens reach
 * rather than leaking the token — but it is one regex.
 */
function assertFileId(fileId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    throw new Error('That does not look like a Google Drive file id.')
  }
  return fileId
}

async function authorized(url: string, init?: RequestInit): Promise<Response> {
  const accessToken = await getAccessToken()
  return fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  })
}

/**
 * Pull a Drive file id out of whatever the user pasted.
 *
 * Kept as a pure function (and unit-tested) because the shapes are numerous: a Docs URL, a Sheets
 * URL, an old `open?id=` link, or the bare id someone copied out of one of those.
 */
export function extractFileIdFromUrl(url: string): string {
  const slashMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/)
  if (slashMatch) return slashMatch[1]

  const idMatch = url.match(/[?&]id=([a-zA-Z0-9-_]+)/)
  if (idMatch) return idMatch[1]

  if (/^[a-zA-Z0-9-_]+$/.test(url.trim()) && url.trim().length > 10) return url.trim()

  throw new Error(
    'That does not look like a Google Docs or Sheets link. Paste a shareable link, such as ' +
      'https://docs.google.com/document/d/…',
  )
}

/** Escape a user's search text for a Drive `q` string literal. */
function escapeQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export type DriveScope = 'recent' | 'myDrive' | 'sharedWithMe' | 'folder' | 'search'

export interface ListFilesArgs {
  scope: DriveScope
  /** Required for scope 'folder'. */
  folderId?: string
  /** Required for scope 'search'. */
  query?: string
  /** Restrict to these MIME types. Omit for the caller's default document set. */
  mimeTypes?: string[]
  /** List only folders — used when picking an upload destination. */
  foldersOnly?: boolean
  pageToken?: string
  pageSize?: number
}

/**
 * List or search the user's Drive.
 *
 * This is what replaces the Picker, and it needs the `drive.readonly` scope to see files the app
 * did not create — see the note in googleConfig.ts about what that costs.
 */
export async function listFiles(
  args: ListFilesArgs,
): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  const clauses: string[] = ['trashed = false']

  if (args.foldersOnly) {
    clauses.push(`mimeType = '${GOOGLE_FOLDER_MIME}'`)
  } else if (args.mimeTypes?.length) {
    // Folders are always included so the browser can be navigated.
    const types = [...args.mimeTypes, GOOGLE_FOLDER_MIME]
      .map((m) => `mimeType = '${escapeQueryLiteral(m)}'`)
      .join(' or ')
    clauses.push(`(${types})`)
  }

  let orderBy = 'folder,name'
  switch (args.scope) {
    case 'recent':
      orderBy = 'viewedByMeTime desc'
      break
    case 'myDrive':
      clauses.push("'root' in parents")
      break
    case 'sharedWithMe':
      clauses.push('sharedWithMe = true')
      break
    case 'folder':
      if (!args.folderId) throw new Error('No folder was specified.')
      clauses.push(`'${escapeQueryLiteral(args.folderId)}' in parents`)
      break
    case 'search':
      if (!args.query?.trim()) throw new Error('No search text was given.')
      clauses.push(`name contains '${escapeQueryLiteral(args.query.trim())}'`)
      break
  }

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    orderBy,
    pageSize: String(args.pageSize ?? 50),
    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, iconLink)',
    // Without these two, files on shared drives are silently missing from every listing.
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
  })
  if (args.pageToken) params.set('pageToken', args.pageToken)

  const response = await authorized(`${DRIVE_FILES}?${params.toString()}`)
  if (!response.ok) throw await driveError(response, 'folder')

  const body = (await response.json()) as {
    nextPageToken?: string
    files?: Array<{
      id: string
      name: string
      mimeType: string
      modifiedTime?: string
      iconLink?: string
    }>
  }

  return {
    files: (body.files ?? []).map((f) => ({ ...f, isFolder: f.mimeType === GOOGLE_FOLDER_MIME })),
    nextPageToken: body.nextPageToken,
  }
}

/** Confirm a file exists and is reachable, and report what it is. */
export async function getFileMetadata(
  rawFileId: string,
): Promise<{ name: string; mimeType: string }> {
  const fileId = assertFileId(rawFileId)
  const params = new URLSearchParams({ fields: 'name,mimeType', supportsAllDrives: 'true' })
  const response = await authorized(`${DRIVE_FILES}/${fileId}?${params.toString()}`)
  if (!response.ok) throw await driveError(response, 'file')
  return (await response.json()) as { name: string; mimeType: string }
}

/**
 * A Google Doc as plain text.
 *
 * Exported through Drive rather than read through the Docs API, which keeps this to one API and
 * one scope, and handles multi-tab documents without walking the tab tree by hand.
 */
export async function getGoogleDocText(rawFileId: string): Promise<string> {
  const fileId = assertFileId(rawFileId)
  const response = await authorized(`${DRIVE_FILES}/${fileId}/export?mimeType=text/plain`)
  if (!response.ok) throw await driveError(response, 'document')
  return response.text()
}

/** A Google Sheet as CSV. */
export async function getGoogleSheetCsv(rawFileId: string): Promise<string> {
  const fileId = assertFileId(rawFileId)
  const response = await authorized(`${DRIVE_FILES}/${fileId}/export?mimeType=text/csv`)
  if (!response.ok) throw await driveError(response, 'sheet')
  return response.text()
}

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * A Google Doc exported as .docx bytes.
 *
 * Used when a document is headed for Gemini rather than for display: mammoth reads .docx and
 * preserves the table structure a rubric lives in, which a plain-text export flattens away.
 */
export async function exportDocAsDocx(rawFileId: string): Promise<Uint8Array> {
  const fileId = assertFileId(rawFileId)
  const response = await authorized(
    `${DRIVE_FILES}/${fileId}/export?mimeType=${encodeURIComponent(DOCX_MIME)}`,
  )
  if (!response.ok) throw await driveError(response, 'document')
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Fetch any supported file as bytes, converting a Google Doc to .docx on the way.
 *
 * One call for what was three copies of the same branch in the renderer — picker, pasted link,
 * and recent-document list all needed "if it is a Google Doc, export it; otherwise download it".
 * Doing the branch here also means the renderer never assembles a Google API URL.
 */
export async function fetchFileForProcessing(
  rawFileId: string,
): Promise<{ name: string; mimeType: string; bytes: Uint8Array }> {
  const fileId = assertFileId(rawFileId)
  const meta = await getFileMetadata(fileId)

  if (meta.mimeType === GOOGLE_DOC_MIME) {
    const name = meta.name.toLowerCase().endsWith('.docx') ? meta.name : `${meta.name}.docx`
    return { name, mimeType: DOCX_MIME, bytes: await exportDocAsDocx(fileId) }
  }

  return { name: meta.name, mimeType: meta.mimeType, bytes: await downloadFileBytes(fileId) }
}

/**
 * Raw bytes of a non-Google file (.docx, .pdf, .txt, an image).
 *
 * Returned as a Uint8Array because that is what survives the IPC structured clone; the renderer
 * turns it back into an ArrayBuffer for mammoth or pdf.js.
 */
export async function downloadFileBytes(rawFileId: string): Promise<Uint8Array> {
  const fileId = assertFileId(rawFileId)
  const response = await authorized(`${DRIVE_FILES}/${fileId}?alt=media&supportsAllDrives=true`)
  if (!response.ok) throw await driveError(response, 'file')
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Upload content to Drive, optionally converting it to a native Google format.
 *
 * The body is assembled as a Buffer rather than a string. The version this replaces built it with
 * `array.join('\r\n')`, which is fine for text/plain but corrupts any binary payload — every byte
 * outside the string's encoding is mangled on the way through. Since this is the path a generated
 * document takes into Drive, that mattered.
 */
/** Everything both writes ask Drive to hand back. */
const UPLOAD_FIELDS = 'id,webViewLink,name,modifiedTime,version'

function asUploadResult(raw: unknown): UploadResult {
  const file = raw as {
    id: string
    webViewLink: string
    name?: string
    modifiedTime?: string
    version?: string
  }
  return {
    fileId: file.id,
    webViewLink: file.webViewLink,
    name: file.name,
    modifiedTime: file.modifiedTime,
    version: file.version,
  }
}

/**
 * The metadata-plus-media body Drive wants for a multipart write.
 *
 * Shared by create and update so the two cannot drift; the boundary is passed in because the
 * caller generates it from random bytes — a guessable one would let renderer-supplied content
 * close the part and start its own.
 */
function multipartBody(
  boundary: string,
  metadata: Record<string, unknown>,
  content: string | Uint8Array,
  sourceMimeType: string,
): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${sourceMimeType}\r\n\r\n`,
      'utf-8',
    ),
    typeof content === 'string' ? Buffer.from(content, 'utf-8') : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--`, 'utf-8'),
  ])
}

export async function uploadToDrive(args: {
  content: string | Uint8Array
  name: string
  sourceMimeType: string
  targetMimeType?: string
  folderId?: string
}): Promise<UploadResult> {
  const accessToken = await getAccessToken()
  // Random, not Date.now(): the body below contains renderer-supplied content, and a
  // guessable boundary lets that content close the part and inject its own.
  const boundary = `rubriccreator${randomBytes(16).toString('hex')}`

  const metadata: Record<string, unknown> = { name: args.name }
  if (args.targetMimeType) metadata.mimeType = args.targetMimeType
  if (args.folderId) metadata.parents = [args.folderId]

  const body = multipartBody(boundary, metadata, args.content, args.sourceMimeType)

  const params = new URLSearchParams({
    uploadType: 'multipart',
    fields: UPLOAD_FIELDS,
    supportsAllDrives: 'true',
  })

  const response = await fetch(`${DRIVE_UPLOAD}?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })

  if (!response.ok) throw await driveError(response, 'file')

  return asUploadResult(await response.json())
}

/**
 * Replace an existing document's contents, keeping its id, its link and its revision history.
 *
 * The alternative — writing a second file every time — is what the app did, and it meant a run
 * that was revised three times left three identically named documents in Drive with nothing to
 * say which was current. Writing back to the same file makes the link permanent and, because
 * Google keeps a revision per write, gives File → Version history something real to show.
 *
 * Drive converts the uploaded HTML into the existing Google Doc exactly as it does on create, so
 * long as the target mime type is sent again; without it the file would be replaced by raw HTML.
 * The caller is expected to have checked first that nobody else has edited the document, because
 * this overwrites whatever is there (see describeDriveFile).
 */
export async function updateDriveFile(args: {
  fileId: string
  content: string | Uint8Array
  name?: string
  sourceMimeType: string
  targetMimeType?: string
}): Promise<UploadResult> {
  const fileId = assertFileId(args.fileId)
  const accessToken = await getAccessToken()
  const boundary = `rubriccreator${randomBytes(16).toString('hex')}`

  const params = new URLSearchParams({
    uploadType: 'multipart',
    fields: UPLOAD_FIELDS,
    supportsAllDrives: 'true',
  })

  const write = (metadata: Record<string, unknown>) =>
    fetch(`${DRIVE_UPLOAD}/${fileId}?${params.toString()}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody(boundary, metadata, args.content, args.sourceMimeType),
    })

  const named: Record<string, unknown> = {}
  if (args.name) named.name = args.name

  /*
   * Sending the target mime type is what asks Drive to convert the uploaded HTML, exactly as on
   * create. Drive also refuses, on some files, to be told a mime type it considers unchangeable —
   * and the file here is already a Google Doc, so conversion may well be implied without it.
   *
   * Which of those is true is not worth guessing at from here: ask for the conversion, and if
   * Drive objects to being told the type at all, send the same body again without it. One wasted
   * request in the case that does not arise, against a feature that silently does not work.
   */
  let response = await write(
    args.targetMimeType ? { ...named, mimeType: args.targetMimeType } : named,
  )

  if (!response.ok && args.targetMimeType && response.status >= 400 && response.status < 500) {
    const complaint = (await response.clone().text()).toLowerCase()
    if (complaint.includes('mimetype') || complaint.includes('mime type')) {
      response = await write(named)
    }
  }

  if (!response.ok) throw await driveError(response, 'file')
  return asUploadResult(await response.json())
}

/** What a Drive file looks like right now. Null when it is not there at all. */
export interface DriveFileState {
  name: string
  /** RFC 3339, and it moves for any change — ours included, so record it after writing. */
  modifiedTime: string
  /** Drive's own counter for the file. A cheaper equality check than the timestamp. */
  version: string
  /** In the owner's bin. The file still answers by id, so this is not a 404. */
  trashed: boolean
}

/**
 * Look at a file without downloading it, to find out whether it is still ours to overwrite.
 *
 * Two different "gone"s, reported differently because they need different offers. A file that has
 * been deleted is still addressable by id and comes back with `trashed: true`, so it can be named
 * as being in the bin. A file whose id no longer resolves at all is a 404, which is null here
 * rather than an error: it is an ordinary thing for a remembered id to have outlived its file,
 * and the only sensible response is to offer a new document.
 */
export async function describeDriveFile(rawFileId: string): Promise<DriveFileState | null> {
  const fileId = assertFileId(rawFileId)
  const params = new URLSearchParams({
    fields: 'name,modifiedTime,version,trashed',
    supportsAllDrives: 'true',
  })

  const response = await authorized(`${DRIVE_FILES}/${fileId}?${params.toString()}`)
  if (response.status === 404) return null
  if (!response.ok) throw await driveError(response, 'file')
  return (await response.json()) as DriveFileState
}
