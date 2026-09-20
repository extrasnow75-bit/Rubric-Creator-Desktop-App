import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode, useRef, useEffect } from 'react';
import {
  SessionState,
  AppMode,
  RubricData,
  RubricMeta,
  CanvasConfig,
  BatchItem,
  UploadHistoryItem,
  ProgressState,
  GoogleUser,
} from '../types';

// Create context
const SessionContext = createContext<{
  state: SessionState;
  setCurrentStep: (step: AppMode) => void;
  setRubric: (rubric: RubricData | null) => void;
  /** Replace the whole set, opening the first. */
  setRubrics: (rubrics: RubricData[]) => void;
  /** Open one of `rubrics` in the editor. Out-of-range indexes are ignored. */
  openRubric: (index: number) => void;
  setRubricMetadata: (metadata: RubricMeta | null) => void;
  setCsvOutput: (csv: string | null, fileName?: string) => void;
  setCanvasConfig: (config: CanvasConfig | null) => void;
  addBatchItem: (item: BatchItem) => void;
  updateBatchItem: (id: string, updates: Partial<BatchItem>) => void;
  removeBatchItem: (id: string) => void;
  addToHistory: (item: UploadHistoryItem) => void;
  setError: (error: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  setTaskCompletionOpen: (open: boolean) => void;
  setProgress: (progress: Partial<ProgressState>) => void;
  startProgress: (totalItems?: number, canCancel?: boolean) => void;
  stopProgress: () => void;
  requestCancel: () => void;
  getAbortSignal: () => AbortSignal;
  clearSession: () => void;
  newBatch: () => void;
  // Gemini API Key
  /** Stores the key in the OS keychain. Rejects if no keychain is available. */
  setUserGeminiApiKey: (key: string | null) => Promise<void>;
  // Canvas API Token
  /** Stores the token in the OS keychain. Rejects if no keychain is available. */
  setUserCanvasApiToken: (token: string | null) => Promise<void>;
  // V.2 fields
  /** Validated and pinned in the main process; resolves with why it was refused. */
  setCourseUrl: (url: string | null) => Promise<{ ok: boolean; message?: string }>;
  // Google Auth methods
  /** Opens the system browser. Pass true to force Google's account chooser. */
  startGoogleAuth: (useAnotherAccount?: boolean) => Promise<void>;
  signOutGoogle: () => Promise<void>;
  extractGoogleDocText: (docUrl: string) => Promise<string>;
  extractGoogleSheetCsv: (sheetUrl: string) => Promise<string>;
  downloadDriveFile: (fileId: string) => Promise<ArrayBuffer>;
} | undefined>(undefined);

// Provider component
export const SessionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const abortControllerRef = useRef<AbortController | null>(null);
  const progressStartTimeRef = useRef<number>(0);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [state, setState] = useState<SessionState>({
    currentStep: AppMode.DASHBOARD,
    rubric: null,
    rubrics: [],
    activeRubricIndex: 0,
    rubricMetadata: null,
    csvOutput: null,
    csvFileName: null,
    canvasConfig: null,
    batchItems: [],
    uploadHistory: [],
    isLoading: false,
    error: null,
    helpOpen: false,
    taskCompletionOpen: false,
    progress: {
      isProcessing: false,
      percentage: 0,
      currentStep: '',
      timeElapsed: 0,
      timeRemaining: 0,
      bytesProcessed: 0,
      totalBytes: 0,
      itemsProcessed: 0,
      totalItems: 0,
      canCancel: false,
    },
    // Gemini API Key
    geminiKeyStatus: null,
    // Canvas API Token
    canvasTokenStatus: null,
    // V.2 fields
    courseUrl: null,
    sessionKey: 0,
    // Google Authentication
    isGoogleAuthenticated: false,
    googleUser: null,
    googleAuthError: null,
    isAuthenticating: false,
  });

  const setCurrentStep = useCallback((step: AppMode) => {
    setState((prev) => ({ ...prev, currentStep: step }));
  }, []);

  /**
   * Set the open rubric, and keep the set in step with it.
   *
   * Everything that edits a rubric — the cell editor, "request changes", replacing it from a
   * file — calls this and knows nothing about there being a set. Writing the edit back into
   * `rubrics` here is what lets all of that carry on unchanged: without it, editing the second
   * of eight rubrics would look right on screen and then save the unedited version, because the
   * document is built from the array.
   */
  const setRubric = useCallback((rubric: RubricData | null) => {
    setState((prev) => {
      if (rubric === null) return { ...prev, rubric: null, rubrics: [], activeRubricIndex: 0 };
      if (prev.rubrics.length === 0) {
        return { ...prev, rubric, rubrics: [rubric], activeRubricIndex: 0 };
      }
      return {
        ...prev,
        rubric,
        rubrics: prev.rubrics.map((r, i) => (i === prev.activeRubricIndex ? rubric : r)),
      };
    });
  }, []);

  const setRubrics = useCallback((rubrics: RubricData[]) => {
    setState((prev) => ({
      ...prev,
      rubrics,
      rubric: rubrics[0] ?? null,
      activeRubricIndex: 0,
    }));
  }, []);

  const openRubric = useCallback((index: number) => {
    setState((prev) =>
      index < 0 || index >= prev.rubrics.length
        ? prev
        : { ...prev, activeRubricIndex: index, rubric: prev.rubrics[index] },
    );
  }, []);

  const setRubricMetadata = useCallback((metadata: RubricMeta | null) => {
    setState((prev) => ({ ...prev, rubricMetadata: metadata }));
  }, []);

  const setCsvOutput = useCallback((csv: string | null, fileName?: string) => {
    setState((prev) => ({
      ...prev,
      csvOutput: csv,
      csvFileName: fileName || prev.csvFileName,
    }));
  }, []);

  const setCanvasConfig = useCallback((config: CanvasConfig | null) => {
    setState((prev) => ({ ...prev, canvasConfig: config }));
  }, []);

  const addBatchItem = useCallback((item: BatchItem) => {
    setState((prev) => ({
      ...prev,
      batchItems: [...prev.batchItems, item],
    }));
  }, []);

  const updateBatchItem = useCallback((id: string, updates: Partial<BatchItem>) => {
    setState((prev) => ({
      ...prev,
      batchItems: prev.batchItems.map((item) =>
        item.id === id ? { ...item, ...updates } : item
      ),
    }));
  }, []);

  const removeBatchItem = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      batchItems: prev.batchItems.filter((item) => item.id !== id),
    }));
  }, []);

  const addToHistory = useCallback((item: UploadHistoryItem) => {
    setState((prev) => ({
      ...prev,
      uploadHistory: [item, ...prev.uploadHistory],
    }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  const setIsLoading = useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, isLoading: loading }));
  }, []);

  const setHelpOpen = useCallback((open: boolean) => {
    setState((prev) => ({ ...prev, helpOpen: open }));
  }, []);

  const setTaskCompletionOpen = useCallback((open: boolean) => {
    setState((prev) => ({ ...prev, taskCompletionOpen: open }));
  }, []);

  const setProgress = useCallback((progress: Partial<ProgressState>) => {
    setState((prev) => ({
      ...prev,
      progress: { ...prev.progress, ...progress },
    }));
  }, []);

  const startProgress = useCallback((totalItems: number = 1, canCancel: boolean = true) => {
    abortControllerRef.current = new AbortController();
    progressStartTimeRef.current = Date.now();

    setState((prev) => ({
      ...prev,
      progress: {
        isProcessing: true,
        percentage: 0,
        currentStep: 'Starting...',
        timeElapsed: 0,
        timeRemaining: 0,
        bytesProcessed: 0,
        totalBytes: 0,
        itemsProcessed: 0,
        totalItems,
        canCancel,
      },
    }));

    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    progressIntervalRef.current = setInterval(() => {
      setState((prev) => {
        const elapsed = Date.now() - progressStartTimeRef.current;
        const percentageDecimal = prev.progress.percentage > 0
          ? prev.progress.percentage
          : (prev.progress.totalItems > 0
              ? prev.progress.itemsProcessed / prev.progress.totalItems
              : 0);
        const estimatedTotal = percentageDecimal > 0 ? elapsed / percentageDecimal : 0;
        const remaining = Math.max(0, estimatedTotal - elapsed);

        return {
          ...prev,
          progress: {
            ...prev.progress,
            timeElapsed: elapsed,
            timeRemaining: remaining,
          },
        };
      });
    }, 250);
  }, []);

  const stopProgress = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    setState((prev) => ({
      ...prev,
      progress: {
        ...prev.progress,
        isProcessing: false,
      },
    }));
  }, []);

  /**
   * Cancel whatever is running, and retire the controller.
   *
   * Nulling the ref is the whole fix. Only `startProgress` replaced the controller, so after one
   * Stop every later call to `getAbortSignal` handed back the *aborted* signal — and the four
   * features that take a signal without calling `startProgress` first (Replace from file, Request
   * changes, and two in the screenshot converter) failed instantly with "Request cancelled",
   * permanently, until the app was restarted.
   */
  const requestCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const getAbortSignal = useCallback((): AbortSignal => {
    if (!abortControllerRef.current) {
      abortControllerRef.current = new AbortController();
    }
    return abortControllerRef.current.signal;
  }, []);

  const clearSession = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setState((prev) => ({
      currentStep: AppMode.DASHBOARD,
      rubric: null,
      rubrics: [],
      activeRubricIndex: 0,
      rubricMetadata: null,
      csvOutput: null,
      csvFileName: null,
      canvasConfig: null,
      batchItems: [],
      uploadHistory: [],
      isLoading: false,
      error: null,
      helpOpen: false,
      taskCompletionOpen: false,
      progress: {
        isProcessing: false,
        percentage: 0,
        currentStep: '',
        timeElapsed: 0,
        timeRemaining: 0,
        bytesProcessed: 0,
        totalBytes: 0,
        itemsProcessed: 0,
        totalItems: 0,
        canCancel: false,
      },
      // Remount the visible screen, discarding the local state this context cannot reach.
      sessionKey: prev.sessionKey + 1,

      // Preserve credentials and V.2 setup across session clears
      geminiKeyStatus: prev.geminiKeyStatus,
      canvasTokenStatus: prev.canvasTokenStatus,
      courseUrl: prev.courseUrl,
      isGoogleAuthenticated: prev.isGoogleAuthenticated,
      googleUser: prev.googleUser,
      googleAuthError: null,
      isAuthenticating: false,
    }));
  }, []);

  const newBatch = useCallback(() => {
    setState((prev) => ({
      ...prev,
      rubric: null,
      rubrics: [],
      activeRubricIndex: 0,
      rubricMetadata: null,
      csvOutput: null,
      csvFileName: null,
      batchItems: [],
      error: null,
      isLoading: false,
    }));
  }, []);

  /**
   * Hand the Gemini key to the main process, which encrypts it into the OS keychain.
   *
   * Same one-way shape as the Canvas token: the key goes in, and what comes back is a status
   * object. It used to live in localStorage and be passed to a Gemini client running here; both
   * the key and the client are in the main process now. Pass null to forget it.
   */
  const setUserGeminiApiKey = useCallback(async (key: string | null) => {
    await window.api.credentials.setGeminiApiKey(key);
    const status = await window.api.credentials.geminiKeyStatus();
    setState((prev) => ({ ...prev, geminiKeyStatus: status }));
  }, []);

  /**
   * Save the Canvas course URL.
   *
   * Persisted by the main process rather than here, because this value decides two things that
   * are not the renderer's to decide: the only host the Canvas token will be sent to, and the
   * only Canvas host the app will open in a browser. Main validates it and refuses anything that
   * is not an HTTPS course URL on a public host.
   */
  const setCourseUrl = useCallback(async (url: string | null) => {
    const result = await window.api.canvas.setCourseUrl(url);
    if (result.ok) {
      setState((prev) => ({ ...prev, courseUrl: url }));
    }
    return result;
  }, []);

  /**
   * Hand the Canvas token to the main process, which encrypts it into the OS keychain.
   *
   * Note what does not happen here: the token is never put into React state, and it is never
   * written to localStorage. It goes straight across the IPC boundary, and what comes back is a
   * status object — a boolean and the last four characters. Pass null to forget it.
   *
   * Throws if the OS has no working keychain, so the caller can tell the user that nothing was
   * saved rather than letting them believe it was.
   */
  const setUserCanvasApiToken = useCallback(async (token: string | null) => {
    await window.api.credentials.setCanvasToken(token);
    const status = await window.api.credentials.canvasTokenStatus();
    setState((prev) => ({ ...prev, canvasTokenStatus: status }));
  }, []);

  // ── Google sign-in ─────────────────────────────────────────────────────────
  //
  // The whole flow lives in the main process: it opens the system browser, listens on a loopback
  // port for the redirect, exchanges the code with PKCE, and encrypts the refresh token into the
  // OS keychain. What comes back here is identity — name, email, avatar — and nothing else.
  //
  // This replaces a Firebase popup whose access token was kept in localStorage and passed to
  // every Drive call. Those calls now happen in main, which fetches its own token, so there is no
  // longer a Google credential anywhere in the renderer.

  const startGoogleAuth = useCallback(async (useAnotherAccount = false) => {
    setState((prev) => ({ ...prev, isAuthenticating: true, googleAuthError: null }));
    try {
      const status = await window.api.google.signIn({ useAnotherAccount });
      setState((prev) => ({
        ...prev,
        isGoogleAuthenticated: status.signedIn,
        googleUser: status.signedIn
          ? {
              id: status.email ?? '',
              email: status.email ?? '',
              name: status.name ?? status.email ?? 'Google User',
              picture: status.picture,
            }
          : null,
        googleAuthError: null,
        isAuthenticating: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed';
      // Closing the browser tab or declining consent is a decision, not a fault. Reporting it as
      // an error would put a red message on screen for someone who simply changed their mind.
      const cancelled = /cancelled|timed out/i.test(message);
      setState((prev) => ({
        ...prev,
        isAuthenticating: false,
        googleAuthError: cancelled ? null : message,
      }));
    }
  }, []);

  const signOutGoogle = useCallback(async () => {
    try {
      await window.api.google.signOut();
    } finally {
      setState((prev) => ({
        ...prev,
        isGoogleAuthenticated: false,
        googleUser: null,
        googleAuthError: null,
      }));
    }
  }, []);

  // ── Drive reads ────────────────────────────────────────────────────────────
  //
  // These no longer check for a token before calling, because there is no token here to check.
  // Main resolves one when it needs it and returns a clear "sign in again" message if it cannot,
  // which is also the right answer when a sign-in has quietly expired mid-session.

  const extractGoogleDocText = useCallback(async (docUrl: string): Promise<string> => {
    const resolved = await window.api.drive.resolveUrl(docUrl);
    if (!resolved.ok) throw new Error(resolved.message);
    return window.api.drive.getDocText(resolved.fileId);
  }, []);

  const extractGoogleSheetCsv = useCallback(async (sheetUrl: string): Promise<string> => {
    const resolved = await window.api.drive.resolveUrl(sheetUrl);
    if (!resolved.ok) throw new Error(resolved.message);
    return window.api.drive.getSheetCsv(resolved.fileId);
  }, []);

  const downloadDriveFile = useCallback(async (fileId: string): Promise<ArrayBuffer> => {
    const bytes = await window.api.drive.downloadBytes(fileId);
    // Uint8Array is what survives the IPC structured clone; mammoth and pdf.js want an
    // ArrayBuffer. Slice to the view's own bounds so a pooled buffer cannot leak extra bytes.
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }, []);

  // ── Initialization ─────────────────────────────────────────────────────────

  useEffect(() => {
    // Canvas token status and course URL both live in the main process now — the token
    // encrypted in the OS keychain, the URL in settings.json. Neither is read from localStorage.
    void (async () => {
      const empty = { hasValue: false, hint: '' };
      const [canvas, gemini, savedCourseUrl] = await Promise.all([
        window.api.credentials.canvasTokenStatus().catch(() => empty),
        window.api.credentials.geminiKeyStatus().catch(() => empty),
        window.api.canvas.getCourseUrl().catch(() => null),
      ]);
      setState((prev) => ({
        ...prev,
        canvasTokenStatus: canvas,
        geminiKeyStatus: gemini,
        courseUrl: savedCourseUrl,
      }));
    })();

    // Ask main who is signed in. The refresh token is in the keychain, so a sign-in survives
    // quitting the app entirely — there is no token expiry to nurse in the renderer.
    void window.api.google
      .status()
      .then((status) => {
        setState((prev) => ({
          ...prev,
          isGoogleAuthenticated: status.signedIn,
          googleUser: status.signedIn
            ? {
                id: status.email ?? '',
                email: status.email ?? '',
                name: status.name ?? status.email ?? 'Google User',
                picture: status.picture,
              }
            : null,
        }));
      })
      .catch(() => {
        // A failed status check must not strand the app: treat it as signed out.
      });

    // Main tells us when a stored sign-in turns out to be dead — most often the seven-day
    // refresh-token expiry that Google applies while the consent screen is in Testing. Without
    // this the panel would keep showing a signed-in user whose every Drive call fails.
    const unsubscribe = window.api.google.onSignedOut(() => {
      setState((prev) => ({
        ...prev,
        isGoogleAuthenticated: false,
        googleUser: null,
        googleAuthError: 'Your Google sign-in expired. Sign in again to use Drive.',
      }));
    });

    return () => unsubscribe();
  }, []);

  /**
   * Memoised, and the progress timer slowed to 250ms.
   *
   * `startProgress` ticks a timer that produces a new state object each time (timeElapsed
   * changes), and this object literal was rebuilt on every render — so every `useSession()`
   * consumer, which is essentially the whole app, re-rendered ten times a second for the
   * duration of every generation, conversion and upload. Part 3's batch path holds that open
   * across its ten-second inter-upload waits, so it ran for minutes at a time.
   *
   * The dependency list is every value below. It is long, but a missing entry here means a
   * stale closure in a consumer, which is a far worse failure than an extra render.
   */
  const value = useMemo(() => ({
    state,
    setCurrentStep,
    setRubric,
    setRubrics,
    openRubric,
    setRubricMetadata,
    setCsvOutput,
    setCanvasConfig,
    addBatchItem,
    updateBatchItem,
    removeBatchItem,
    addToHistory,
    setError,
    setIsLoading,
    setHelpOpen,
    setTaskCompletionOpen,
    setProgress,
    startProgress,
    stopProgress,
    requestCancel,
    getAbortSignal,
    clearSession,
    newBatch,
    setUserGeminiApiKey,
    setUserCanvasApiToken,
    setCourseUrl,
    startGoogleAuth,
    signOutGoogle,
    extractGoogleDocText,
    extractGoogleSheetCsv,
    downloadDriveFile,
  }), [state]);

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
};

// Hook to use the session context
export const useSession = () => {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};
