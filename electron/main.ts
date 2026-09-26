import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { isAllowedExternalUrl, setAllowedCanvasHost } from './ipc/externalLinks'
import { readSettings, updateSettings } from './ipc/settings'
import {
  setCanvasToken,
  canvasTokenStatus,
  setGeminiApiKey,
  geminiKeyStatus,
  type CredentialStatus,
} from './ipc/credentials'
import { pushRubric, verifyToken, getCourseName } from './ipc/canvas'
import { parseCourseUrl } from './ipc/canvasUtils'
import { checkRepair } from './ipc/csvRepair'
import { signIn, getStatus, clearTokens } from './ipc/googleAuth'
import { withJob, cancelJob } from './ipc/jobs'
import * as gemini from './ipc/gemini'
import { buildRubricSetHtml, rubricFileName } from './ipc/rubricHtml'
import type { Attachment, GenerationSettings, RubricData } from './ipc/geminiTypes'
import {
  listFiles,
  getFileMetadata,
  getGoogleDocText,
  getGoogleSheetCsv,
  downloadFileBytes,
  fetchFileForProcessing,
  uploadToDrive,
  extractFileIdFromUrl,
  GOOGLE_DOC_MIME,
  type ListFilesArgs,
} from './ipc/googleDrive'
import { checkForUpdate, checkNow, RELEASES_PAGE } from './ipc/updateCheck'
import {
  applyZoomLevel,
  getSavedZoomLevel,
  registerZoomShortcuts,
  stepZoom,
  MIN_ZOOM_LEVEL,
  MAX_ZOOM_LEVEL,
} from './ipc/zoom'

const IS_MAC = process.platform === 'darwin'

/**
 * True only for a navigation back to the page this window already shows.
 *
 * Deliberately not an origin comparison. Every `file://` URL has the origin `"null"`, so in the
 * packaged build — which loads the UI with `loadFile` — comparing origins matches *any* local
 * file and waves it through. That would let a navigation to, say, a rubric the user just saved as
 * .html run inside this window, where the preload bridge is attached and hands it the whole
 * `window.api` surface. Under `file://` we therefore require the exact same document, and only
 * the dev server (a real http origin, which reloads itself for HMR) gets origin treatment.
 */
function isOwnPage(win: BrowserWindow, url: string): boolean {
  const current = win.webContents.getURL()
  if (!current) return false
  try {
    const target = new URL(url)
    const here = new URL(current)
    if (here.origin === 'null' || target.origin === 'null') {
      return target.protocol === here.protocol && target.pathname === here.pathname
    }
    return target.origin === here.origin
  } catch {
    return false
  }
}

/**
 * Hand a URL to the OS browser, but only one this app has business opening.
 *
 * See externalLinks.ts for why this is a host allowlist rather than the usual http(s) check: with
 * `connect-src 'none'` closing every socket in the renderer, navigation is the last route by
 * which a compromised renderer could move a Canvas token off the machine.
 */
async function openExternalSafely(url: string): Promise<void> {
  if (!isAllowedExternalUrl(url)) return
  await shell.openExternal(url)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    ...(IS_MAC
      ? { trafficLightPosition: { x: 13, y: 11 } }
      : {
          titleBarOverlay: {
            color: '#0033a0',
            symbolColor: '#ffffff',
            height: 36,
          },
        }),
    backgroundColor: '#f9fafb',
  })

  // This window only ever shows our own bundled UI. Everything external — the Google consent
  // screen, a finished Doc, the Canvas course — opens in the user's real browser. So refuse both
  // routes by which remote content could end up rendering inside the app instead: window.open,
  // and navigation away from our own page.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (isOwnPage(win, url)) return
    event.preventDefault()
    void openExternalSafely(url)
  })

  registerZoomShortcuts(win)

  // Restore the saved zoom once the page exists. Setting it earlier has no effect: Electron
  // resets the zoom level for each new document.
  win.webContents.on('did-finish-load', () => {
    applyZoomLevel(win, getSavedZoomLevel())
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** The window a renderer message came from, so zoom applies to the right one. */
function windowFor(e: { sender: Electron.WebContents }): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender)
}

// ─── App info and updates ─────────────────────────────────────────────────────

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:checkUpdate', () => checkForUpdate())
ipcMain.handle('app:checkUpdateNow', () => checkNow())

