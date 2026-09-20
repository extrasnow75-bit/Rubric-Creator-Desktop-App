import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { useDrivePicker } from '../contexts/DrivePickerContext';
import { fetchDriveFileAsBase64 } from '../utils/driveFile';
import {
  Key, Check, X, Loader2, ExternalLink, Eye, EyeOff,
  LogOut, Link, FileText, Upload, ChevronDown, FolderOpen, Settings2,
  Lightbulb, Camera, ArrowRight, Clipboard, HardDrive, Clock, ChevronUp,
} from 'lucide-react';
import { getRecentDocs, saveRecentDoc, RecentDoc } from '../utils/recentDocs';
import { revealSection, REVEAL_DELAY_MS } from '../utils/revealSection';
import { AppMode } from '../types';
import { validateGeminiApiKey } from '../services/geminiService';
import { AnalyzeDeploySection, UploadedDocFile } from './AnalyzeDeploySection';
import { Part1Rubric } from './Part1Rubric';
import { ScreenshotConverter } from './ScreenshotConverter';

// ─── Google Icon ──────────────────────────────────────────────────────────────

const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="currentColor" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="currentColor" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="currentColor" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="currentColor" />
  </svg>
);

// ─── Card wrapper with green-glow ─────────────────────────────────────────────

const SetupCard: React.FC<{
  children: React.ReactNode;
  isValid: boolean;
  isOptional?: boolean;
  noGlow?: boolean;
}> = ({ children, isValid, isOptional = false, noGlow = false }) => (
  <div
    className={`bg-white rounded-2xl border-2 p-6 shadow-sm transition-all duration-300 ${
      isValid && !noGlow
        ? 'border-green-400 ring-2 ring-green-300 ring-offset-1 shadow-green-100'
        : isValid && noGlow
        ? 'border-green-300'
        : isOptional
        ? 'border-gray-100'
        : 'border-gray-200'
    }`}
  >
    {children}
  </div>
);

// ─── Course URL validator ─────────────────────────────────────────────────────

const isCourseUrlValid = (url: string) =>
  /^https?:\/\/.+\/courses\/\d+/i.test(url.trim());

// ─── Main Component ───────────────────────────────────────────────────────────

