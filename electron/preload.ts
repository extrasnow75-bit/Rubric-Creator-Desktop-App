import { contextBridge, ipcRenderer } from 'electron'

/** Mirrors DriveFile in ipc/googleDrive.ts. Declared here so the preload stays standalone. */
interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  iconLink?: string
  isFolder: boolean
}

/**
 * The renderer's entire view of the outside world.
 *
 * Every method here is a deliberate grant, so the shape of this object is the app's real
 * security boundary. Two rules it follows, both of which matter more than they look:
 *
 *   1. No method returns a credential. The Canvas token, the Gemini key and the Google access
 *      token are written in one direction only — renderer to keychain — and the reads come back
 *      as status, not secrets. The renderer cannot leak what it was never given.
 *   2. No method takes a URL that the main process will then fetch or open verbatim. Destinations
 *      are either constants in main or checked against an allowlist there.
 */
contextBridge.exposeInMainWorld('api', {
  app: {
    /**
     * 'darwin' | 'win32' | 'linux'. A plain value rather than a call, because the layout decides
     * on it during the first render — the title bar has to leave room for macOS's traffic lights
     * immediately, not after a round trip that would show a visible jump.
     */
    platform: process.platform,
    version: (): Promise<string> => ipcRenderer.invoke('app:version'),
    /** Resolves to null when up to date, offline, or the check fails. */
    checkUpdate: (): Promise<{ version: string } | null> => ipcRenderer.invoke('app:checkUpdate'),
    /** User-initiated check. Always hits the network, and distinguishes a failed check. */
    checkUpdateNow: (): Promise<
      | { state: 'update-available'; current: string; latest: string }
      | { state: 'up-to-date'; current: string }
      | { state: 'check-failed'; current: string }
    > => ipcRenderer.invoke('app:checkUpdateNow'),
    openReleases: (): Promise<void> => ipcRenderer.invoke('app:openReleases'),
    /** Quits. Reached only from the explicit "close the app" button, behind a confirm step. */
    quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
    /**
     * Put text on the system clipboard. Resolves false if it could not be done.
     *
     * Through main because the renderer's own clipboard API is conditional on focus and a secure
     * context, and fails silently when those do not hold.
     */
    copyText: (text: string): Promise<boolean> => ipcRenderer.invoke('clipboard:writeText', text),
    /** "Don't show this again" on the notice shown before the first local save. */
    /**
     * The first-time "where did my file go?" notice for Save to this computer.
     *
     * Deliberately still unused. The settings field, handler and these two channels exist; the
     * panel itself was never written, and it is worth building only if someone actually asks what
     * that button does. Left in place rather than deleted because the setting is persisted, so
     * removing it would mean re-adding the storage later. Every other unused channel was removed
     * in v0.9.7 — this pair is the exception, on purpose.
     */
    getHideLocalSaveNotice: (): Promise<boolean> =>
      ipcRenderer.invoke('app:getHideLocalSaveNotice'),
    setHideLocalSaveNotice: (hide: boolean): Promise<void> =>
      ipcRenderer.invoke('app:setHideLocalSaveNotice', hide),
    /** Current interface zoom, plus the range the controls should stop at. */
    getZoom: (): Promise<{ level: number; min: number; max: number }> =>
      ipcRenderer.invoke('app:getZoom'),
    /** One step larger (delta > 0) or smaller. Resolves to the new level. */
    stepZoom: (delta: number): Promise<number> => ipcRenderer.invoke('app:stepZoom', delta),
    resetZoom: (): Promise<number> => ipcRenderer.invoke('app:resetZoom'),
    /** Fires when zoom changes by any route, including the keyboard shortcuts. */
    onZoomChanged: (callback: (level: number) => void): (() => void) => {
      const listener = (_e: unknown, level: number) => callback(level)
      ipcRenderer.on('app:zoomChanged', listener)
      return () => ipcRenderer.removeListener('app:zoomChanged', listener)
    },
  },
  file: {
    /**
     * Save generated content to a file the user picks.
     *
     * The dialog and the write happen together in the main process, so the chosen path is never
     * handed to the renderer and passed back. That removes the need to prove a returned path is
     * the one the dialog issued — a check the earlier two-step version had to carry, because
     * rubric text is AI-generated and a renderer-supplied path would be a write primitive.
     */
    saveText: (args: {
      defaultName: string
      ext: string
      label: string
      content: string | Uint8Array
    }): Promise<{ ok: boolean; path?: string; cancelled?: boolean; message?: string }> =>
      ipcRenderer.invoke('file:saveText', args),
  },
  rubric: {
    /** Creates a Google Doc in Drive and opens it in the browser. Needs a Google sign-in. */
    exportToDrive: (args: unknown): Promise<unknown> =>
      ipcRenderer.invoke('rubric:exportToDrive', args),
    /** Rewrites a document this app made earlier, keeping its id, link and revision history. */
    updateDriveDoc: (args: unknown): Promise<unknown> =>
      ipcRenderer.invoke('rubric:updateDriveDoc', args),
    /** Whether that document is still there, and still as the app left it. */
    checkDriveDoc: (args: unknown): Promise<unknown> =>
      ipcRenderer.invoke('rubric:checkDriveDoc', args),
    /** Saves the same rubric as a .html file. Works with no Google account at all. */
    saveHtml: (args: {
      rubric: unknown
    }): Promise<{ ok: boolean; path?: string; cancelled?: boolean; message?: string }> =>
      ipcRenderer.invoke('rubric:saveHtml', args),
  },
  google: {
    signIn: (options?: {
      useAnotherAccount?: boolean
    }): Promise<{ signedIn: boolean; email?: string; name?: string; picture?: string }> =>
      ipcRenderer.invoke('google:signIn', options),
    signOut: (): Promise<void> => ipcRenderer.invoke('google:signOut'),
    /** Identity only. There is no call that returns the Google access token. */
    status: (): Promise<{ signedIn: boolean; email?: string; name?: string; picture?: string }> =>
      ipcRenderer.invoke('google:status'),
    /** Fires when a stored sign-in turns out to be dead. Returns an unsubscribe function. */
    onSignedOut: (callback: () => void): (() => void) => {
      const listener = () => callback()
      ipcRenderer.on('google:signedOut', listener)
      return () => ipcRenderer.removeListener('google:signedOut', listener)
    },
  },
  drive: {
    listFiles: (args: {
      scope: 'recent' | 'myDrive' | 'sharedWithMe' | 'folder' | 'search'
      folderId?: string
      query?: string
      mimeTypes?: string[]
      foldersOnly?: boolean
      pageToken?: string
      pageSize?: number
    }): Promise<{ files: DriveFile[]; nextPageToken?: string }> =>
      ipcRenderer.invoke('drive:listFiles', args),
    /** Accepts any of the Drive URL shapes, or a bare file id. */
    resolveUrl: (
      url: string,
    ): Promise<
      { ok: true; fileId: string; name: string; mimeType: string } | { ok: false; message: string }
    > => ipcRenderer.invoke('drive:resolveUrl', url),
    getDocText: (fileId: string): Promise<string> => ipcRenderer.invoke('drive:getDocText', fileId),
    getSheetCsv: (fileId: string): Promise<string> =>
      ipcRenderer.invoke('drive:getSheetCsv', fileId),
    downloadBytes: (fileId: string): Promise<Uint8Array> =>
      ipcRenderer.invoke('drive:downloadBytes', fileId),
    /** Bytes ready for processing; a Google Doc arrives converted to .docx. */
    fetchForProcessing: (
      fileId: string,
    ): Promise<{ name: string; mimeType: string; bytes: Uint8Array }> =>
      ipcRenderer.invoke('drive:fetchForProcessing', fileId),
    upload: (args: {
      content: string | Uint8Array
      name: string
      sourceMimeType: string
      targetMimeType?: string
      folderId?: string
    }): Promise<{ fileId: string; webViewLink: string }> =>
      ipcRenderer.invoke('drive:upload', args),
    /** Takes a file id, not a URL: main builds the address, so this cannot open anything else. */
  },
  gemini: {
    /** Stops a running generation. The job id is chosen by the caller in geminiService.ts. */
    cancel: (jobId: string): Promise<boolean> => ipcRenderer.invoke('gemini:cancel', jobId),
    /** Checks a key the user has typed but not yet saved. */
    validateKey: (apiKey: string): Promise<boolean> =>
      ipcRenderer.invoke('gemini:validateKey', apiKey),
    startNewChat: (): Promise<void> => ipcRenderer.invoke('gemini:startNewChat'),
    sendMessage: (a: unknown): Promise<string> => ipcRenderer.invoke('gemini:sendMessage', a),
    extractRubricMetadata: (a: unknown): Promise<unknown> =>
      ipcRenderer.invoke('gemini:extractRubricMetadata', a),
    validateAssignmentDescription: (a: unknown): Promise<unknown> =>
      ipcRenderer.invoke('gemini:validateAssignmentDescription', a),
    suggestPointSplit: (a: unknown): Promise<unknown> =>
      ipcRenderer.invoke('gemini:suggestPointSplit', a),
    generateRubricFromDescription: (a: unknown): Promise<unknown> =>
      ipcRenderer.invoke('gemini:generateRubricFromDescription', a),
    generateRubricFromScreenshot: (a: unknown): Promise<unknown> =>
      ipcRenderer.invoke('gemini:generateRubricFromScreenshot', a),
    extractRubricFromDocument: (a: unknown): Promise<unknown> =>
      ipcRenderer.invoke('gemini:extractRubricFromDocument', a),
    applyRubricChanges: (a: unknown): Promise<unknown> =>
      ipcRenderer.invoke('gemini:applyRubricChanges', a),
    analyzeCsvForCanvas: (a: unknown): Promise<unknown> =>
      ipcRenderer.invoke('gemini:analyzeCsvForCanvas', a),
    /** Returns a checked proposal, or a reason it was discarded. Never an unchecked repair. */
    repairRubricCsv: (a: unknown): Promise<unknown> =>
      ipcRenderer.invoke('gemini:repairRubricCsv', a),
    generateCsvForRubric: (a: unknown): Promise<string> =>
      ipcRenderer.invoke('gemini:generateCsvForRubric', a),
    discoverDeliverables: (a: unknown): Promise<unknown> =>
      ipcRenderer.invoke('gemini:discoverDeliverables', a),
    discoverRubricTitles: (a: unknown): Promise<unknown> =>
      ipcRenderer.invoke('gemini:discoverRubricTitles', a),
    generateCsvsForRubrics: (a: unknown): Promise<unknown> =>
      ipcRenderer.invoke('gemini:generateCsvsForRubrics', a),
  },
  credentials: {
    /** False on a machine with no working keychain, where nothing can be stored safely. */
    /** Pass null to forget the stored token. Rejects if the keychain is unavailable. */
    setCanvasToken: (token: string | null): Promise<void> =>
      ipcRenderer.invoke('credentials:setCanvasToken', token),
    /**
     * Whether a Canvas token is stored, and its last four characters.
     *
     * There is no call that returns the token itself, and there should never be one: a Canvas
     * token reads every student record its owner can see, and the renderer has no use for it that
     * the main process cannot serve.
     */
    canvasTokenStatus: (): Promise<{ hasValue: boolean; hint: string }> =>
      ipcRenderer.invoke('credentials:canvasTokenStatus'),
    /** Pass null to forget the stored key. Same one-way shape as the Canvas token. */
    setGeminiApiKey: (key: string | null): Promise<void> =>
      ipcRenderer.invoke('credentials:setGeminiApiKey', key),
    geminiKeyStatus: (): Promise<{ hasValue: boolean; hint: string }> =>
      ipcRenderer.invoke('credentials:geminiKeyStatus'),
  },
  canvas: {
    /** Validates, stores, and pins this host for both API calls and external links. */
    setCourseUrl: (url: string | null): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('canvas:setCourseUrl', url),
    getCourseUrl: (): Promise<string | null> => ipcRenderer.invoke('canvas:getCourseUrl'),
    /** Confirms the stored token still works, and returns whose it is. */
    verifyToken: (args: {
      courseUrl: string
    }): Promise<{ ok: boolean; name?: string; message?: string }> =>
      ipcRenderer.invoke('canvas:verifyToken', args),
    getCourseName: (args: {
      courseUrl: string
    }): Promise<{ ok: boolean; name?: string; message?: string }> =>
      ipcRenderer.invoke('canvas:getCourseName', args),
    /** Takes no token: main loads it from the keychain when it builds the request. */
    pushRubric: (args: {
      csvContent: string
      courseUrl: string
    }): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('canvas:pushRubric', args),
  },
})