// Takes no URL on purpose: the destination is a constant here, so the renderer cannot use this as
// a general "open any link in the browser" capability.
ipcMain.handle('app:openReleases', () => shell.openExternal(RELEASES_PAGE))

// Ends the app from the "close the app" button in the completion dialog. Takes no argument and
// cannot be aimed anywhere — the only thing the renderer can do with it is end the session it is
// already in. app.quit() rather than closing the window, so "close the app" means the same thing
// on macOS, where closing the last window normally leaves the app running.
ipcMain.handle('app:quit', () => {
  app.quit()
})

// Copying the deployment log, through Electron rather than through navigator.clipboard.
//
// The renderer's clipboard API needs a secure context and a focused document, and when it is
// refused it rejects a promise that nobody was awaiting — the button does nothing and says
// nothing. That is a poor trade for the one control whose entire job is to let someone send us
// the error they are looking at. Electron's clipboard has no such conditions, and this returns a
// value so the button can report what happened.
//
// Text only, and nothing here can name a file or a destination: the renderer hands over a string
// and that is the whole of the capability.
ipcMain.handle('clipboard:writeText', (_e, text: string) => {
  if (typeof text !== 'string') return false
  clipboard.writeText(text)
  return true
})

ipcMain.handle('app:getHideLocalSaveNotice', () => readSettings().hideLocalSaveNotice === true)
ipcMain.handle('app:setHideLocalSaveNotice', (_e, hide: boolean) => {
  updateSettings({ hideLocalSaveNotice: hide === true })
})

// ─── Interface zoom ───────────────────────────────────────────────────────────

ipcMain.handle('app:getZoom', (e) => {
  const win = windowFor(e)
  return {
    level: win ? win.webContents.getZoomLevel() : 0,
    min: MIN_ZOOM_LEVEL,
    max: MAX_ZOOM_LEVEL,
  }
})

ipcMain.handle('app:stepZoom', (e, delta: number) => {
  const win = windowFor(e)
  // Only ever ±1 from the renderer; the size of a step is not the renderer's decision.
  return win ? stepZoom(win, delta > 0 ? 1 : -1) : 0
})

ipcMain.handle('app:resetZoom', (e) => {
  const win = windowFor(e)
  return win ? applyZoomLevel(win, 0) : 0
})

// ─── Credentials ──────────────────────────────────────────────────────────────
//
// Note the asymmetry, which is the point: `set` takes a secret, and the matching read returns a
// status object. There is deliberately no `getCanvasToken` handler. See credentials.ts.


ipcMain.handle('credentials:setCanvasToken', (_e, token: string | null) => {
  setCanvasToken(token)
})

ipcMain.handle('credentials:canvasTokenStatus', (): CredentialStatus => canvasTokenStatus())

ipcMain.handle('credentials:setGeminiApiKey', (_e, key: string | null) => {
  setGeminiApiKey(key)
  // The cached client holds the old key; drop it so the next call picks up the new one.
  gemini.resetClient()
})

ipcMain.handle('credentials:geminiKeyStatus', (): CredentialStatus => geminiKeyStatus())

// ─── Canvas ───────────────────────────────────────────────────────────────────

/**
 * Save the course URL, asking the user natively before moving to a different Canvas site.
 *
 * This value decides two things the renderer must not decide for itself: the only host the Canvas
 * token is sent to, and the only Canvas host `openExternal` will open. Validating it was not
 * enough — the renderer could simply save `https://attacker.example/courses/1` and then ask for a
 * push or a link, which is how the earlier version turned both controls into an exfiltration
 * channel in two calls.
 *
 * So a change of HOST is confirmed in a native dialog. A compromised renderer can call this
 * handler but cannot click that dialog, which is the property the whole design rests on. Changing
 * the course NUMBER on a host already in use needs no confirmation, so the common case — a
 * designer moving between courses at their own institution, typing as they go — is untouched.
 */