export const Dashboard: React.FC = () => {
  const {
    state,
    startGoogleAuth,
    signOutGoogle,
    setUserGeminiApiKey,
    setUserCanvasApiToken,
    setCourseUrl,
    setCurrentStep,
    setHelpOpen,
    downloadDriveFile,
    setRubric,
  } = useSession();
  const { pickFile } = useDrivePicker();

  // ── Gemini API Key ──
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [keyValidationResult, setKeyValidationResult] = useState<'idle' | 'valid' | 'invalid'>('idle');

  // ── Canvas Token ──
  const [canvasTokenInput, setCanvasTokenInput] = useState('');
  const [showCanvasToken, setShowCanvasToken] = useState(false);
  const [canvasTokenError, setCanvasTokenError] = useState<string | null>(null);

  /**
   * Whether the saved token has actually been used against Canvas, as opposed to merely stored.
   *
   * "Token saved" was shown the moment a string reached the keychain, which says nothing about
   * whether Canvas accepts it. A revoked or mistyped token looked exactly like a working one
   * until a deploy failed — after conversion had already spent Gemini quota.
   *
   * Checking needs a Canvas host, which only a course URL supplies, so this cannot run when the
   * token is first pasted. It runs at launch against the remembered course, and any successful
   * course lookup counts as proof on its own: that call sends the token too.
   */
  const [tokenCheck, setTokenCheck] = useState<
    { state: 'unchecked' | 'checking' | 'ok' | 'failed'; message?: string }
  >({ state: 'unchecked' });

  // ── Course URL ──
  const [courseUrlInput, setCourseUrlInput] = useState(state.courseUrl || '');

  /**
   * Prefill with the course used last time, so only the course ID needs changing.
   *
   * The initialiser above cannot do this on its own: the saved URL lives in settings.json and
   * reaches the renderer over IPC, which resolves *after* the first render, so state.courseUrl
   * is still null when useState reads it. This fills the field when the value actually lands.
   *
   * Guarded by a ref rather than by comparing values, because the user may deliberately clear
   * the field — and refilling what someone has just emptied is worse than not prefilling.
   */
  const courseUrlTouched = useRef(false);
  useEffect(() => {
    if (courseUrlTouched.current || !state.courseUrl) return;
    setCourseUrlInput(state.courseUrl);
  }, [state.courseUrl]);
  const courseUrlValid = isCourseUrlValid(courseUrlInput);

  // ── Course Name ──
  const [courseName, setCourseName] = useState<string | null>(null);
  const [courseNameLoading, setCourseNameLoading] = useState(false);
  const [courseNameError, setCourseNameError] = useState<string | null>(null);

  /** Green means the course was found, not that the string matched a regex. */
  const courseVerified = courseUrlValid && !!courseName;

  // ── Draft Rubric Document ──
  const [hasDraftRubric, setHasDraftRubricLocal] = useState<'' | 'yes' | 'no'>('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedDocFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [docFileError, setDocFileError] = useState<string | null>(null);
  const [isPasteAreaFocused, setIsPasteAreaFocused] = useState(false);
  /**
   * Google Drive is where this team's documents actually live, so it opens on that tab.
   *
   * It stays on Local when nobody is signed in, because the Google tab signed out is a sign-in
   * prompt rather than a way to choose a file — and the person most likely to be signed out is
   * the one whose Google login is misbehaving, who needs the local path to still work.
   *
   * The initialiser cannot decide this on its own: isGoogleAuthenticated starts false and only
   * becomes true when the sign-in status arrives from the main process, which is after the first
   * render. Reading it here would pick Local every time, including for a signed-in user. The
   * effect below switches once the answer actually lands — the same shape as the course URL
   * prefill above, and for the same reason.
   */
  const [docUploadTab, setDocUploadTab] = useState<'local' | 'google'>('local');

  /** Guarded by a ref so choosing a tab by hand is never undone by the status arriving late. */
  const docUploadTabTouched = useRef(false);
  useEffect(() => {
    if (docUploadTabTouched.current || !state.isGoogleAuthenticated) return;
    setDocUploadTab('google');
  }, [state.isGoogleAuthenticated]);

  const chooseDocUploadTab = (tab: 'local' | 'google') => {
    docUploadTabTouched.current = true;
    setDocUploadTab(tab);
  };
  const [driveUrl, setDriveUrl] = useState('');
  const [isFetchingDriveUrl, setIsFetchingDriveUrl] = useState(false);
  const [driveUrlError, setDriveUrlError] = useState<string | null>(null);
  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>(() => getRecentDocs());
  const [showRecentDocs, setShowRecentDocs] = useState(false);
  const pasteAreaRef = useRef<HTMLDivElement>(null);

  // ── Analyze & Deploy ──
  const [showAnalyze, setShowAnalyze] = useState(false);
  const [analyzeRubricSource, setAnalyzeRubricSource] = useState<'yes' | 'no' | null>(null);
  const analyzeRef = useRef<HTMLDivElement>(null);

  // ── Phase 1 inline mode ──
  const [phase1Mode, setPhase1Mode] = useState<'none' | 'rubric' | 'screenshot'>('none');
  const phase1Ref = useRef<HTMLDivElement>(null);

  // ─── Derived validity ────────────────────────────────────────────────────────

  const geminiValid = !!state.geminiKeyStatus?.hasValue;
  const canvasTokenValid = !!state.canvasTokenStatus?.hasValue;
  const googleSignedIn = state.isGoogleAuthenticated;
  const draftRubricValid =
    hasDraftRubric === 'yes' ? uploadedFiles.length > 0 : hasDraftRubric === 'no';

  // Core setup = Gemini + Canvas Token (determines when workflow cards appear)
  const coreSetupComplete = geminiValid && canvasTokenValid;

  // All setup done (including optional Google) = when collapsible auto-closes
  const allSetupComplete = geminiValid && canvasTokenValid && googleSignedIn;

  const allRequiredValid = geminiValid && canvasTokenValid && courseUrlValid && draftRubricValid;

  // ── Initial Setup header status text ──
  const requiredRemaining = [!geminiValid, !canvasTokenValid].filter(Boolean).length;
  const setupStatusText = allSetupComplete
    ? 'Complete'
    : requiredRemaining === 0 && !googleSignedIn
    ? 'Optional: Sign in to Google?'
    : `${requiredRemaining} item${requiredRemaining === 1 ? '' : 's'} remaining`;
  const setupStatusColor = allSetupComplete ? 'text-green-400' : 'text-white/90';

  // ── Collapsible Initial Setup ──
  const [isSetupOpen, setIsSetupOpen] = useState(!allSetupComplete);
  const setupRef = useRef<HTMLDivElement>(null);

  /**
   * Open Initial Setup and take the user to it.
   *
   * Offered by the deploy failure panel for the causes a credential or the course URL would fix.
   * Opening the card without moving to it would be its own version of the problem — the panel is
   * near the bottom of a long page, so the card expands somewhere the user cannot see.
   */
  const handleOpenSetup = useCallback(() => {
    setIsSetupOpen(true);
    window.setTimeout(() => revealSection(setupRef.current), REVEAL_DELAY_MS);
  }, []);

  // Auto-collapse only when all three setup items are complete (including Google)
  useEffect(() => {
    if (allSetupComplete) setIsSetupOpen(false);
  }, [allSetupComplete]);

  /**
   * One check at launch, against the course used last time.
   *
   * Deliberately not tied to courseUrlInput: this is about the token, not the course, and it must
   * not re-fire while someone types. A failure here is worth surfacing before any work begins —
   * a dead token discovered at deploy time has already cost a conversion.
   */
  useEffect(() => {
    if (!canvasTokenValid || !state.courseUrl) return;
    let cancelled = false;
    setTokenCheck({ state: 'checking' });
    window.api.canvas
      .verifyToken({ courseUrl: state.courseUrl })
      .then((result) => {
        if (cancelled) return;
        setTokenCheck(
          result.ok
            ? { state: 'ok' }
            : { state: 'failed', message: result.message ?? 'Canvas did not accept this token.' },
        );
      })
      .catch(() => {
        // Offline, or Canvas unreachable. Not evidence the token is bad, so say nothing rather
        // than accusing a good token.
        if (!cancelled) setTokenCheck({ state: 'unchecked' });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasTokenValid, state.courseUrl]);

  // ── Fetch course name when URL and token are both valid ──
  //
  // The lookup happens in the main process, which loads the token from the keychain itself. This
  // used to be a fetch from here with the token in an Authorization header, routed through the
  // Canvas proxy to get around CORS; neither the proxy nor the token is in the renderer now.
  useEffect(() => {
    if (!courseUrlValid || !canvasTokenValid) {
      setCourseName(null);
      setCourseNameError(null);
      return;
    }
    let cancelled = false;
    setCourseNameLoading(true);
    // Debounced: the effect depends on the live input, so every additional character typed
    // after the URL first became valid fired another authenticated request to the institution's
    // Canvas. The `cancelled` flag protected the state, not the network.
    setCourseNameError(null);
    const timer = window.setTimeout(() => {
      window.api.canvas
        .getCourseName({ courseUrl: courseUrlInput.trim() })
        .then((result) => {
          if (cancelled) return;
          if (result.ok && result.name) {
            setCourseName(result.name);
            // This call carried the token, so a named course is proof it works.
            setTokenCheck({ state: 'ok' });
          } else {
            // Main returns a specific reason — wrong host, no token, 404, unreachable.
            // Showing it is the difference between "the app is broken" and "fix the URL".
            setCourseName(null);
            setCourseNameError(result.message ?? 'Could not load this course.');
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setCourseNameError(e instanceof Error ? e.message : 'Could not load this course.');
          }
        })
        .finally(() => {
          if (!cancelled) setCourseNameLoading(false);
        });
    }, 500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [courseUrlValid, canvasTokenValid, courseUrlInput]);

  // ─── Handlers ────────────────────────────────────────────────────────────────


  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setIsValidatingKey(true);
    setKeyValidationResult('idle');
    const isValid = await validateGeminiApiKey(apiKeyInput.trim());
    if (isValid) {
      try {
        await setUserGeminiApiKey(apiKeyInput.trim());
        setKeyValidationResult('valid');
        setApiKeyInput('');
      } catch {
        // The key works but the OS keychain would not store it. Treat that as a failure to
        // save rather than a bad key, so the user is not sent hunting for a new one.
        setKeyValidationResult('invalid');
      }
    } else {
      setKeyValidationResult('invalid');
    }
    setIsValidatingKey(false);
  };

  const handleRemoveApiKey = async () => {
    await setUserGeminiApiKey(null).catch(() => undefined);
    setKeyValidationResult('idle');
    setApiKeyInput('');
  };

  const handleSaveCanvasToken = async () => {
    const trimmed = canvasTokenInput.trim();
    if (!trimmed) return;
    if (trimmed.length < 20) {
      setCanvasTokenError('Token looks too short — Canvas tokens are usually 64+ characters.');
      return;
    }
    if (/[\s<>"'`]/.test(trimmed)) {
      setCanvasTokenError('Token contains invalid characters. Please paste only the token itself.');
      return;
    }
    setCanvasTokenError(null);
    try {
      await setUserCanvasApiToken(trimmed);
      setCanvasTokenInput('');
    } catch (e) {
      // The OS keychain is unavailable, so nothing was stored. Say so plainly: silently keeping
      // the token in memory would let the user believe setup is finished when it is not.
      setCanvasTokenError(e instanceof Error ? e.message : 'Could not save the token securely.');
    }
  };

  const handleRemoveCanvasToken = async () => {
    try {
      await setUserCanvasApiToken(null);
    } catch {
      // Nothing stored means nothing to remove.
    }
  };

  const handleCourseUrlChange = (val: string) => {
    courseUrlTouched.current = true;
    setCourseUrlInput(val);
    if (isCourseUrlValid(val)) setCourseUrl(val.trim());
    else setCourseUrl(null);
  };

  const handleDraftRubricChange = (val: '' | 'yes' | 'no') => {
    setHasDraftRubricLocal(val);
    setPhase1Mode('none');
    if (val === 'no') {
      setUploadedFiles([]);
      setShowAnalyze(false);
    }
    if (val === 'yes') {
      setShowAnalyze(false);
    }
  };

  // ── File handling ──

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  /**
   * Accept the same formats the Drive tab beside this one already advertises.
   *
   * PDFs used to be dropped here: the file picker filtered them out and a dragged PDF hit the
   * `return` below, which added nothing and said nothing. The card next to it promised "Google
   * Docs, Word (.docx), and PDF files stored in Drive", and Part 2 has always taken local PDFs —
   * so the same file worked from Drive and silently did nothing from the desktop. Nothing in the
   * main process needed changing: a non-.docx attachment goes to the model as inline data, which
   * is how the Drive route has been sending PDFs all along.
   */
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const isSupported = (f: File) =>
      f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      f.type === 'application/msword' ||
      f.type === 'application/pdf' ||
      f.name.toLowerCase().endsWith('.docx') ||
      f.name.toLowerCase().endsWith('.doc') ||
      f.name.toLowerCase().endsWith('.pdf');

    const docs = arr.filter(isSupported);
    const rejected = arr.filter((f) => !isSupported(f));

    // Say what was refused. Returning quietly is what made a dropped PDF look like a broken app.
    setDocFileError(
      rejected.length === 0
        ? null
        : `${rejected.map((f) => f.name).join(', ')} — this box takes Word (.docx) or PDF files.`,
    );

    if (docs.length === 0) return;
    const converted = await Promise.all(
      docs.map(async (f) => ({
        name: f.name,
        data: await readFileAsBase64(f),
        mimeType:
          f.type ||
          (f.name.toLowerCase().endsWith('.pdf')
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      })),
    );
    setUploadedFiles((prev) => {
      const existingNames = new Set(prev.map((p) => p.name));
      return [...prev, ...converted.filter((c) => !existingNames.has(c.name))];
    });
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      await addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) await addFiles(e.target.files);
      e.target.value = '';
    },
    [addFiles],
  );

  const handlePasteAreaPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = Array.from(e.clipboardData.items);
      const fileItem = items.find((item) =>
        item.kind === 'file' &&
        (item.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          item.type === 'application/msword' ||
          item.type === '')
      );
      if (fileItem) {
        const file = fileItem.getAsFile();
        if (file) {
          const list = new DataTransfer();
          list.items.add(file);
          await addFiles(list.files);
        }
      }
    },
    [addFiles],
  );

  const handleGooglePicker = async () => {
    try {
      const result = await pickFile();
      if (!result) return;

      // One call gets the bytes, already converted to .docx if this was a Google Doc.
      const file = await fetchDriveFileAsBase64(result.fileId);
      setUploadedFiles((prev) => {
        if (prev.some((p) => p.name === file.name)) return prev;
        return [...prev, { name: file.name, data: file.base64, mimeType: file.mimeType }];
      });
      saveRecentDoc({
        name: file.name,
        fileId: result.fileId,
        mimeType: result.mimeType,
        source: 'picker',
      });
      setRecentDocs(getRecentDocs());
    } catch (err) {
      setDriveUrlError(
        `Could not open that file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleFetchFromDriveUrl = async () => {
    if (!driveUrl.trim() || !state.isGoogleAuthenticated) return;
    setIsFetchingDriveUrl(true);
    setDriveUrlError(null);
    try {
      const resolved = await window.api.drive.resolveUrl(driveUrl.trim());
      if (!resolved.ok) throw new Error(resolved.message);
      const file = await fetchDriveFileAsBase64(resolved.fileId);
      setUploadedFiles((prev) => {
        if (prev.some((p) => p.name === file.name)) return prev;
        return [...prev, { name: file.name, data: file.base64, mimeType: file.mimeType }];
      });
      saveRecentDoc({ name: file.name, url: driveUrl.trim(), source: 'url' });
      setRecentDocs(getRecentDocs());
      setDriveUrl('');
    } catch (err) {
      setDriveUrlError(
        `Could not fetch file: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsFetchingDriveUrl(false);
    }
  };

  const handleRecentDocClick = async (doc: RecentDoc) => {
    setShowRecentDocs(false);
    if (doc.source === 'url' && doc.url) {
      setDriveUrl(doc.url);
      return;
    }
    if (doc.source === 'picker' && doc.fileId && state.isGoogleAuthenticated) {
      try {
        const file = await fetchDriveFileAsBase64(doc.fileId);
        setUploadedFiles((prev) => {
          if (prev.some((p) => p.name === file.name)) return prev;
          return [...prev, { name: file.name, data: file.base64, mimeType: file.mimeType }];
        });
      } catch (err) {
        setDriveUrlError(
          `Could not reload document: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  const handleAnalyzeDeploy = (source: 'yes' | 'no') => {
    setAnalyzeRubricSource(source);
    setShowAnalyze(true);
    setTimeout(() => revealSection(analyzeRef.current), REVEAL_DELAY_MS);
  };

  /**
   * Choosing a Phase 1 option renders the next step below the fold, which reads as a dead
   * button. Bring it into view and move focus into it once it has mounted.
   *
   * Deliberately not in the click handler: the section is not in the DOM until this render
   * commits, so there would be nothing to scroll to.
   */
  useEffect(() => {
    if (phase1Mode === 'none') return;
    const timer = window.setTimeout(() => revealSection(phase1Ref.current), REVEAL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [phase1Mode]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">

      <div className="space-y-4">

        {/* ── Initial Setup Collapsible ── */}
        <div
          ref={setupRef}
          tabIndex={-1}
          role="region"
          aria-label="Initial setup"
          className="rounded-2xl overflow-hidden shadow-md focus:outline-none"
        >

          {/* Header */}
          <button
            onClick={() => setIsSetupOpen((v) => !v)}
            className="w-full bg-brand hover:bg-brand-dark text-white px-6 py-4 flex items-center gap-3 transition-colors cursor-pointer text-left"
          >
            <Settings2 className="w-5 h-5 flex-shrink-0" />
            <span className="font-black text-base">Initial Setup</span>
            <div className="ml-auto flex items-center gap-3">
              {/* Status dots + text */}
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2">
                  <div
                    title="Gemini API Key"
                    className={`w-2.5 h-2.5 rounded-full transition-colors ${geminiValid ? 'bg-green-400' : 'bg-white/30'}`}
                  />
                  <div
                    title="Canvas API Token"
                    className={`w-2.5 h-2.5 rounded-full transition-colors ${canvasTokenValid ? 'bg-green-400' : 'bg-white/30'}`}
                  />
                  <div
                    title="Google Sign-In (optional)"
                    className={`w-2.5 h-2.5 rounded-full transition-colors ${googleSignedIn ? 'bg-green-400 opacity-80' : 'bg-white/20'}`}
                  />
                </div>
                <span className={`text-xs font-bold leading-none ${setupStatusColor}`}>
                  {setupStatusText}
                </span>
              </div>
              <ChevronDown
                className={`w-5 h-5 transition-transform duration-300 ${isSetupOpen ? 'rotate-180' : ''}`}
              />
            </div>
          </button>

          {/* Collapsible body */}
          {isSetupOpen && (
            <div className="bg-gray-50 px-4 pb-4 pt-3 space-y-3 border border-gray-100 border-t-0 rounded-b-2xl">

              {/* Card 1: Gemini API Key */}
              <SetupCard isValid={geminiValid}>
                <div className="flex items-center gap-2 mb-1">
                  <Key className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <h3 className="font-black text-lg text-gray-900">Gemini API Key</h3>
                  {geminiValid && <Check className="w-4 h-4 text-green-500 ml-auto flex-shrink-0" />}
                </div>
                {geminiValid ? (
                  <div>
                    <div className="flex items-center gap-2 mt-2 mb-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                      <span className="text-sm font-bold text-green-700">API key active</span>
                    </div>
                    <p className="text-xs text-gray-600 font-mono mb-3">
                      In your keychain, ending …{state.geminiKeyStatus?.hint}
                    </p>
                    <button onClick={handleRemoveApiKey} className="w-full px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-bold hover:bg-gray-50 transition-all text-sm flex items-center justify-center gap-2">
                      <LogOut className="w-4 h-4" /> Remove Key
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-600 mb-3">Enter your free Google Gemini API key to enable AI features.</p>
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => { setApiKeyInput(e.target.value); setKeyValidationResult('idle'); }}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
                      placeholder="Paste your API key here..."
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-mono focus:border-amber-400 focus:outline-none transition-all mb-3"
                    />
                    {keyValidationResult === 'invalid' && (
                      <div className="flex items-center gap-2 mb-3 text-red-600">
                        <X className="w-4 h-4" />
                        <span className="text-xs font-bold">Invalid API key. Please check and try again.</span>
                      </div>
                    )}
                    <button
                      onClick={handleSaveApiKey}
                      disabled={!apiKeyInput.trim() || isValidatingKey}
                      className="w-full px-4 py-3 bg-brand text-white rounded-xl font-black hover:bg-brand-dark transition-all text-sm disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2"
                    >
                      {isValidatingKey ? <><Loader2 className="w-4 h-4 animate-spin" /> Validating...</> : <><Check className="w-4 h-4" /> Save Key</>}
                    </button>
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1 mt-3 text-xs text-blue-600 hover:text-blue-800 font-bold hover:underline">
                      Get a free key at aistudio.google.com <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </SetupCard>

              {/* Card 2: Canvas API Token */}
              <SetupCard isValid={canvasTokenValid}>
                <div className="flex items-center gap-2 mb-1">
                  <Key className="w-4 h-4 text-red-600 flex-shrink-0" />
                  <h3 className="font-black text-lg text-gray-900">Canvas API Token</h3>
                  {canvasTokenValid && tokenCheck.state === 'ok' && (
                    <Check className="w-4 h-4 text-green-500 ml-auto flex-shrink-0" />
                  )}
                </div>
                {canvasTokenValid ? (
                  <div>
                    {/* Saved and working are different claims, and the app used to make only the
                        stronger-sounding one. */}
                    <div className="flex items-center gap-2 mt-2 mb-1">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          tokenCheck.state === 'ok'
                            ? 'bg-green-500'
                            : tokenCheck.state === 'failed'
                            ? 'bg-red-500'
                            : 'bg-gray-400'
                        }`}
                      />
                      <span
                        className={`text-sm font-bold ${
                          tokenCheck.state === 'ok'
                            ? 'text-green-700'
                            : tokenCheck.state === 'failed'
                            ? 'text-red-700'
                            : 'text-gray-700'
                        }`}
                      >
                        {tokenCheck.state === 'ok'
                          ? 'Token checked — Canvas accepted it'
                          : tokenCheck.state === 'checking'
                          ? 'Checking this token with Canvas…'
                          : tokenCheck.state === 'failed'
                          ? 'Canvas rejected this token'
                          : 'Token saved — not checked yet'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 font-mono mb-3">
                      In your keychain, ending …{state.canvasTokenStatus?.hint}
                    </p>
                    {tokenCheck.state === 'failed' && (
                      <p role="alert" className="text-sm font-bold text-red-700 mb-3">
                        {tokenCheck.message}
                      </p>
                    )}
                    {tokenCheck.state === 'unchecked' && (
                      <p className="text-xs text-gray-600 mb-3">
                        It is checked the first time a Canvas course is confirmed below.
                      </p>
                    )}
                    <button onClick={handleRemoveCanvasToken} className="w-full px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-bold hover:bg-gray-50 transition-all text-sm flex items-center justify-center gap-2">
                      <LogOut className="w-4 h-4" /> Remove Token
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-600 mb-3">Required for deploying rubrics to Canvas. Generate a token from your Canvas account settings.</p>
                    <div className="relative mb-3">
                      <input
                        type={showCanvasToken ? 'text' : 'password'}
                        value={canvasTokenInput}
                        onChange={(e) => { setCanvasTokenInput(e.target.value); setCanvasTokenError(null); }}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveCanvasToken()}
                        placeholder="Paste your Canvas token here..."
                        className={`w-full px-4 py-3 border-2 rounded-xl text-sm font-mono focus:outline-none transition-all pr-10 ${canvasTokenError ? 'border-red-400' : 'border-gray-200 focus:border-red-400'}`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCanvasToken((v) => !v)}
                        aria-label={showCanvasToken ? 'Hide Canvas token' : 'Show Canvas token'}
                        className="absolute right-3 top-3.5 text-gray-600 hover:text-gray-900"
                      >
                        {showCanvasToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {canvasTokenError && (
                      <p className="text-xs text-red-600 mb-3 flex items-start gap-1">
                        <X className="w-3 h-3 mt-0.5 flex-shrink-0" /> {canvasTokenError}
                      </p>
                    )}
                    <button
                      onClick={handleSaveCanvasToken}
                      disabled={!canvasTokenInput.trim()}
                      className="w-full px-4 py-3 bg-brand text-white rounded-xl font-black hover:bg-brand-dark transition-all text-sm disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2"
                    >
                      <Check className="w-4 h-4" /> Save Token
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('openHelpSection', { detail: 'canvas-setup' }));
                        setHelpOpen(true);
                      }}
                      className="w-full mt-2 text-sm text-blue-600 hover:text-blue-800 font-bold hover:underline text-center"
                    >
                      How do I get one?
                    </button>
                  </div>
                )}
              </SetupCard>

              {/* Card 3: Google Sign-In (optional) — after Canvas Token */}
              <SetupCard isValid={googleSignedIn} isOptional>
                {!googleSignedIn ? (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <GoogleIcon />
                      <h3 className="font-black text-lg text-gray-900">Google Sign-In</h3>
                      <span className="ml-auto text-xs text-gray-600 font-bold uppercase tracking-wide">Optional</span>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">Sign in to select rubric documents directly from Google Drive.</p>
                    <button
                      onClick={() => startGoogleAuth()}
                      disabled={state.isAuthenticating}
                      className="w-full px-6 py-3 bg-white border-2 border-blue-400 text-blue-600 rounded-xl font-black hover:bg-blue-50 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {state.isAuthenticating ? <><Loader2 className="w-5 h-5 animate-spin" /> Signing in...</> : <><GoogleIcon /> Sign In with Google</>}
                    </button>
                    {state.googleAuthError && (
                      <p className="text-xs text-red-600 mt-2 flex items-start gap-1">
                        <X className="w-3 h-3 mt-0.5 flex-shrink-0" /> {state.googleAuthError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    {state.googleUser?.picture && (
                      <img src={state.googleUser.picture} alt="Profile" className="w-12 h-12 rounded-full border-2 border-green-300 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-black text-gray-900 truncate">{state.googleUser?.name}</p>
                        <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                      </div>
                      <p className="text-xs text-gray-600 truncate">{state.googleUser?.email}</p>
                    </div>
                    <button onClick={() => signOutGoogle()} className="px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-bold hover:bg-gray-50 transition-all text-xs flex items-center gap-1 flex-shrink-0">
                      <LogOut className="w-3 h-3" /> Sign Out
                    </button>
                  </div>
                )}
              </SetupCard>

            </div>
          )}
        </div>

        {/* ── Draft Rubric Document — appears once core setup is complete ── */}
        {coreSetupComplete && (
          <SetupCard isValid={draftRubricValid} noGlow>
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 flex-shrink-0" style={{ color: '#4285F4' }} />
              <h3 className="font-black text-lg text-gray-900">Draft Rubric Document</h3>
              {draftRubricValid && <Check className="w-4 h-4 text-green-500 ml-auto flex-shrink-0" />}
            </div>
            <p className="text-sm text-gray-600 mb-3">Do you already have a draft rubric document ready to deploy?</p>

            <div className="relative mb-4">
              <select
                value={hasDraftRubric}
                onChange={(e) => handleDraftRubricChange(e.target.value as '' | 'yes' | 'no')}
                className="w-full appearance-none px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-brand focus:outline-none transition-all bg-white font-medium text-gray-700 cursor-pointer"
              >
                <option value="">Select...</option>
                <option value="yes">Yes - I have a draft rubric document</option>
                <option value="no">No - I need to create one first</option>
              </select>
              <ChevronDown className="absolute right-3 top-3.5 w-4 h-4 text-gray-600 pointer-events-none" />
            </div>

            {/* "Yes" path — tabbed file upload area */}
            {hasDraftRubric === 'yes' && (
              <div className="space-y-3">

                {/* Tabs */}
                <div className="flex border-b border-gray-200">
                  <button
                    onClick={() => chooseDocUploadTab('local')}
                    className={`flex items-center gap-1.5 px-4 py-2.5 font-bold text-sm transition-all border-b-2 -mb-px ${
                      docUploadTab === 'local'
                        ? 'border-brand text-brand'
                        : 'border-transparent text-gray-600 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <HardDrive className="w-4 h-4" /> From Local Drive
                  </button>
                  <button
                    onClick={() => chooseDocUploadTab('google')}
                    className={`flex items-center gap-1.5 px-4 py-2.5 font-bold text-sm transition-all border-b-2 -mb-px ${
                      docUploadTab === 'google'
                        ? 'border-brand text-brand'
                        : 'border-transparent text-gray-600 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <FolderOpen className="w-4 h-4" /> From Google Drive
                  </button>
                </div>

                {/* From Local Drive tab */}
                {docUploadTab === 'local' && (
                  <>
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                      className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${
                        isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/30'
                      }`}
                    >
                      {/* The input covers the zone rather than being hidden and clicked through a
                          ref. `display:none` takes an element out of the tab order, so the only
                          way to reach this was a mouse; an opacity-0 input over the same area is
                          focusable, activates on Enter or Space, and still lets the drop handler
                          above take the event (handleDrop preventDefaults, so the file never
                          reaches the input's own default). */}
                      <input
                        type="file"
                        accept=".docx,.doc,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/pdf"
                        multiple
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        aria-label="Drop a Word (.docx) or PDF file here, or click to browse"
                        onChange={handleFileInput}
                      />
                      <FileText className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                      <p className="text-sm font-bold text-gray-700">Drop a Word (.docx) or PDF file here, or click to browse</p>
                    </div>
                  </>
                )}

                {/* From Google Drive tab */}
                {docUploadTab === 'google' && (
                  <>
                    {/* Signed-in status */}
                    {googleSignedIn && state.googleUser && (
                      <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-bold text-green-900">{state.googleUser.name}</p>
                            <p className="text-xs text-green-700">{state.googleUser.email}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => signOutGoogle()}
                          className="text-xs font-bold text-gray-600 hover:text-red-600 transition-colors"
                        >
                          Sign Out
                        </button>
                      </div>
                    )}

                    {/* Browse Google Drive button */}
                    <button
                      onClick={handleGooglePicker}
                      disabled={!googleSignedIn}
                      className="w-full py-3 px-4 bg-brand text-white rounded-xl font-bold hover:bg-brand-dark disabled:bg-gray-200 disabled:text-gray-400 transition-all flex items-center justify-center gap-2"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Browse Google Drive
                    </button>

                    {!googleSignedIn && (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                        <p className="text-sm font-bold text-gray-700 mb-1">Google sign-in required</p>
                        <p className="text-xs text-gray-600 mb-3">Sign in to pick files directly from your Drive.</p>
                        <button
                          onClick={() => startGoogleAuth()}
                          className="w-full py-2.5 px-4 bg-white border border-gray-300 rounded-lg font-bold text-sm text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all flex items-center justify-center gap-2"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                          </svg>
                          Sign in with Google
                        </button>
                      </div>
                    )}

                    {/* Recent Documents */}
                    {recentDocs.length > 0 && (
                      <div>
                        <button
                          onClick={() => setShowRecentDocs(!showRecentDocs)}
                          className="flex items-center gap-2 text-sm font-bold text-gray-700 hover:text-gray-900 transition-colors"
                        >
                          <Clock className="w-4 h-4" />
                          Recent Documents
                          {showRecentDocs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {showRecentDocs && (
                          <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden">
                            {recentDocs.map((doc, i) => (
                              <button
                                key={i}
                                onClick={() => handleRecentDocClick(doc)}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-all text-left border-b border-gray-100 last:border-0"
                              >
                                <FileText className="w-4 h-4 text-gray-600 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-gray-900 truncate">{doc.name}</p>
                                  <p className="text-xs text-gray-600">
                                    {doc.source === 'picker' ? 'Drive Picker' : 'URL'} · {new Date(doc.timestamp).toLocaleDateString()}
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* OR divider */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-gray-200" />
                      <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">Or Paste a URL</span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>

                    {/* Drive URL input */}
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1.5">Google Drive URL</label>
                      <input
                        type="url"
                        value={driveUrl}
                        onChange={(e) => { setDriveUrl(e.target.value); setDriveUrlError(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleFetchFromDriveUrl(); }}
                        placeholder="docs.google.com/document/d/... or drive.google.com/file/d/..."
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:border-brand focus:outline-none transition-all"
                      />
                      {driveUrlError && (
                        <p className="text-xs text-red-600 mt-1">{driveUrlError}</p>
                      )}
                      <p className="text-xs text-blue-700 mt-1.5">
                        Supports Google Docs, Word (.docx), and PDF files stored in Drive.{' '}
                        <span className="text-gray-600">The file must be accessible to your signed-in account.</span>
                      </p>
                      <button
                        onClick={handleFetchFromDriveUrl}
                        disabled={!driveUrl.trim() || isFetchingDriveUrl || !googleSignedIn}
                        className="w-full mt-2 py-2.5 px-4 bg-blue-100 text-blue-700 rounded-xl font-bold hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 transition-all text-sm flex items-center justify-center gap-2"
                      >
                        {isFetchingDriveUrl && <Loader2 className="w-4 h-4 animate-spin" />}
                        {isFetchingDriveUrl ? 'Fetching…' : 'Fetch from Drive'}
                      </button>
                    </div>
                  </>
                )}

                {/* Mounted only when there is something to say, but announced when it appears: a file

                    silently refused is what made a dropped PDF look like a broken app. */}

                {docFileError && (

                  <p role="alert" className="mt-3 text-sm font-bold text-red-700">

                    {docFileError}

                  </p>

                )}


                {uploadedFiles.length > 0 && (
                  <div className="space-y-1">
                    {/*
                      This list is a queue, not a history. Every file in it is analysed and every
                      rubric found in it is deployed. It sits below the inputs and just beneath a
                      section called "Recent Documents", so without a heading it reads as a record
                      of what has been picked rather than a statement of what is about to happen —
                      and a file left here by mistake means duplicate rubrics in the course, since
                      deploying only ever adds and never replaces.
                    */}
                    <p className="text-xs font-black text-gray-700 uppercase tracking-widest mb-2">
                      Will be deployed — {uploadedFiles.length}{' '}
                      {uploadedFiles.length === 1 ? 'document' : 'documents'}
                    </p>
                    {uploadedFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm">
                        <FileText className="w-4 h-4 text-green-600 flex-shrink-0" />
                        <span className="flex-1 truncate font-medium text-gray-800">{f.name}</span>
                        <button
                          onClick={() => setUploadedFiles((prev) => prev.filter((_, j) => j !== i))}
                          aria-label={`Remove ${f.name}`}
                          className="text-gray-600 hover:text-red-600 transition-colors flex-shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </SetupCard>
        )}

        {/*
          Target Canvas Course — appears only once a document has actually been chosen.

          It used to appear as soon as "Yes" was selected, which put a bordered card with a
          filled-in URL and a green tick directly beneath a card that still needed input. The
          finished-looking one drew the eye, the unfinished one above it read as decoration, and
          the deploy button stayed greyed out with no indication of which card was holding it up.
          draftRubricValid is already "a document has been chosen" on this branch, so gating on
          it makes the two cards strictly sequential: fill this one, then the next appears.
        */}
        {coreSetupComplete && hasDraftRubric === 'yes' && draftRubricValid && (
          <SetupCard isValid={courseVerified}>
            <div className="flex items-center gap-2 mb-1">
              <Link className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <h3 className="font-black text-lg text-gray-900">Target Canvas Course</h3>
              {courseVerified && <Check className="w-4 h-4 text-green-600 ml-auto flex-shrink-0" />}
            </div>
            <p className="text-sm text-gray-600 mb-3">Enter the homepage URL of the Canvas course you want to deploy rubrics to.</p>
            <input
              type="url"
              value={courseUrlInput}
              onChange={(e) => handleCourseUrlChange(e.target.value)}
              placeholder="https://canvas.institution.edu/courses/12345"
              aria-invalid={!!((courseUrlInput && !courseUrlValid) || courseNameError)}
              aria-describedby={courseNameError ? 'course-status' : undefined}
              className={`w-full px-4 py-3 border-2 rounded-xl text-sm focus:outline-none transition-all ${
                (courseUrlInput && !courseUrlValid) || courseNameError
                  ? 'border-red-300 focus:border-red-400'
                  : courseVerified
                  ? 'border-green-400 focus:border-green-500'
                  : 'border-gray-200 focus:border-blue-400'
              }`}
            />
            {courseUrlInput && !courseUrlValid && (
              <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                <X className="w-3 h-3" /> URL must include a /courses/&lt;ID&gt; path
              </p>
            )}
            {/*
              Mounted unconditionally: a live region that appears with its text already inside
              it is announced unreliably. Collapses to sr-only when there is nothing to say.
            */}
            <div
              id="course-status"
              role="status"
              aria-live="polite"
              className={
                courseNameLoading || courseName || courseNameError
                  ? 'mt-3 flex items-center gap-2 min-h-[1.5rem]'
                  : 'sr-only'
              }
            >
              {courseNameLoading ? (
                <>
                  <Loader2 className="w-4 h-4 text-gray-400 animate-spin" aria-hidden="true" />
                  <span className="text-sm text-gray-600">Checking this course…</span>
                </>
              ) : courseName ? (
                <>
                  <Check className="w-4 h-4 text-green-600 flex-shrink-0" aria-hidden="true" />
                  <span className="text-sm font-bold text-green-700">
                    <span className="sr-only">Course found: </span>
                    {courseName}
                  </span>
                </>
              ) : courseNameError ? (
                <span className="text-xs text-red-700">{courseNameError}</span>
              ) : null}
            </div>
          </SetupCard>
        )}

      </div>

      {/* "Yes" path: Analyze & Deploy button */}
      {hasDraftRubric === 'yes' && !showAnalyze && (
        <div className="mt-6">
          <button
            onClick={() => handleAnalyzeDeploy('yes')}
            disabled={!allRequiredValid}
            className={`w-full py-4 rounded-2xl font-black text-base uppercase tracking-widest transition-all active:scale-95 ${
              allRequiredValid
                ? 'bg-brand text-white hover:bg-brand-dark shadow-xl cursor-pointer'
                : 'bg-gray-200 text-gray-600 cursor-not-allowed shadow-none'
            }`}
          >
            {uploadedFiles.length > 1
              ? `Analyze ${uploadedFiles.length} Documents and Deploy To Canvas`
              : 'Analyze Draft Rubric(s) and Deploy To Canvas'}
          </button>
          {!allRequiredValid && (
            <p className="text-center text-sm text-gray-600 mt-2">
              Button becomes active when form is completely filled out.
            </p>
          )}
        </div>
      )}

      {/* "No" path: Phase 1 selection cards (V.1 style) */}
      {hasDraftRubric === 'no' && (
        <div className="mt-4">
          <div className="bg-blue-50 border-l-4 border-[#2B579A] p-4 rounded-xl">
            <h3 className="text-sm font-black text-[#2B579A] uppercase tracking-widest mb-4">
              Phase 1: Create Phase
            </h3>
            <div className="space-y-1">

              {/* Create Draft Rubric(s) */}
              <button
                onClick={() => setPhase1Mode(phase1Mode === 'rubric' ? 'none' : 'rubric')}
                className={`w-full p-6 rounded-t-2xl border-2 transition-all shadow-md flex items-start gap-6 group text-left ${
                  phase1Mode === 'rubric'
                    ? 'border-[#2B579A] bg-blue-50'
                    : 'border-gray-100 bg-white hover:border-[#2B579A] hover:bg-white'
                }`}
              >
                <div className="flex items-center gap-2 pt-1 flex-shrink-0">
                  <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center group-hover:bg-amber-200 transition-all">
                    <Lightbulb className="w-6 h-6 text-amber-600" />
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-600" />
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-all">
                    <span className="text-[#2B579A] font-black text-sm">W</span>
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="font-black text-lg text-gray-900">Assignment Description to Rubric(s)</h3>
                  <div className="mt-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="text-sm text-gray-600">
                      Upload or paste an assignment description to generate one or more draft rubrics (MS Word or Google Docs) based on the eCampus Center template.
                    </p>
                  </div>
                </div>
              </button>

              {/* OR divider */}
              <div className="px-6 py-3 bg-blue-100 border-l-2 border-r-2 border-[#2B579A] flex items-center justify-center">
                <p className="text-sm font-black text-[#2B579A]">or</p>
              </div>

              {/* Screenshot to Editable Doc */}
              <button
                onClick={() => setPhase1Mode(phase1Mode === 'screenshot' ? 'none' : 'screenshot')}
                className={`w-full p-6 rounded-b-2xl border-2 transition-all shadow-md flex items-start gap-6 group text-left ${
                  phase1Mode === 'screenshot'
                    ? 'border-[#2B579A] bg-blue-50'
                    : 'border-gray-100 bg-white hover:border-[#2B579A] hover:bg-white'
                }`}
              >
                <div className="flex items-center gap-2 pt-1 flex-shrink-0">
                  <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center group-hover:bg-purple-200 transition-all">
                    <Camera className="w-6 h-6 text-purple-600" />
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-600" />
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-all">
                    <span className="text-[#2B579A] font-black text-sm">W</span>
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="font-black text-lg text-gray-900">Screenshot to Rubric(s)</h3>
                  <div className="mt-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="text-sm text-gray-600">
                      Convert Canvas rubric screenshots to a matching, editable, draft rubric (MS Word / Google Docs file).
                    </p>
                  </div>
                </div>
              </button>

            </div>
          </div>

          {/* Inline Phase 1 content */}
          {phase1Mode === 'rubric' && (
            <div
              ref={phase1Ref}
              tabIndex={-1}
              role="region"
              aria-label="Assignment description to rubric"
              className="mt-4 focus:outline-none"
            >
              <Part1Rubric
                onAnalyzeDeploy={() => handleAnalyzeDeploy('no')}
                canAnalyzeDeploy={geminiValid && canvasTokenValid}
              />
            </div>
          )}
          {phase1Mode === 'screenshot' && (
            <div
              ref={phase1Ref}
              tabIndex={-1}
              role="region"
              aria-label="Screenshot to rubric"
              className="mt-4 focus:outline-none"
            >
              <ScreenshotConverter
                onAnalyzeDeploy={() => handleAnalyzeDeploy('no')}
                canAnalyzeDeploy={geminiValid && canvasTokenValid}
              />
            </div>
          )}
        </div>
      )}

      {/* Analyze & Deploy section (expands inline) */}
      {showAnalyze && (
        <div
          ref={analyzeRef}
          tabIndex={-1}
          role="region"
          aria-label="Analyze and deploy to Canvas"
          className="focus:outline-none"
        >
          <AnalyzeDeploySection
            onOpenSetup={handleOpenSetup}
            phase1Rubrics={
              analyzeRubricSource === 'no'
                ? state.rubrics.length > 0
                  ? state.rubrics
                  : state.rubric
                    ? [state.rubric]
                    : []
                : []
            }
            scoringMethod={state.scoringMethod}
            uploadedFiles={analyzeRubricSource === 'yes' ? uploadedFiles : undefined}
            courseUrl={analyzeRubricSource === 'no' ? (state.courseUrl || courseUrlInput) : courseUrlInput}
            onStartOver={() => {
              setShowAnalyze(false);
              setAnalyzeRubricSource(null);
              setHasDraftRubricLocal('');
              setPhase1Mode('none');
              setRubric(null);
            }}
          />
        </div>
      )}

    </div>
  );
};
