/**
 * The typed `window.api` bridge. Mirrors electron/preload.ts.
 *
 * Keep this in step with the preload by hand — there is no shared source, and a method that
 * exists here but not there fails silently at runtime as `undefined is not a function`.
 *
 * Note what is deliberately absent: nothing returns a Canvas token, a Gemini key or a Google
 * access token. Credentials travel renderer → main only, and come back as status. If a method
 * that returns one ever appears here, that is a bug, not a feature.
 */
import type { RubricData, RubricMeta, GenerationSettings, Attachment } from '../types'
import type {
  CsvAnalysisResult,
  CsvRepairResult,
  RubricDiscovery,
  BatchRubricResult,
  Deliverable,
} from '../services/geminiService'

export {}

declare global {
  interface Window {
    api: {
      app: {
        /** 'darwin' | 'win32' | 'linux' — read synchronously during the first render. */
        platform: string
        version(): Promise<string>
        /** Resolves to null when up to date, offline, or the check fails. */
        checkUpdate(): Promise<{ version: string } | null>
        checkUpdateNow(): Promise<
          | { state: 'update-available'; current: string; latest: string }
          | { state: 'up-to-date'; current: string }
          | { state: 'check-failed'; current: string }
        >
        openReleases(): Promise<void>
        quit(): Promise<void>
        /** Resolves false if the text could not be placed on the clipboard. */
        copyText(text: string): Promise<boolean>
        getHideLocalSaveNotice(): Promise<boolean>
        setHideLocalSaveNotice(hide: boolean): Promise<void>
        getZoom(): Promise<{ level: number; min: number; max: number }>
        stepZoom(delta: number): Promise<number>
        resetZoom(): Promise<number>
        /** Returns an unsubscribe function. */
        onZoomChanged(callback: (level: number) => void): () => void
      }
      file: {
        /** Dialog and write happen together in main; the path never reaches the renderer. */
        saveText(args: {
          defaultName: string
          ext: string
          label: string
          content: string | Uint8Array
        }): Promise<{ ok: boolean; path?: string; cancelled?: boolean; message?: string }>
      }
      rubric: {
        /** Creates a Google Doc in Drive and opens it. Needs a Google sign-in. */
        /**
         * One document holding every rubric passed, each as its own table on its own page.
         * A single-rubric run passes an array of one, so there is no separate path for it.
         */
        exportToDrive(args: {
          rubrics: RubricData[]
          documentTitle?: string
          folderId?: string
        }): Promise<{ ok: boolean; fileId?: string; webViewLink?: string; message?: string }>
        /** The same document as .html. Works with no Google account. */
        saveHtml(args: {
          rubrics: RubricData[]
          documentTitle?: string
        }): Promise<{ ok: boolean; path?: string; cancelled?: boolean; message?: string }>
      }
      google: {
        signIn(options?: { useAnotherAccount?: boolean }): Promise<GoogleSignInStatus>
        signOut(): Promise<void>
        /** Identity only — there is no call that returns the Google access token. */
        status(): Promise<GoogleSignInStatus>
        /** Fires when a stored sign-in turns out to be dead. Returns an unsubscribe function. */
        onSignedOut(callback: () => void): () => void
      }
      drive: {
        listFiles(args: {
          scope: 'recent' | 'myDrive' | 'sharedWithMe' | 'folder' | 'search'
          folderId?: string
          query?: string
          mimeTypes?: string[]
          foldersOnly?: boolean
          pageToken?: string
          pageSize?: number
        }): Promise<{ files: DriveFile[]; nextPageToken?: string }>
        /** Accepts any Drive URL shape, or a bare file id. */
        resolveUrl(
          url: string,
        ): Promise<
          | { ok: true; fileId: string; name: string; mimeType: string }
          | { ok: false; message: string }
        >
        getDocText(fileId: string): Promise<string>
        getSheetCsv(fileId: string): Promise<string>
        downloadBytes(fileId: string): Promise<Uint8Array>
        /** Bytes ready for processing; a Google Doc arrives converted to .docx. */
        fetchForProcessing(
          fileId: string,
        ): Promise<{ name: string; mimeType: string; bytes: Uint8Array }>
        upload(args: {
          content: string | Uint8Array
          name: string
          sourceMimeType: string
          targetMimeType?: string
          folderId?: string
        }): Promise<{ fileId: string; webViewLink: string }>
        /** Takes a file id, not a URL: main builds the address. */
      }
      gemini: {
        /**
         * Real return types, not `unknown` or `never`.
         *
         * These were placeholders, and `never` in particular was actively harmful: it is
         * assignable to everything, so the wrapper in geminiService.ts type-checked against
         * whatever it claimed to return while this file asserted nothing at all. Since this
         * declaration, the preload and the main-process handlers are kept in step BY HAND —
         * the two processes compile separately — the only checking on these shapes is the
         * accuracy of what is written here.
         */
        cancel(jobId: string): Promise<boolean>
        validateKey(apiKey: string): Promise<boolean>
        startNewChat(): Promise<void>
        sendMessage(a: {
          text: string
          attachments?: Attachment[]
          jobId?: string
        }): Promise<string>
        extractRubricMetadata(a: {
          attachments: Attachment[]
          jobId?: string
        }): Promise<RubricMeta[]>
        validateAssignmentDescription(a: {
          text: string
          jobId?: string
        }): Promise<{ isValid: boolean; message: string }>
        /** One number per criterion, in order. Validated by the caller before it is applied. */
        suggestPointSplit(a: {
          criteria: string[]
          totalPoints: number
          jobId?: string
        }): Promise<number[]>
        generateRubricFromDescription(a: {
          assignmentDescription: string
          settings: GenerationSettings
          jobId?: string
          /** Narrows the rubric to one deliverable. Omitted, it covers the whole description. */
          target?: { title: string; focus: string }
        }): Promise<RubricData>
        generateRubricFromScreenshot(a: {
          imageData: { data: string; mimeType: string }
          settings: GenerationSettings
          jobId?: string
        }): Promise<RubricData>
        extractRubricFromDocument(a: {
          documentText: string
          jobId?: string
        }): Promise<RubricData>
        applyRubricChanges(a: {
          rubric: RubricData
          changeRequest: string
          jobId?: string
        }): Promise<RubricData>
        analyzeCsvForCanvas(a: {
          csvContent: string
          jobId?: string
        }): Promise<CsvAnalysisResult>
        /** Main checks the proposal before returning it; an unchecked repair never arrives here. */
        repairRubricCsv(a: {
          csvContent: string
          canvasMessage: string
          jobId?: string
        }): Promise<CsvRepairResult>
        generateCsvForRubric(a: {
          rubricName: string
          totalPoints: string
          scoringMethod: 'ranges' | 'fixed'
          attachment: Attachment
          jobId?: string
        }): Promise<string>
        /**
         * The separately-submitted parts of an assignment description, for the user to confirm.
         * An empty array is a real answer — most assignments are one piece of work.
         */
        discoverDeliverables(a: {
          description: string
          jobId?: string
        }): Promise<Deliverable[]>
        discoverRubricTitles(a: {
          attachment: Attachment
          jobId?: string
        }): Promise<RubricDiscovery[]>
        /** A named subset of the document's rubrics, in one call. Missing names are omitted. */
        generateCsvsForRubrics(a: {
          attachment: Attachment
          rubricNames: string[]
          jobId?: string
        }): Promise<BatchRubricResult[]>
      }
      credentials: {
        /** Pass null to forget the stored token. Rejects if the keychain is unavailable. */
        setCanvasToken(token: string | null): Promise<void>
        /** Status only — there is no call that returns the token itself. */
        canvasTokenStatus(): Promise<CredentialStatus>
        /** Pass null to forget the stored key. */
        setGeminiApiKey(key: string | null): Promise<void>
        geminiKeyStatus(): Promise<CredentialStatus>
      }
      canvas: {
        setCourseUrl(url: string | null): Promise<{ ok: boolean; message?: string }>
        getCourseUrl(): Promise<string | null>
        verifyToken(args: { courseUrl: string }): Promise<CanvasLookup>
        getCourseName(args: { courseUrl: string }): Promise<CanvasLookup>
        /** Takes no token: main loads it from the keychain when it builds the request. */
        pushRubric(args: {
          csvContent: string
          courseUrl: string
        }): Promise<{ success: boolean; message: string }>
      }
    }
  }

  /** What the renderer may know about a stored secret: that it exists, and its last 4 chars. */
  interface CredentialStatus {
    hasValue: boolean
    hint: string
  }

  interface CanvasLookup {
    ok: boolean
    name?: string
    message?: string
  }

  /** Who is signed in. Carries no token — Drive calls fetch their own in the main process. */
  interface GoogleSignInStatus {
    signedIn: boolean
    email?: string
    name?: string
    picture?: string
  }

  interface DriveFile {
    id: string
    name: string
    mimeType: string
    modifiedTime?: string
    iconLink?: string
    isFolder: boolean
  }
}