ipcMain.handle('canvas:setCourseUrl', async (e, url: string | null) => {
  if (!url) {
    updateSettings({ canvasCourseUrl: undefined })
    setAllowedCanvasHost(null)
    return { ok: true as const }
  }

  const ref = parseCourseUrl(url)
  if (!ref) {
    return {
      ok: false as const,
      message:
        'That is not a recognised Canvas course URL. It should look like ' +
        'https://yourschool.instructure.com/courses/12345 — paste a link from inside your course.',
    }
  }

  const currentUrl = readSettings().canvasCourseUrl
  const currentHost = currentUrl ? parseCourseUrl(currentUrl)?.host : undefined

  if (ref.host !== currentHost) {
    const win = BrowserWindow.fromWebContents(e.sender)
    const detail =
      `The app will send your Canvas access token to ${ref.host} to read and create rubrics ` +
      'there.\n\nThat token can read your courses, enrolments and student records, so only ' +
      'continue if this is your institution\u2019s Canvas address and you typed or pasted it ' +
      'yourself.'
    const { response } = win
      ? await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['Cancel', `Use ${ref.host}`],
          defaultId: 0,
          cancelId: 0,
          title: 'Use a different Canvas site?',
          message: `Send your Canvas token to ${ref.host}?`,
          detail,
        })
      : { response: 0 }

    if (response !== 1) {
      return { ok: false as const, message: 'Cancelled — the saved Canvas course was not changed.' }
    }
  }

  updateSettings({ canvasCourseUrl: url.trim() })
  setAllowedCanvasHost(url.trim())
  return { ok: true as const }
})

ipcMain.handle('canvas:getCourseUrl', () => readSettings().canvasCourseUrl ?? null)

// These take an OPTIONAL courseUrl. It may only name a course on the already-saved host; any
// other host is refused in resolveCourse (see canvas.ts). Omitted, they use the saved course.
ipcMain.handle('canvas:verifyToken', (_e, args?: { courseUrl?: string }) => verifyToken(args))
ipcMain.handle('canvas:getCourseName', (_e, args?: { courseUrl?: string }) => getCourseName(args))
ipcMain.handle('canvas:pushRubric', (_e, args: { csvContent: string; courseUrl?: string }) =>
  pushRubric(args),
)

// ─── Google sign-in ───────────────────────────────────────────────────────────
//
// Same asymmetry as the Canvas token: sign-in happens here, and the renderer is told who is
// signed in — never the access token. Drive calls below fetch their own.

ipcMain.handle('google:signIn', (_e, options?: { useAnotherAccount?: boolean }) => signIn(options))
ipcMain.handle('google:status', () => getStatus())
ipcMain.handle('google:signOut', () => clearTokens())

// ─── Google Drive ─────────────────────────────────────────────────────────────

ipcMain.handle('drive:listFiles', (_e, args: ListFilesArgs) => listFiles(args))

/**
 * Resolve whatever the user pasted into a file, and say what it is.
 *
 * Parsing happens in main so that one implementation serves both the link box and the Drive
 * browser, and so the renderer never has to care which of the four URL shapes it was given.
 */
ipcMain.handle('drive:resolveUrl', async (_e, url: string) => {
  try {
    const fileId = extractFileIdFromUrl(url)
    const meta = await getFileMetadata(fileId)
    return { ok: true as const, fileId, name: meta.name, mimeType: meta.mimeType }
  } catch (e) {
    return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('drive:getDocText', (_e, fileId: string) => getGoogleDocText(fileId))
ipcMain.handle('drive:getSheetCsv', (_e, fileId: string) => getGoogleSheetCsv(fileId))
ipcMain.handle('drive:downloadBytes', (_e, fileId: string) => downloadFileBytes(fileId))

// One call for "give me this file as bytes I can hand to mammoth or Gemini", converting a
// Google Doc to .docx on the way. Replaces three copies of that branch in the renderer.
ipcMain.handle('drive:fetchForProcessing', (_e, fileId: string) => fetchFileForProcessing(fileId))

ipcMain.handle(
  'drive:upload',
  (
    _e,
    args: {
      content: string | Uint8Array
      name: string
      sourceMimeType: string
      targetMimeType?: string
      folderId?: string
    },
  ) => uploadToDrive(args),
)


// ─── Gemini ───────────────────────────────────────────────────────────────────
//
// Every handler is the same shape: unwrap the renderer's job id into a real AbortSignal, then
// call the function unchanged. The cancellation logic inside gemini.ts — the throttle queue, the
// retry back-off — still works in terms of a signal, because that part did not need to change.

ipcMain.handle('gemini:cancel', (_e, jobId: string) => cancelJob(jobId))

// Validates a candidate key before it is saved, so this one takes the key directly.
ipcMain.handle('gemini:validateKey', (_e, apiKey: string) => gemini.validateGeminiApiKey(apiKey))

ipcMain.handle('gemini:startNewChat', () => gemini.startNewChat())

ipcMain.handle(
  'gemini:sendMessage',
  (_e, a: { text: string; attachments?: Attachment[]; jobId?: string }) =>
    withJob(a.jobId, (s) => gemini.sendMessageToGemini(a.text, a.attachments ?? [], s)),
)

ipcMain.handle(
  'gemini:extractRubricMetadata',
  (_e, a: { attachments: Attachment[]; jobId?: string }) =>
    withJob(a.jobId, (s) => gemini.extractRubricMetadata(a.attachments, s)),
)

ipcMain.handle(
  'gemini:validateAssignmentDescription',
  (_e, a: { text: string; jobId?: string }) =>
    withJob(a.jobId, (s) => gemini.validateAssignmentDescription(a.text, s)),
)

ipcMain.handle(
  'gemini:suggestPointSplit',
  (_e, a: { criteria: string[]; totalPoints: number; jobId?: string }) =>
    withJob(a.jobId, (s) => gemini.suggestPointSplit(a.criteria, a.totalPoints, s)),
)

ipcMain.handle(
  'gemini:generateRubricFromDescription',
  (
    _e,
    a: {
      assignmentDescription: string
      settings: GenerationSettings
      jobId?: string
      target?: { title: string; focus: string }
    },
  ) =>
    withJob(a.jobId, (s) =>
      gemini.generateRubricFromDescription(a.assignmentDescription, a.settings, s, a.target),
    ),
)

ipcMain.handle(
  'gemini:generateRubricFromScreenshot',
  (_e, a: { imageData: { data: string; mimeType: string }; settings: GenerationSettings; jobId?: string }) =>
    withJob(a.jobId, (s) => gemini.generateRubricFromScreenshot(a.imageData, a.settings, s)),
)

ipcMain.handle(
  'gemini:extractRubricFromDocument',
  (_e, a: { documentText: string; jobId?: string }) =>
    withJob(a.jobId, (s) => gemini.extractRubricFromDocument(a.documentText, s)),
)

ipcMain.handle(
  'gemini:applyRubricChanges',
  (_e, a: { rubric: RubricData; changeRequest: string; jobId?: string }) =>
    withJob(a.jobId, (s) => gemini.applyRubricChanges(a.rubric, a.changeRequest, s)),
)

ipcMain.handle(
  'gemini:analyzeCsvForCanvas',
  (_e, a: { csvContent: string; jobId?: string }) =>
    withJob(a.jobId, (s) => gemini.analyzeCsvForCanvas(a.csvContent, s)),
)

/**
 * Propose a repair for a CSV Canvas has just rejected, and check it before it goes anywhere.
 *
 * The gates run here rather than in the renderer so that a proposal which fails one never crosses
 * IPC at all. The renderer therefore cannot display — or deploy — a repair that was not proved to
 * parse and proved not to drop a criterion, whatever it does with the result.
 */
ipcMain.handle(
  'gemini:repairRubricCsv',
  async (_e, a: { csvContent: string; canvasMessage: string; jobId?: string }) => {
    const proposal = await withJob(a.jobId, (s) =>
      gemini.repairRubricCsv(a.csvContent, a.canvasMessage, s),
    )
    const checked = checkRepair(a.csvContent, proposal.repairedCsv)
    if (!checked.ok) return { ok: false as const, reason: checked.reason }
    return {
      ok: true as const,
      repairedCsv: proposal.repairedCsv,
      notes: proposal.notes,
      diff: checked.diff,
    }
  },
)

ipcMain.handle(
  'gemini:generateCsvForRubric',
  (
    _e,
    a: {
      rubricName: string
      totalPoints: string
      scoringMethod: 'ranges' | 'fixed'
      attachment: Attachment
      jobId?: string
    },
  ) =>
    withJob(a.jobId, (s) =>
      gemini.generateCsvForRubric(a.rubricName, a.totalPoints, a.scoringMethod, a.attachment, s),
    ),
)

ipcMain.handle(
  'gemini:discoverDeliverables',
  (_e, a: { description: string; jobId?: string }) =>
    withJob(a.jobId, (s) => gemini.discoverDeliverables(a.description, s)),
)

ipcMain.handle(
  'gemini:discoverRubricTitles',
  (_e, a: { attachment: Attachment; jobId?: string }) =>
    withJob(a.jobId, (s) => gemini.discoverRubricTitles(a.attachment, s)),
)

ipcMain.handle(
  'gemini:generateCsvsForRubrics',
  (_e, a: { attachment: Attachment; rubricNames: string[]; jobId?: string }) =>
    withJob(a.jobId, (s) => gemini.generateCsvsForRubrics(a.attachment, a.rubricNames, s)),
)

// ─── Rubric export ────────────────────────────────────────────────────────────
//
// One HTML builder, two destinations. Google Doc is the default because the finished rubric is
// nearly always headed for Drive anyway; the local .html exists so that nothing here depends on
// a working Google sign-in — which is the point, given that Testing-mode refresh tokens expire
// weekly and new staff hit sign-in problems most.

/** Build the rubric as a Google Doc in the user's Drive, and open it in their browser. */
ipcMain.handle(
  'rubric:exportToDrive',
  async (_e, args: { rubrics: RubricData[]; documentTitle?: string; folderId?: string }) => {
    if (args.rubrics.length === 0) {
      return { ok: false as const, message: 'There is no rubric to save.' }
    }
    try {
      const { fileId, webViewLink } = await uploadToDrive({
        content: buildRubricSetHtml(args.rubrics, args.documentTitle),
        name: args.documentTitle?.trim() || args.rubrics[0].title || 'Rubric',
        sourceMimeType: 'text/html',
        targetMimeType: GOOGLE_DOC_MIME,
        folderId: args.folderId,
      })
      await openExternalSafely(webViewLink)
      return { ok: true as const, fileId, webViewLink }
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
    }
  },
)

/**
 * Save the rubric as a .html file the user picks.
 *
 * Opens the dialog and writes in one call, rather than handing the path back to the renderer to
 * pass in again. Fewer moving parts, and the path never leaves the main process.
 */
ipcMain.handle(
  'rubric:saveHtml',
  async (_e, args: { rubrics: RubricData[]; documentTitle?: string }) => {
    if (args.rubrics.length === 0) {
      return { ok: false as const, message: 'There is no rubric to save.' }
    }
    const named = args.documentTitle?.trim()
      ? ({ ...args.rubrics[0], title: args.documentTitle } as RubricData)
      : args.rubrics[0]
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: rubricFileName(named, 'html'),
      filters: [{ name: 'Web page', extensions: ['html'] }],
    })
    if (!filePath) return { ok: false as const, cancelled: true as const }

    try {
      await writeFile(
        filePath,
        Buffer.from(buildRubricSetHtml(args.rubrics, args.documentTitle), 'utf-8'),
      )
      return { ok: true as const, path: filePath }
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
    }
  },
)

/** Save arbitrary generated text — a CSV, or the zip of them — to a file the user picks. */
ipcMain.handle(
  'file:saveText',
  async (
    _e,
    args: { defaultName: string; ext: string; label: string; content: string | Uint8Array },
  ) => {
    // basename only: the renderer chooses this, and an absolute defaultPath would point the
    // dialog at a directory of its choosing (a startup folder, a dotfile) with the user one
    // Enter away from accepting it. The user still confirms, but they should be confirming a
    // filename rather than a location something else picked.
    const safeName = (args.defaultName || 'export').replace(/[/\\]/g, '_').replace(/^\.+/, '')
    const safeExt = /^[A-Za-z0-9]{1,8}$/.test(args.ext) ? args.ext : 'txt'
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: safeName,
      filters: [{ name: args.label, extensions: [safeExt] }],
    })
    if (!filePath) return { ok: false as const, cancelled: true as const }

    try {
      const bytes =
        typeof args.content === 'string'
          ? Buffer.from(args.content, 'utf-8')
          : Buffer.from(args.content)
      await writeFile(filePath, bytes)
      return { ok: true as const, path: filePath }
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
    }
  },
)

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Teach the external-link allowlist which Canvas host this user configured, so a link to their
  // course opens while everything else stays shut.
  setAllowedCanvasHost(readSettings().canvasCourseUrl ?? null)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
