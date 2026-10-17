import React, { useState, useRef } from 'react';
import { useSession } from '../contexts/SessionContext';
import { useCopyAction } from '../hooks/useCopyAction';
import { ipcErrorMessage } from '../utils/ipcErrorMessage';
import { describeDuplicateTitles } from '../utils/duplicateTitles';
import { rubricsFingerprint } from '../utils/rubricFingerprint';
import { useDrivePicker } from '../contexts/DrivePickerContext';
import {
  AppMode,
  PointStyle,
  ProcessingType,
  GenerationSettings,
  RubricData,
  RubricMeta,
} from '../types';

/**
 * The document's text, wrapped as the kind of attachment the discovery call takes.
 *
 * Every route into this screen — a pasted rubric, a .docx from the desktop, a Google Doc from
 * Drive — has already been reduced to plain text by the time it lands in state, and the rubric
 * listing call was written for file attachments. Rather than a second listing call for text,
 * the text goes back as a text/plain attachment: the same request, one encode away.
 *
 * btoa alone throws on anything outside Latin-1, and rubrics are full of curly quotes and
 * en-dashes, so the text is encoded as UTF-8 bytes first.
 */
function documentAsAttachment(text: string) {
  const utf8 = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of utf8) binary += String.fromCharCode(byte);
  return { name: 'rubrics.txt', mimeType: 'text/plain', data: btoa(binary) };
}
import { generateCsvFromRubricObject } from '../utils/rubricCsv';
import { CsvSaveOptions } from './CsvSaveOptions';
import { RubricAdjustPanel } from './RubricAdjustPanel';
import { RubricPointsWarning } from './RubricPointsWarning';
import {
  allocatePoints,
  applyPointSplit,
  canvasTotal,
  leadingPoints,
  rescaleRubric,
} from '../utils/rescaleRubric';
import {
  checkRubricPoints,
  repairRatingBands,
  rubricsWithPointsProblems,
  settleStatedTotal,
} from '../utils/rubricPoints';
import {
  generateRubricFromDescription,
  extractRubricFromDocument,
  extractRubricMetadata,
  applyRubricChanges,
  suggestPointSplit,
  discoverDeliverables,
} from '../services/geminiService';
import type { Deliverable } from '../services/geminiService';
import {
  buildPlan,
  describedAssignmentTitle,
  parsePlanPoints,
  selectedRows,
} from '../utils/rubricPlan';
import type { RubricPlanRow } from '../utils/rubricPlan';
import { DeliverableChecklist } from './DeliverableChecklist';
import { RubricSwitcher } from './RubricSwitcher';
import { SegmentedChoice } from './SegmentedChoice';
import { Loader2, Download, FileText, CheckCircle, ArrowRight, RotateCw,
  RotateCcw, Home, X, Clock, ChevronDown, ChevronUp, Link, Check, AlertTriangle } from 'lucide-react';
import ErrorDisplay from './ErrorDisplay';
import mammoth from 'mammoth';
import { extractPdfText } from '../utils/pdfText';
import { getRecentDocs, saveRecentDoc, RecentDoc } from '../utils/recentDocs';

interface Part1RubricProps {
  onAnalyzeDeploy?: () => void;
  canAnalyzeDeploy?: boolean;
  /**
   * The person asked for a file on their computer, not a Google Doc.
   *
   * Set when they took the "or save to this computer instead (.html)" route off the opening
   * screen. It does not remove the Drive button — a sign-in that failed once may work later —
   * it swaps which of the two is the primary, so the route they chose is the one that looks
   * like the way forward.
   */
  preferLocalOutput?: boolean;
  /**
   * Where the rubrics come from: written from a description, or read out of a document.
   *
   * Everything after the first screen is identical — the same table, the same Request Changes,
   * the same document card, the same deploy card — so this is one component with two front
   * doors rather than two components sharing 2,000 lines. `mode` decides what the input card
   * asks for, which call the discovery pass makes, and which call fills each ticked row.
   */
  mode?: 'draft' | 'edit';
}

export const Part1Rubric: React.FC<Part1RubricProps> = ({
  onAnalyzeDeploy,
  canAnalyzeDeploy,
  preferLocalOutput = false,
  mode = 'draft',
}) => {
  const editing = mode === 'edit';
  const {
    state,
    setCurrentStep,
    setRubric,
    setRubrics,
    openRubric,
    updateRubricAt,
    setIsLoading,
    setError,
    setScoringMethod,
    newBatch,
    startProgress,
    stopProgress,
    setProgress,
    getAbortSignal,
    extractGoogleDocText,
    downloadDriveFile,
    startGoogleAuth,
    signOutGoogle,
    setCourseUrl,
    setSavedDoc,
  } = useSession();
  const { pickFile, pickFolder } = useDrivePicker();

  const [assignmentDescription, setAssignmentDescription] = useState<string>('');
  const [settings, setSettings] = useState<GenerationSettings>({
    totalPoints: 100,
    pointStyle: PointStyle.RANGE,
    processingType: ProcessingType.SINGLE,
  });

  /*
   * What is currently typed in the Total points box, held separately from settings.totalPoints.
   *
   * The box has to be allowed to be empty for a moment, which a number cannot represent. It used
   * to write `parseInt(value) || 100` straight into settings on every keystroke, so clearing it
   * to type a new figure put 100 back before the first digit arrived, and the only way to reach
   * 75 was to overtype in exactly the right order. Typing 0 also gave 100, zero being falsy.
   */
  const [totalPointsText, setTotalPointsText] = useState('100');
  const [isGenerating, setIsGenerating] = useState(false);

  /**
   * The confirmation checklist, or null when there is nothing to confirm.
   *
   * Non-null only between discovery finding separate parts and the user choosing which get a
   * rubric. A description with no separate parts never sets it.
   */
  const [plan, setPlan] = useState<RubricPlanRow[] | null>(null);
  /**
   * The checklist as it was last confirmed, kept so it can be brought back.
   *
   * `plan` is cleared once generation starts, which is right — leaving it up invites a second run
   * of the thing already decided. But the rows carry the user's own names, points and tick boxes,
   * and re-deriving them from the description would throw all three away. Held separately so
   * "choose the parts again" restores exactly what was confirmed rather than a fresh guess.
   */
  const [lastPlan, setLastPlan] = useState<RubricPlanRow[] | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Google Docs URL state
  /**
   * Google Drive is the tab that opens, because that is where the assignment descriptions
   * already live for the people this app is for — the local dropzone is the fallback, not the
   * common case. Someone signed out lands on a sign-in prompt with "From Local Drive" sitting
   * one click away, which is a prompt rather than a wall.
   */
  const [inputMode, setInputMode] = useState<'text' | 'google-doc'>('google-doc');
  const [googleDocUrl, setGoogleDocUrl] = useState<string>('');
  const [fetchingGoogleDoc, setFetchingGoogleDoc] = useState(false);
  const [isPickerLoading, setIsPickerLoading] = useState(false);

  // File picker feedback & recent docs
  const [pickedFileName, setPickedFileName] = useState<string | null>(null);
  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>(() => getRecentDocs());
  const [showRecentDocs, setShowRecentDocs] = useState(false);

  // Side-by-side comparison
  const [showComparison, setShowComparison] = useState(false);
  const [snapshotDescription, setSnapshotDescription] = useState('');

  // Ready-for-Canvas confirmation checkbox
  const [readyForCanvas, setReadyForCanvas] = useState(false);

  // Inline replace card

  // Request Changes card
  const [showRequestChangesCard, setShowRequestChangesCard] = useState(false);
  /**
   * What the user wants changed, per rubric, keyed by index into `state.rubrics`.
   *
   * One shared box was a way to corrupt a rubric quietly: the text stayed put when you switched
   * rubrics, and the button applied it to whichever one was showing — so a request written for
   * Part 1 could be applied to Part 2, producing a plausible rubric nobody asked for.
   */
  const [changeDrafts, setChangeDrafts] = useState<Record<number, string>>({});
  /** Which rubrics' requests the user has marked as settled and ready to run. */
  /*
   * One confirmation for the whole run, not one per rubric.
   *
   * The per-rubric version created a third state — text typed but not ticked — which did nothing
   * except need its own warning to explain why a rubric had been skipped. The typed text is
   * already the signal that a change is wanted; the tick only needs to say "send them".
   */
  const [changesConfirmed, setChangesConfirmed] = useState(false);

  /** What the last run did, shown where the button was. Cleared when a new run starts. */
  /**
   * Why the run slowed down, when it did.
   *
   * Null in the ordinary case. Set once, when Google first pushes back and the pool drops from
   * three rubrics at a time to one. It outlives the progress bar deliberately: the run it explains
   * is the one the user is looking at the results of, and "why did that take so long" is asked
   * afterwards rather than during.
   */
  const [paceNotice, setPaceNotice] = useState<string | null>(null);

  /** The confirm card for re-drafting the whole set, opened from the button row. */
  const [showStartOverCard, setShowStartOverCard] = useState(false);
  const [changeSummary, setChangeSummary] = useState<string | null>(null);

  /** Rubrics the last run actually changed, marked on the switcher so they can be checked. */
  const [revisedIndexes, setRevisedIndexes] = useState<number[]>([]);
  const [isApplyingChanges, setIsApplyingChanges] = useState(false);

  // Rubric source — controls which success banner to show
  const [rubricSource, setRubricSource] = useState<'generated' | 'uploaded' | 'revised' | null>(null);

  // Inline deploy card
  const [showDeployCard, setShowDeployCard] = useState(false);
  const [deployUrlInput, setDeployUrlInput] = useState(() => state.courseUrl || '');

  /**
   * Prefill with the course used last time, so only the course ID needs changing.
   *
   * The initialiser above runs before the saved URL has arrived — it comes from settings.json
   * over IPC, which resolves after the first render — so it always sees null. This fills the
   * field when the value lands, unless the user has already edited it.
   */
  const deployUrlTouched = useRef(false);
  React.useEffect(() => {
    if (deployUrlTouched.current || !state.courseUrl) return;
    setDeployUrlInput(state.courseUrl);
  }, [state.courseUrl]);
  const [deployCourseName, setDeployCourseName] = useState<string | null>(null);
  const [deployCourseNameLoading, setDeployCourseNameLoading] = useState(false);
  const [deployNameError, setDeployNameError] = useState<string | null>(null);

  const isCourseUrlValid = (url: string) =>
    /^https?:\/\/.+\/courses\/\d+/i.test(url.trim());

  const deployUrlValid = isCourseUrlValid(deployUrlInput);

  /**
   * Confirm the course exists, and show its name.
   *
   * Two things worth knowing about this, both learned the hard way.
   *
   * The URL is pinned before the lookup, not after. The lookup sends the Canvas token, and main
   * will only send it to the host recorded in settings — so on the "No, I need to create one"
   * path, where the Dashboard's course field never appears, nothing was ever pinned and every
   * lookup failed with "no course saved" before it reached Canvas. setCourseUrl is what pins,
   * and it asks for confirmation first when the host is one the app has not used before, so
   * routing through it keeps that guarantee rather than working around it.
   *
   * Failures are shown, not swallowed. Main returns a specific reason for each one — wrong host,
   * no token, 404, unreachable — and discarding it left a green box with no name and no way to
   * tell why.
   */
  React.useEffect(() => {
    if (!deployUrlValid || !state.canvasTokenStatus?.hasValue) {
      setDeployCourseName(null);
      setDeployNameError(null);
      return;
    }
    let cancelled = false;
    setDeployCourseNameLoading(true);
    setDeployNameError(null);
    // Debounced for the same reason as Dashboard: otherwise every keystroke is one
    // authenticated Canvas call, and one confirmation prompt.
    const timer = window.setTimeout(async () => {
      try {
        const pinned = await setCourseUrl(deployUrlInput.trim());
        if (cancelled) return;
        if (!pinned.ok) {
          setDeployNameError(pinned.message ?? 'Could not use this Canvas course.');
          return;
        }
        const result = await window.api.canvas.getCourseName({
          courseUrl: deployUrlInput.trim(),
        });
        if (cancelled) return;
        if (result.ok && result.name) setDeployCourseName(result.name);
        else setDeployNameError(result.message ?? 'Could not load this course.');
      } catch (e) {
        if (!cancelled) {
          setDeployNameError(e instanceof Error ? e.message : 'Could not load this course.');
        }
      } finally {
        if (!cancelled) setDeployCourseNameLoading(false);
      }
    }, 500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [deployUrlValid, deployUrlInput, state.canvasTokenStatus?.hasValue, setCourseUrl]);

  /**
   * Green means "this course exists and we reached it", not "this string looks like a URL".
   * A regex cannot tell a real course from a typo, and the old highlight went green for both.
   */
  const deployCourseVerified = deployUrlValid && !!deployCourseName;

  const handleFileUpload = async (file: File) => {
    setIsLoading(true);
    setError(null);
    try {
      const name = file.name.toLowerCase();

      if (name.endsWith('.docx') || name.endsWith('.doc')) {
        // Extract plain text from Word document using mammoth
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        setAssignmentDescription(result.value);

      } else if (name.endsWith('.pdf')) {
        // Extract plain text from PDF using pdfjs-dist
        const arrayBuffer = await file.arrayBuffer();
        setAssignmentDescription(await extractPdfText(arrayBuffer, file.name));

      } else {
        // Plain text fallback (.txt and others)
        const text = await file.text();
        setAssignmentDescription(text);
      }
    } catch (err) {
      setError(`Failed to read file: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleFetchGoogleDoc = async () => {
    if (!state.isGoogleAuthenticated) {
      setError('Please sign in with Google first');
      return;
    }

    if (!googleDocUrl.trim()) {
      setError('Please enter a Google Drive URL');
      return;
    }

    setFetchingGoogleDoc(true);
    setError(null);

    try {
      const urlToSave = googleDocUrl.trim();
      const resolved = await window.api.drive.resolveUrl(urlToSave);
      if (!resolved.ok) throw new Error(resolved.message);
      const fileId = resolved.fileId;
      const meta = { name: resolved.name, mimeType: resolved.mimeType };
      let text = '';

      if (meta.mimeType === 'application/vnd.google-apps.document') {
        text = await extractGoogleDocText(fileId);
      } else if (
        meta.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        meta.mimeType === 'application/msword'
      ) {
        const arrayBuffer = await downloadDriveFile(fileId);
        const extracted = await mammoth.extractRawText({ arrayBuffer });
        text = extracted.value;
      } else if (meta.mimeType === 'application/pdf') {
        const arrayBuffer = await downloadDriveFile(fileId);
        text = await extractPdfText(arrayBuffer, meta.name);
      } else if (meta.mimeType === 'text/plain') {
        const arrayBuffer = await downloadDriveFile(fileId);
        text = new TextDecoder().decode(arrayBuffer);
      } else {
        setError(`"${meta.name}" is not a supported file type. Please use a Google Doc, Word document (.docx), PDF, or plain text file.`);
        return;
      }

      setAssignmentDescription(text);
      await adoptSourceDoc(fileId, meta.mimeType, meta.name);
      saveRecentDoc({ name: meta.name, url: urlToSave, source: 'url' });
      setRecentDocs(getRecentDocs());
      setInputMode('text');
      setGoogleDocUrl('');
    } catch (err: any) {
      setError(`Failed to fetch from Google Drive: ${err.message}`);
    } finally {
      setFetchingGoogleDoc(false);
    }
  };

  const handlePickerOpen = async () => {
    if (!state.isGoogleAuthenticated) {
      setError('Please sign in with Google first');
      return;
    }

    setIsPickerLoading(true);
    setError(null);

    try {
      const result = await pickFile();
      if (!result) return; // User cancelled

      setFetchingGoogleDoc(true);
      let text = '';

      if (result.mimeType === 'application/vnd.google-apps.document') {
        // Native Google Doc — use export API
        text = await extractGoogleDocText(result.fileId);

      } else if (
        result.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        result.mimeType === 'application/msword'
      ) {
        // Word document — download raw bytes and parse with mammoth
        const arrayBuffer = await downloadDriveFile(result.fileId);
        const extracted = await mammoth.extractRawText({ arrayBuffer });
        text = extracted.value;

      } else if (result.mimeType === 'application/pdf') {
        // PDF — download raw bytes and parse with pdfjs
        const arrayBuffer = await downloadDriveFile(result.fileId);
        text = await extractPdfText(arrayBuffer, result.name);

      } else if (result.mimeType === 'text/plain') {
        // Plain text — download and decode
        const arrayBuffer = await downloadDriveFile(result.fileId);
        text = new TextDecoder().decode(arrayBuffer);

      } else {
        setError(`"${result.name}" is not a supported file type. Please select a Google Doc, Word document (.docx), PDF, or plain text file.`);
        return;
      }

      setAssignmentDescription(text);
      setPickedFileName(result.name);
      await adoptSourceDoc(result.fileId, result.mimeType, result.name);
      saveRecentDoc({ name: result.name, fileId: result.fileId, mimeType: result.mimeType, source: 'picker' });
      setRecentDocs(getRecentDocs());
      setInputMode('text');
      setGoogleDocUrl('');
    } catch (err: any) {
      setError(`Failed to open Google Drive: ${err.message}`);
    } finally {
      setIsPickerLoading(false);
      setFetchingGoogleDoc(false);
    }
  };

  /**
   * Step one: find out whether there is anything to choose between.
   *
   * Discovery is a cheap call — it sends the description and gets back a short list — and it
   * runs before any rubric is generated so that nothing is built for a part the user did not
   * want. When it finds no separate parts, which is most assignments, the checklist would be a
   * one-row form with a foregone answer, so it is skipped entirely and the single rubric is
   * generated as it always was.
   */
  /**
   * Remember the Google Doc an edit run was loaded from, so changes go back into it.
   *
   * Without this, editing a document produced a *second* document: the app only knows how to
   * update a file it created itself, and a file it was handed looked like nothing at all. The
   * card then offered "Open in Google Docs", which makes a copy — the exact behaviour the
   * version history work in 0.9.19 was meant to end.
   *
   * Only a native Google Doc is adopted. A .docx or a PDF in Drive cannot take a document's
   * contents written back over it in any form worth having, so those still end in a new file,
   * and the card says so.
   *
   * The version counter is recorded as it stands at load time, which is what makes the
   * hand-edited warning honest later: it compares against the document as the app found it, so
   * an edit made between opening and updating is still caught.
   */
  const adoptSourceDoc = async (fileId: string, mimeType: string, name: string) => {
    if (!editing || mimeType !== 'application/vnd.google-apps.document') return;
    try {
      const check = await window.api.rubric.checkDriveDoc({ fileId });
      if (!check.ok || check.status !== 'unchanged' || !check.version) return;
      setSavedDoc({
        fileId,
        name: check.name ?? name,
        version: check.version,
        webViewLink: check.webViewLink ?? `https://docs.google.com/document/d/${fileId}/edit`,
        adopted: true,
      });
    } catch {
      // Not being able to adopt the document is not a reason to refuse to open its rubrics.
      // The run still works; it just ends in a new document, which the card already allows for.
    }
  };

  const handleGenerateRubric = async () => {
    if (!assignmentDescription.trim()) {
      setError(
        editing
          ? 'Choose a rubric document first, or paste its contents in.'
          : 'Please enter an assignment description',
      );
      return;
    }

    setSnapshotDescription(assignmentDescription);
    setError(null);
    setIsDiscovering(true);
    startProgress(1, true);
    setProgress({
      currentStep: editing
        ? 'Looking for the rubrics in your document...'
        : 'Reading the assignment description...',
    });

    /**
     * Held in a const, and this is the whole of the Stop fix.
     *
     * Stop calls `requestCancel`, which aborts the controller *and nulls the ref* so the next
     * run gets a fresh one. This function used to ask for the signal twice — once to pass to
     * discovery, then again to test whether it had been aborted — and the second call, arriving
     * after the ref had been nulled, built a brand new controller and handed back a signal that
     * had never been aborted. So Stop read as "no, carry on": discovery's cancellation error was
     * swallowed into an empty list, the empty list was taken to mean "no separate parts", and
     * the app generated the single rubric the user had just asked it not to.
     */
    const signal = getAbortSignal();

    /*
      Editing takes a different first step and the same second one.

      Drafting asks the model what parts an assignment has; editing asks what rubrics a document
      already holds. Both end in a ticked list, and from there the run is identical — one call
      per ticked row, through the same pool, into the same review screen.
    */
    if (editing) {
      let names: RubricMeta[] = [];
      try {
        names = await extractRubricMetadata([documentAsAttachment(assignmentDescription)], signal);
      } catch (err: any) {
        setIsDiscovering(false);
        stopProgress();
        if (!signal.aborted) setError(ipcErrorMessage(err));
        return;
      }
      setIsDiscovering(false);
      stopProgress();
      if (signal.aborted) return;

      if (names.length === 0) {
        setError(
          'No rubrics were found in that document. Check that it is the rubric document rather ' +
            'than the assignment description, and that the rubrics are in tables.',
        );
        return;
      }

      /*
        Nothing starts ticked, however few were found.

        Each one costs its own request, and the document that makes this feature worth having is
        the long one — a 39-rubric set where two need a wording change. A list that arrives all
        ticked turns that into 39 requests for anyone who presses the button without reading it.
        "Toggle all" is one click away for the case where the whole set really is wanted.
      */
      setPlan(
        names.map((meta, i) => ({
          id: `found-${i}`,
          kind: 'deliverable' as const,
          title: meta.name,
          focus: '',
          points: String(meta.totalPoints ?? ''),
          selected: false,
        })),
      );
      return;
    }

    let found: Deliverable[] = [];
    try {
      found = await discoverDeliverables(assignmentDescription, signal);
    } catch {
      // A discovery failure is not a reason to refuse to write a rubric. Fall through to the
      // single-rubric path, which is what the app did before this step existed. A cancel also
      // lands here, and is caught by the aborted check below before it can reach that path.
      found = [];
    } finally {
      setIsDiscovering(false);
    }

    if (signal.aborted) {
      // Nothing else to undo. The description, the picked file name and the settings are all
      // untouched, so the card the user was on is still the card they come back to, with the
      // document still in it — which is what Stop should mean here.
      stopProgress();
      return;
    }

    if (found.length === 0) {
      await generateRubricsFor([
        { title: '', focus: '', points: settings.totalPoints, target: undefined },
      ]);
      return;
    }

    stopProgress();
    setPlan(
      buildPlan({
        assignmentTitle: describedAssignmentTitle(assignmentDescription),
        deliverables: found,
        defaultPoints: settings.totalPoints,
      }),
    );
  };

  /** Turn the confirmed checklist into one generation call per ticked row. */
  const handleConfirmPlan = async () => {
    if (!plan) return;
    const chosen = selectedRows(plan);
    await generateRubricsFor(
      chosen.map((row) => ({
        title: row.title.trim(),
        focus: row.focus,
        points: parsePlanPoints(row.points) ?? settings.totalPoints,
        target:
          row.kind === 'deliverable'
            ? { title: row.title.trim(), focus: row.focus }
            : undefined,
      })),
    );
    setLastPlan(plan);
    setPlan(null);
  };

  /**
   * Generate one rubric per entry, in order, and open the first.
   *
   * One call each rather than one call for all of them. A single call returning eight rubrics
   * would send the description once instead of eight times, but a batch extraction is
   * all-or-nothing: one reply that runs past the output ceiling loses every rubric in it,
   * including the ones already finished inside it. That is the failure that cost a 26-rubric
   * document four minutes in Part 2, and rubric JSON is bulkier than CSV. A per-rubric failure
   * costs one rubric, and the rest are kept.
   */
  const generateRubricsFor = async (
    entries: Array<{
      title: string;
      focus: string;
      points: number;
      target?: { title: string; focus: string };
    }>,
  ) => {
    setIsGenerating(true);
    setError(null);
    setPaceNotice(null);

    startProgress(entries.length, true);

    /**
     * One signal for the whole run, taken after startProgress has made the controller.
     *
     * Same reason as in handleGenerateRubric: Stop nulls the controller ref on its way out, so
     * asking for the signal again afterwards returns a fresh, un-aborted one. Read per iteration,
     * that turned Stop between two rubrics into a no-op; read at the end, it decided the run had
     * not been cancelled and blamed the empty result on a failure instead.
     */
    const signal = getAbortSignal();

    /*
      Three at a time, dropping to one at the first sign of strain.

      Sequential drafting is why an eight-part document took four minutes: nine round trips to
      Gemini, each waiting for the one before it. Nothing required that — the rubrics are
      independent, and the only reason to serialise them was the free tier's rate limit.

      So it starts at three and listens. gemini:retry already fires the moment a call begins
      waiting out a busy model or a rate limit, which is a better trigger than a failure: it
      arrives before anything has been lost, and it is typed rather than matched out of a message.
      One notice is enough to finish the run one rubric at a time, and to say so, because a run
      that quietly halves its own speed is indistinguishable from a run that is stuck.

      It never goes back up within a run. Whatever made Google push back is not usually over in
      thirty seconds, and a pace that oscillates would be worse than the slow one.
    */
    const CONCURRENT_DRAFTS = 3;

    const drafted: Array<RubricData | null> = new Array(entries.length).fill(null);
    const failedAt: Array<string | null> = new Array(entries.length).fill(null);
    let firstFailure: string | null = null;
    let done = 0;

    // A ref rather than state: the pool reads it between batches, and a re-render is neither
    // needed nor fast enough to be trusted here.
    const oneAtATime = { current: entries.length === 1 };
    const unsubscribeRetry = window.api.gemini.onRetry((notice) => {
      if (!notice.waiting || oneAtATime.current) return;
      oneAtATime.current = true;
      setPaceNotice(
        notice.reason === 'busy'
          ? "Google's AI service is busy, so the rest of the rubrics are being written one at a time. This is slower but far more likely to finish."
          : 'Gemini asked for a slower pace, so the rest of the rubrics are being written one at a time. This is slower but far more likely to finish.',
      );
    });

    const verb = editing ? 'Reading' : 'Writing';
    const describeRun = () => {
      const remaining = entries.length - done;
      if (entries.length === 1) {
        return editing ? 'Reading the rubric...' : 'Generating rubric criteria...';
      }
      const width = Math.min(oneAtATime.current ? 1 : CONCURRENT_DRAFTS, remaining);
      return width > 1
        ? `${verb} ${width} rubrics at once (${done} of ${entries.length} done)...`
        : `${verb} "${entries[done]?.title || 'the rubric'}" (${done + 1} of ${entries.length})...`;
    };

    const draftOne = async (i: number) => {
      const entry = entries[i];
      try {
        // `signal` third: without it withCancellation never sends gemini:cancel, so Stop did
        // nothing and the user watched a dead button through the retry back-off.
        drafted[i] = editing
          ? // Reading, not writing: the document's words and its points come back untouched,
            // which is why no settings are passed and why nothing rounds them afterwards.
            await extractRubricFromDocument(assignmentDescription, signal, entry.title)
          : await generateRubricFromDescription(
              assignmentDescription,
              { ...settings, totalPoints: entry.points },
              signal,
              entry.target,
            );
      } catch (err: any) {
        if (signal.aborted) return;
        // One rubric failing does not cost the others; it is named at the end instead.
        failedAt[i] = entry.title || 'the rubric';
        /*
          The reason, kept.

          This used to discard `err` entirely, and that is how an eight-rubric run could fail
          eight times over and still report "Try again, or shorten the description" — advice
          aimed at a description that was never the problem. Gemini had said what was wrong on
          every one of those attempts; nothing carried it this far. The first one is the one
          worth showing: the rest are the same failure repeating.
        */
        if (!firstFailure) firstFailure = ipcErrorMessage(err);
      } finally {
        done += 1;
        setProgress({
          currentStep: describeRun(),
          percentage: done / entries.length,
          itemsProcessed: done,
        });
      }
    };

    try {
      setProgress({ currentStep: describeRun(), percentage: 0, itemsProcessed: 0 });

      let next = 0;
      while (next < entries.length && !signal.aborted) {
        const width = oneAtATime.current ? 1 : CONCURRENT_DRAFTS;
        const batch: number[] = [];
        while (batch.length < width && next < entries.length) batch.push(next++);
        await Promise.all(batch.map(draftOne));
      }

      const made = drafted.filter((r): r is RubricData => r !== null);
      const failed = failedAt.filter((t): t is string => t !== null);

      if (made.length > 0) {
        setProgress({ currentStep: 'Finalizing...', percentage: 0.95 });
        setRubrics(made);
        /*
          Recorded with the rubrics, not read off the control later. The deploy panel builds the
          Canvas CSV and needs to know whether these rubrics state their points as ranges
          ("10 to >8") or single values, because that decides the Criteria Enable Range column.
          Nothing carried the choice between the two screens before, so every rubric deployed as
          TRUE however the user had set it.
        */
        setScoringMethod(settings.pointStyle === PointStyle.RANGE ? 'ranges' : 'fixed');
        /*
          'uploaded' for an edit run, which is what turns off the point-style repairs.

          Those exist to correct rubrics the AI wrote. A rubric read out of someone's document
          is their own work; checkRubricPoints still reports what it finds there, but nothing
          rewrites it on the way in.
        */
        setRubricSource(editing ? 'uploaded' : 'generated');
        // A new set of rubrics: the previous run's markers and summary describe rubrics that no
        // longer exist, and the remembered Google Doc holds the set that has just been replaced.
        setRevisedIndexes([]);
        setChangeSummary(null);
        setChangesConfirmed(false);
        /*
          Forget the remembered document — except on an edit run, where it IS the document these
          rubrics were just read out of. Clearing it there would leave the user with no way back
          to their own file and an "Open in Google Docs" that makes a copy, which is the whole
          problem this route exists to avoid.
        */
        if (!editing) setSavedDoc(null);
        setDocConflict(null);
        setDriveSaveSuccess(null);
        setProgress({ percentage: 1, itemsProcessed: made.length });
        setShowRequestChangesCard(false);
        setShowStartOverCard(false);
        setReadyForCanvas(false);
        setShowDeployCard(false);
      }

      if (failed.length > 0) {
        /*
          What went wrong first, then what it cost.

          That order because the reason is the part the user can act on, and because naming eight
          rubrics before saying why buries it. `firstFailure` is Gemini's own sentence where the
          failure was one this app recognises, and Google's text where it was not — see
          geminiErrors.ts. It is only ever missing if the catch above never ran, which the
          failed.length check already rules out.
        */
        const scope =
          made.length === 0
            ? `None of the rubrics could be written (${failed.join(', ')}).`
            : `Wrote ${made.length} of ${entries.length}. Could not write ${failed.join(', ')}.`;
        setError(firstFailure ? `${firstFailure} ${scope}` : scope);
      } else if (made.length === 0 && !signal.aborted) {
        setError('Nothing was generated. Try again, or shorten the description.');
      }

      setTimeout(() => stopProgress(), 500);
    } finally {
      // The listener belongs to this run. Left attached, a later run's first retry notice would
      // slow down a pool that is no longer there.
      unsubscribeRetry();
      setIsGenerating(false);
    }
  };

  const [savingToDrive, setSavingToDrive] = useState(false);
  const [savingLocal, setSavingLocal] = useState(false);
  const [driveSaveSuccess, setDriveSaveSuccess] = useState<string | null>(null);

  /**
   * Why an update stopped short, when it did.
   *
   * Null is the ordinary case. The other three are the reasons not to write: somebody has edited
   * the document in Google Docs, it is in the bin, or the id no longer resolves at all. Each
   * needs a different offer, so the reason is kept rather than collapsed into a boolean.
   */
  const [docConflict, setDocConflict] = useState<'trashed' | 'missing' | null>(null);
  const { state: copyState, copy } = useCopyAction();

  /**
   * The default: create a Google Doc in Drive and open it.
   *
   * The rubric is rendered as an HTML table and handed to Drive to convert, which preserves the
   * table. The previous version of this flattened the rubric into plain-text lines before
   * uploading, so everything below the words — the grid, the ratings columns, the points — was
   * lost on the way to Drive.
   */
  /** The rubrics that go into the document, and the name it is filed under. */
  const docPayload = () => ({
    rubrics: state.rubrics.length > 0 ? state.rubrics : state.rubric ? [state.rubric] : [],
    documentTitle:
      state.rubrics.length > 1 ? describedAssignmentTitle(snapshotDescription) : undefined,
  });

  /**
   * Write the rubrics over the document the app made earlier.
   *
   * Split from the check in front of it so that "overwrite anyway" can call it directly once the
   * user has seen what they would be overwriting.
   */
  const writeDocUpdate = async () => {
    const doc = state.savedDoc;
    if (!doc) return;
    setSavingToDrive(true);
    setDriveSaveSuccess(null);
    try {
      const result = await window.api.rubric.updateDriveDoc({
        fileId: doc.fileId,
        sourceName: doc.adopted ? doc.name : undefined,
        ...docPayload(),
      });
      if (result.ok && result.fileId && result.webViewLink) {
        setSavedDoc({
          fileId: result.fileId,
          webViewLink: result.webViewLink,
          name: result.name ?? doc.name,
          version: result.version ?? '',
          // Carried, or a second update would treat the document as one of ours and rename it
          // after its rubrics — undoing the whole point of keeping the owner's name.
          adopted: doc.adopted,
          // What the document now holds. The save button compares against this to know whether
          // there is anything left to save.
          contentKey: rubricsFingerprint(docPayload().rubrics),
        });
        setDocConflict(null);
        setDriveSaveSuccess('Saved to the Google Doc. Same document, same link.');
      } else {
        setError(result.message ?? 'Could not update the Google Doc.');
      }
    } catch (err) {
      setError(`Google Drive update failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingToDrive(false);
    }
  };

  /**
   * Check the document is still there, then write over it.
   *
   * The check used to stop at a document someone had edited by hand in Docs and ask whether to
   * overwrite it. That card is gone: Update should update. Google Docs keeps every revision, so
   * the previous version is one menu away under File → Version history, and the line beside the
   * button says so — which is a better place for the information than a gate in front of the
   * thing the user has just asked for.
   *
   * What remains is the case that is not a warning at all. A document in the bin or deleted
   * outright cannot be written to by anybody, so an update there is not a risk to weigh but a
   * fact to report, and the only move left is a new document.
   */
  const handleUpdateDoc = async () => {
    const doc = state.savedDoc;
    if (!doc) return;
    setSavingToDrive(true);
    setDriveSaveSuccess(null);
    setDocConflict(null);
    try {
      const check = await window.api.rubric.checkDriveDoc({ fileId: doc.fileId });
      if (!check.ok) {
        setError(check.message);
        return;
      }
      if (check.status === 'trashed' || check.status === 'missing') {
        setDocConflict(check.status);
        return;
      }
    } catch (err) {
      setError(`Could not reach Google Drive: ${err instanceof Error ? err.message : String(err)}`);
      return;
    } finally {
      setSavingToDrive(false);
    }
    await writeDocUpdate();
  };

  const handleExportToDrive = async () => {
    if (!state.rubric) return;
    setSavingToDrive(true);
    setDriveSaveSuccess(null);
    setDocConflict(null);
    try {
      const folder = await pickFolder({ title: 'Where should the rubric go?' });
      if (!folder) return;

      // The whole set, not just the one on screen: a run that produced eight rubrics saves as
      // one document holding all eight. A single-rubric run passes an array of one.
      const result = await window.api.rubric.exportToDrive({
        ...docPayload(),
        folderId: folder.folderId,
      });
      if (result.ok && result.fileId && result.webViewLink) {
        setSavedDoc({
          fileId: result.fileId,
          webViewLink: result.webViewLink,
          name: result.name ?? 'Rubric',
          version: result.version ?? '',
          contentKey: rubricsFingerprint(docPayload().rubrics),
        });
        setDriveSaveSuccess(`Opened in your browser, saved to "${folder.folderName}"`);
      } else {
        setError(result.message ?? 'Could not create the Google Doc.');
      }
    } catch (err) {
      setError(`Google Drive save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingToDrive(false);
    }
  };

  /**
   * The fallback: write the same HTML to a file on this computer.
   *
   * Deliberately available whether or not the user is signed in. Google sign-in is the part of
   * this app most likely to be broken for someone — refresh tokens expire weekly while the
   * consent screen is in Testing, and new staff hit consent problems — and a rubric they cannot
   * get out of the app is worse than one in a slightly less convenient format.
   */
  const handleSaveLocal = async () => {
    if (!state.rubric) return;
    setSavingLocal(true);
    setDriveSaveSuccess(null);
    try {
      const result = await window.api.rubric.saveHtml({
        rubrics: state.rubrics.length > 0 ? state.rubrics : [state.rubric],
        documentTitle: state.rubrics.length > 1 ? describedAssignmentTitle(snapshotDescription) : undefined,
      });
      if (result.ok) {
        setDriveSaveSuccess(`Saved to ${result.path}`);
      } else if (!result.cancelled) {
        setError(result.message ?? 'Could not save the file.');
      }
    } finally {
      setSavingLocal(false);
    }
  };

  const handleContinue = () => {
    if (!state.rubric) {
      setError('Please generate a rubric first');
      return;
    }
    if (onAnalyzeDeploy) {
      onAnalyzeDeploy();
    } else {
      setCurrentStep(AppMode.PART_2);
    }
  };

  const handleReset = () => {
    setAssignmentDescription('');
    setRubric(null);
    setError(null);
    setPickedFileName(null);
    setSnapshotDescription('');
    setShowComparison(false);
  };

  const activeDraft = changeDrafts[state.activeRubricIndex] ?? '';

  /**
   * The Canvas CSV for each rubric on screen, built for the save panel.
   *
   * Memoised for the work it skips, not for referential identity — CsvSaveOptions is a plain
   * function component with no memo and no effect keyed on this array, so a stable reference
   * buys nothing. The saving is real though: a 26-rubric document costs about 0.7ms and 220KB
   * of string allocation to rebuild, and this component subscribes to the session, whose
   * progress timer ticks four times a second for the whole of a generation. Without the memo
   * that rebuild would run on every one of those ticks for a panel that is usually closed.
   *
   * The dependency is the rubrics array's identity, which changes only when the set is
   * replaced or one of them is revised. Everything the user types on this screen is local
   * state, so typing re-renders without recomputing.
   *
   * `state.scoringMethod`, not the local `settings.pointStyle`, and that distinction is the
   * whole point. The panel below promises these are the files the deploy will send, and the
   * deploy reads `state.scoringMethod`. The two are not interchangeable: `settings` is local
   * useState, and this component unmounts whenever the Phase 1 mode changes, so generating a
   * rubric with Single points, switching to the screenshot card and coming back resets the
   * control to Ranges while the rubrics and the session value both survive. Reading the
   * control there would have offered a CSV scored differently from the one Canvas received —
   * which is exactly the file someone saves as their recovery copy when a deploy fails.
   */
  const csvsForRubrics = React.useMemo(
    () =>
      state.rubrics.map((rubric) => ({
        name: rubric.title,
        csvContent: generateCsvFromRubricObject(rubric, state.scoringMethod),
      })),
    [state.rubrics, state.scoringMethod],
  );

  /**
   * Points problems on the rubric being looked at, and across the whole set.
   *
   * Both are needed because the two are read at different moments. The open rubric's findings sit
   * with the rubric itself, where someone reviewing it will see them. The set-wide count sits by
   * the deploy button, because rubrics are deployed all at once: the run that prompted these
   * checks had two bad rubrics out of six, and nothing would have made that visible to someone
   * who looked at the first one, found it fine, and ticked the box.
   */
  const activeReport = React.useMemo(
    () => (state.rubric ? checkRubricPoints(state.rubric) : null),
    [state.rubric],
  );

  /** Titles more than one rubric in this set is using. Null when they are all distinct. */
  const duplicateWarning = React.useMemo(
    () => describeDuplicateTitles(state.rubrics.map((r) => r.title)),
    [state.rubrics],
  );

  const flaggedRubrics = React.useMemo(
    () => rubricsWithPointsProblems(state.rubrics),
    [state.rubrics],
  );

  /*
   * What rescaling to the intended total would produce, shown on its button so the choice between
   * it and asking the AI is visible rather than described. Left out past five criteria, where the
   * string is longer than the sentence around it.
   */
  const rescalePreview = React.useMemo(() => {
    if (!state.rubric || !activeReport?.totalsDisagree) return null;
    const maxes = state.rubric.criteria.map((c) => leadingPoints(c.exemplary));
    if (maxes.length === 0 || maxes.length > 5) return null;
    return allocatePoints(maxes, activeReport.intended).join(' / ');
  }, [state.rubric, activeReport]);

  /** Re-weight the criteria from the AI's proposal, after checking it is usable. */
  const handleSplitByImportance = async (): Promise<string | null> => {
    const rubric = state.rubric;
    if (!rubric || !activeReport) return null;
    try {
      const shares = await suggestPointSplit(
        rubric.criteria.map((c) => c.category),
        activeReport.intended,
      );
      const split = applyPointSplit(rubric, shares, activeReport.intended);
      if (!split) {
        return 'The AI did not return a usable set of numbers. Rescaling instead will divide the points without asking it again.';
      }
      // Scaling four bands by one factor can leave a rounded edge that no longer meets the band
      // below it, so the same chaining that runs on generated rubrics runs here.
      const chained = repairRatingBands(split).rubric;
      updateRubricAt(state.activeRubricIndex, chained);
      setReadyForCanvas(false);
      setShowDeployCard(false);
      return `Now ${chained.criteria.map((c) => leadingPoints(c.exemplary)).join(' / ')}, adding up to ${canvasTotal(chained)}. Every word is unchanged.`;
    } catch (err) {
      return `Could not reach the AI: ${err instanceof Error ? err.message : String(err)}`;
    }
  };

  const handleRescaleToIntended = () => {
    if (!state.rubric || !activeReport) return;
    const next = rescaleRubric(state.rubric, activeReport.intended);
    if (next === state.rubric) return;
    updateRubricAt(state.activeRubricIndex, repairRatingBands(next).rubric);
    setReadyForCanvas(false);
    setShowDeployCard(false);
  };

  /** Rubrics with something typed — what "Apply changes" will run, once it is confirmed. */
  const queuedIndexes = state.rubrics
    .map((_, i) => i)
    .filter((i) => (changeDrafts[i] ?? '').trim() !== '');

  const setDraft = (index: number, text: string) =>
    setChangeDrafts((prev) => ({ ...prev, [index]: text }));

  /**
   * Run every settled request, one rubric at a time.
   *
   * Batched rather than applied as each is written, so eight revisions are one wait instead of
   * eight. Each is its own AI call — applyRubricChanges takes one rubric — so this is the same
   * shape as generation, and one failing costs only itself.
   */
  const handleApplyChanges = async () => {
    if (queuedIndexes.length === 0) return;

    setIsApplyingChanges(true);
    setError(null);
    setChangeSummary(null);
    setRevisedIndexes([]);
    startProgress(queuedIndexes.length, true);

    /* One signal for the run, for the reason given in generateRubricsFor: re-reading it per
       rubric hands back a fresh controller after Stop, and the loop carries on. */
    const signal = getAbortSignal();

    const revised: number[] = [];
    const failed: string[] = [];

    try {
      for (let n = 0; n < queuedIndexes.length; n++) {
        const index = queuedIndexes[n];
        if (signal.aborted) break;

        const target = state.rubrics[index];
        if (!target) continue;

        setProgress({
          currentStep:
            queuedIndexes.length === 1
              ? 'Applying your changes...'
              : `Revising "${target.title}" (${n + 1} of ${queuedIndexes.length})...`,
          percentage: n / queuedIndexes.length,
          itemsProcessed: n,
        });

        try {
          const updated = await applyRubricChanges(target, changeDrafts[index] ?? '', signal);
          updateRubricAt(index, updated);
          revised.push(index);
        } catch (err: any) {
          if (signal.aborted) break;
          failed.push(target.title);
        }
      }

      if (revised.length > 0) {
        // Clear only what was actually applied, so a failed request is still there to retry.
        setChangeDrafts((prev) => {
          const next = { ...prev };
          for (const i of revised) delete next[i];
          return next;
        });
        setChangesConfirmed(false);
        setRevisedIndexes(revised);
        /*
          Named, not counted. "Your changes have been applied" reads the same whether one rubric
          changed or eight, and the green banner below the table said exactly that in exactly the
          place it had already been sitting — a word changing inside a box that was already green
          is not an event anyone notices.
        */
        const names = revised.map((i) => state.rubrics[i]?.title).filter(Boolean);
        setChangeSummary(
          `${revised.length === 1 ? 'Updated 1 rubric' : `Updated ${revised.length} rubrics`}` +
            (names.length > 0 ? ` — ${names.join(', ')}.` : '.'),
        );
        setRubricSource('revised');
        setReadyForCanvas(false);
        setShowDeployCard(false);
        setProgress({ percentage: 1, itemsProcessed: revised.length });
      }

      if (failed.length > 0) {
        setError(
          `Revised ${revised.length} of ${queuedIndexes.length}. Could not change ${failed.join(', ')}.`,
        );
      } else if (revised.length > 0) {
        setShowRequestChangesCard(false);
      }

      setTimeout(() => stopProgress(), 500);
    } finally {
      setIsApplyingChanges(false);
    }
  };

  const handleRecentDocClick = async (doc: RecentDoc) => {
    setShowRecentDocs(false);
    if (doc.source === 'url' && doc.url) {
      setGoogleDocUrl(doc.url);
      return;
    }
    if (doc.source === 'picker' && doc.fileId) {
      setIsPickerLoading(true);
      setError(null);
      try {
        let text = '';
        const mt = doc.mimeType || '';
        if (mt === 'application/vnd.google-apps.document') {
          text = await extractGoogleDocText(doc.fileId);
        } else if (mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mt === 'application/msword') {
          const ab = await downloadDriveFile(doc.fileId);
          const extracted = await mammoth.extractRawText({ arrayBuffer: ab });
          text = extracted.value;
        } else if (mt === 'application/pdf') {
          const ab = await downloadDriveFile(doc.fileId);
          text = await extractPdfText(ab, doc.name);
        } else if (mt === 'text/plain') {
          const ab = await downloadDriveFile(doc.fileId);
          text = new TextDecoder().decode(ab);
        } else {
          text = await extractGoogleDocText(doc.fileId);
        }
        setAssignmentDescription(text);
        setPickedFileName(doc.name);
        await adoptSourceDoc(doc.fileId, mt, doc.name);
        setInputMode('text');
      } catch (err: any) {
        setError(`Failed to re-load document: ${err.message}`);
      } finally {
        setIsPickerLoading(false);
      }
    }
  };

  const handleDashboard = () => {
    newBatch();
    setCurrentStep(AppMode.DASHBOARD);
  };

  /**
   * Whether the document already holds what is on screen.
   *
   * Saving an unchanged set is not a harmless no-op: it writes an identical revision, moves the
   * timestamp in the document's name, and replaces anything typed into that document by hand.
   * So the button switches itself off rather than inviting a press that can only cost something.
   *
   * It compares the rubrics themselves, not whether the change box has been typed in. A rename
   * and a points change never touch that box and are real changes the document should get, and
   * applying a change clears the box while leaving the document a version behind.
   *
   * A document saved before this existed has no fingerprint, so the button stays available —
   * the safe way round, since the alternative is a button that refuses to save a document that
   * really is out of date.
   */
  const liveFingerprint = React.useMemo(
    () => rubricsFingerprint(docPayload().rubrics),
    // The rubrics array's identity, which changes when the set is replaced or one is revised.
    // Memoised for the work it skips: this component re-renders four times a second while a
    // run's progress ticks, and a 39-rubric set is a long string to build each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.rubrics, state.rubric],
  );
  const docIsCurrent =
    !!state.savedDoc?.contentKey && state.savedDoc.contentKey === liveFingerprint;

  /**
   * Which of its three states the document card is in.
   *
   * One card rather than three. It used to be a grey panel naming the document, an amber warning
   * when that document had been edited by hand, and a green box reporting a change run — three
   * separate panels about one document, stacking up on top of each other, with three of their
   * five buttons doing the same two things.
   *
   * A conflict wins over a run summary because it is the thing that has to be settled before
   * anything can be written; the summary is still shown inside it, so nothing is lost by the
   * warning taking the colour.
   */
  const docCardState: 'conflict' | 'updated' | 'plain' = docConflict
    ? 'conflict'
    : changeSummary && !isApplyingChanges
      ? 'updated'
      : 'plain';

  return (
    <div className="flex flex-col items-center justify-center py-8">
      {/* About Phase 1 - Above Main Section */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 max-w-2xl w-full">
        <h3 className="text-sm font-black text-gray-900 mb-1">
          {editing ? 'About editing rubrics' : 'About Phase 1'}
        </h3>
        <p className="text-sm text-gray-700">
          {editing
            ? 'Choose a rubric document you already have, from this computer or from Google Drive. The app lists the rubrics in it and reads the ones you tick, so you can ask for changes in your own words. A document opened from Google Drive can be updated in place afterwards — the same file, under the same link — and anything else is saved as a new file or sent straight to Canvas.'
            : 'Paste or upload an assignment description, or a screenshot of a rubric you already have. The app drafts a rubric you can edit, then opens it as a Google Doc or saves it to this computer. Part 2 turns it into a Canvas CSV, and Part 3 sends it to your course.'}
        </p>
      </div>

      <div className={`bg-white p-10 rounded-3xl shadow-2xl border border-gray-100 w-full transition-all duration-300 ${showComparison && state.rubric ? 'max-w-5xl' : 'max-w-2xl'}`}>
        {!state.rubric ? (
          <>
            <h2 className="text-2xl font-black text-gray-900 mb-2">
              {editing ? 'Edit Existing Draft Rubrics' : 'Create Draft Rubric'}
            </h2>
            <p className="text-gray-600 font-medium mb-8">
              {editing
                ? 'Choose the rubric document you want to change. The app lists the rubrics in it, and reads only the ones you tick.'
                : "Specify the type of rubric you'd like and then paste or upload an assignment description."}
            </p>

            {/*
              One panel, not two. These are settings for the same request, and splitting them
              across two grey boxes with two different label styles — "PROCESSING TYPE" in black
              uppercase, "Total Points" in sentence case right beneath it — was most of why this
              screen read as assembled rather than designed.

              "How many rubrics?" used to sit at the top of this panel. It is gone because the
              question is now answered after the description has been read rather than before:
              the app looks for the assignment's separate parts and shows them, and the tick
              boxes are the answer. Asking up front could only ever be a guess, and the setting
              did not work anyway — it told the model to return several rubrics through a schema
              with room for one.
            */}
            {/*
              The confirmation step, standing in for the description form once there is something
              to confirm. Nothing has been generated at this point — the app has only read the
              description and proposed the parts it found — so the form is replaced rather than
              disabled: leaving it on screen invites a second run of the thing already decided.
            */}
            {plan !== null ? (
              <DeliverableChecklist
                rows={plan}
                onChange={setPlan}
                onConfirm={() => void handleConfirmPlan()}
                onCancel={() => setPlan(null)}
                busy={isGenerating}
                mode={mode}
              />
            ) : (
            <>
            {/*
              No settings when editing. Total points, the point style and the processing type all
              describe a rubric about to be written; a rubric being read already has its own, and
              a box offering to change them would be promising something this route does not do.
            */}
            {!editing && (
            <div className="mb-6 p-5 bg-gray-50 border border-gray-200 rounded-2xl space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="total-points" className="text-sm font-bold text-gray-900 block mb-2">
                    Total points
                  </label>
                  {/*
                    Deliberately type="text" with inputMode="numeric" rather than type="number".
                    A number input draws the spinner arrows, which are a small target sitting
                    right where the cursor goes, and it also captures the scroll wheel — with the
                    pointer over the box, scrolling the page silently rewrites the total. Neither
                    is worth the numeric keypad, which inputMode gives us anyway.
                  */}
                  <input
                    id="total-points"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={totalPointsText}
                    onChange={(e) => {
                      // Digits only, but an empty box stays empty: this is mid-edit, and
                      // substituting a default here is what made the field hard to type into.
                      const digits = e.target.value.replace(/\D/g, '');
                      setTotalPointsText(digits);
                      const parsed = parseInt(digits, 10);
                      if (Number.isFinite(parsed) && parsed > 0) {
                        setSettings({ ...settings, totalPoints: parsed });
                      }
                    }}
                    // Leaving the box blank falls back to the last figure that was committed,
                    // not to a hardcoded 100 — whatever was last generated from is the better
                    // guess at what was meant.
                    onBlur={() => setTotalPointsText(String(settings.totalPoints))}
                    className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl font-medium text-gray-900 focus:border-brand focus:outline-none transition-all"
                  />
                </div>
                <SegmentedChoice
                  label="Point style"
                  value={settings.pointStyle}
                  onChange={(pointStyle) => setSettings({ ...settings, pointStyle })}
                  options={[
                    { value: PointStyle.RANGE, label: 'Ranges', hint: '10 to >8' },
                    { value: PointStyle.SINGLE, label: 'Single', hint: '10, 8, 6' },
                  ]}
                />
              </div>
            </div>
            )}

            {/* Input Mode Toggle */}
            <div className="flex gap-3 mb-6 border-b border-gray-200">
              <button
                onClick={() => {
                  setInputMode('google-doc');
                  setError(null);
                }}
                className={`px-4 py-3 font-bold border-b-2 transition-all ${
                  inputMode === 'google-doc'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                From Google Drive
              </button>
              <button
                onClick={() => {
                  setInputMode('text');
                  setGoogleDocUrl('');
                  setError(null);
                }}
                className={`px-4 py-3 font-bold border-b-2 transition-all ${
                  inputMode === 'text'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                From Local Drive
              </button>
            </div>

            {inputMode === 'text' ? (
              <>
                {/* File Upload Area */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative w-full p-8 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center gap-4 cursor-pointer transition-all ${
                isDragging
                  ? 'bg-blue-50 border-blue-400'
                  : 'bg-gray-50 border-gray-200 hover:border-blue-300'
              }`}
            >
              <FileText className="w-8 h-8 text-gray-600" />
              <p className="text-sm font-bold text-gray-800">
                {editing
                  ? 'Drop a rubric document here or click to browse'
                  : 'Drop an assignment description document here or click to browse'}
              </p>
              <p className="text-xs text-gray-700">(.docx, .pdf, or .txt)</p>
              <input
                type="file"
                accept=".txt,.docx,.pdf"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                id="file-input"
                aria-label={
                  editing
                    ? 'Drop a rubric document here or click to browse'
                    : 'Drop an assignment description document here or click to browse'
                }
              />
            </div>

            {/* Text Extraction Label */}
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wider mt-6 mb-2">
              Or type it here
            </p>

            {/* Text Area */}
            <textarea
              value={assignmentDescription}
              onChange={(e) => setAssignmentDescription(e.target.value)}
              placeholder={
                editing
                  ? 'Or paste your rubrics here...'
                  : 'Or paste your assignment description here...'
              }
              className="w-full h-48 p-4 border rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />

            {/* Error Display */}
            {state.error && (
              <ErrorDisplay error={state.error} className="mt-6" />
            )}

                {/* Generate Button */}
                <button
                  onClick={handleGenerateRubric}
                  disabled={isGenerating || isDiscovering || plan !== null || !assignmentDescription.trim()}
                  className="w-full py-4 bg-brand text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-brand-dark transition-all disabled:bg-gray-300 active:scale-95 mt-6 flex items-center justify-center gap-2"
                >
                  {(isGenerating || isDiscovering) && <Loader2 className="w-5 h-5 animate-spin" />}
                  {isDiscovering
                    ? editing
                      ? 'Finding the rubrics...'
                      : 'Reading the description...'
                    : isGenerating
                      ? editing
                        ? 'Reading the rubrics...'
                        : 'Generating Rubric...'
                      : editing
                        ? 'Find the rubrics in this document'
                        : 'Analyze Description'}
                </button>
                {assignmentDescription.trim() && (
                  <p className="text-xs text-gray-600 text-center mt-2 italic">
                    {editing
                      ? 'The app lists the rubrics it finds first. Nothing is read in full until you tick the ones you want.'
                      : 'The app reads the description first to see how many rubrics it needs. Nothing is written until you confirm.'}
                  </p>
                )}
              </>
            ) : (
              <>
                {/* Google Account Status */}
                {state.isGoogleAuthenticated ? (
                  <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-green-200 flex items-center justify-center">
                        <span className="text-green-800 font-black text-sm">✓</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-green-900">Signed in as {state.googleUser?.name}</p>
                        <p className="text-xs text-green-800">{state.googleUser?.email}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => signOutGoogle()}
                      className="text-xs font-bold text-green-800 hover:text-green-900 transition-all"
                    >
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
                    <p className="text-sm font-bold text-gray-700 mb-2">Google sign-in required</p>
                    <p className="text-xs text-gray-700 mb-3">Sign in to access Google Docs directly from your Drive.</p>
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

                {/* Browse Drive button */}
                <button
                  onClick={handlePickerOpen}
                  disabled={isPickerLoading || fetchingGoogleDoc || !state.isGoogleAuthenticated}
                  className="w-full py-3 px-4 bg-brand text-white rounded-xl font-bold hover:bg-brand-dark disabled:bg-gray-300 disabled:text-gray-400 transition-all text-sm flex items-center justify-center gap-2 mb-6"
                >
                  {(isPickerLoading || fetchingGoogleDoc) ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 2H5C3.9 2 3 2.9 3 4v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 12 12 12s-3.5-1.57-3.5-3.5S10.07 5 12 5zm7 14H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/>
                    </svg>
                  )}
                  {isPickerLoading ? 'Opening Drive...' : fetchingGoogleDoc ? 'Fetching Document...' : 'Browse Google Drive'}
                </button>

                {/* Picked file feedback chip */}
                {pickedFileName && (
                  <div className="flex items-center gap-2 mb-4 mt-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl">
                    <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
                    <span className="text-sm font-bold text-blue-800 truncate flex-1">{pickedFileName}</span>
                    <button
                      onClick={() => setPickedFileName(null)}
                      aria-label="Remove selected file"
                      className="text-blue-600 hover:text-blue-800 flex-shrink-0 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Recent Documents */}
                {recentDocs.length > 0 && (
                  <div className="mb-6">
                    <button
                      onClick={() => setShowRecentDocs(!showRecentDocs)}
                      className="flex items-center gap-2 text-sm font-bold text-gray-700 hover:text-gray-900 transition-colors mb-2"
                    >
                      <Clock className="w-4 h-4" />
                      Recent Documents
                      {showRecentDocs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    {showRecentDocs && (
                      <div className="border border-gray-200 rounded-xl overflow-hidden">
                        {recentDocs.map((doc, i) => (
                          <button
                            key={i}
                            onClick={() => handleRecentDocClick(doc)}
                            disabled={isPickerLoading}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-all text-left border-b border-gray-100 last:border-0 disabled:opacity-50"
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

                {/* Divider */}
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">or paste a URL</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                {/* Google Drive URL Input */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Google Drive URL
                  </label>
                  <input
                    type="url"
                    value={googleDocUrl}
                    onChange={(e) => setGoogleDocUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleFetchGoogleDoc(); }}
                    placeholder="docs.google.com/document/d/… or drive.google.com/file/d/…"
                    className="w-full px-4 py-3 border rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none mb-3"
                  />
                  <p className="text-xs text-gray-700 mb-4">
                    Supports Google Docs, Word (.docx), and PDF files stored in Drive. The file must be accessible to your signed-in account.
                  </p>
                  <button
                    onClick={handleFetchGoogleDoc}
                    disabled={!googleDocUrl.trim() || fetchingGoogleDoc || !state.isGoogleAuthenticated}
                    className="w-full py-3 px-4 bg-blue-100 text-blue-700 rounded-xl font-bold hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 transition-all text-sm"
                  >
                    {fetchingGoogleDoc ? 'Fetching...' : 'Fetch Document'}
                  </button>
                </div>

                {/* Error Display */}
                {state.error && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-2xl mt-6">
                    <p className="text-sm text-red-700 font-bold">{state.error}</p>
                  </div>
                )}

                {/*
                  Amber, not red, and it sits below the error rather than replacing it: nothing
                  has failed here. It answers the question a slow run provokes — is this stuck? —
                  and it is a status rather than a problem, so it never takes the error's colour.
                */}
                {paceNotice && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl mt-6" role="status">
                    <p className="text-sm text-amber-800">{paceNotice}</p>
                  </div>
                )}

                {/* Generate Button */}
                <button
                  onClick={handleGenerateRubric}
                  disabled={isGenerating || isDiscovering || plan !== null || !assignmentDescription.trim()}
                  className="w-full py-4 bg-brand text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-brand-dark transition-all disabled:bg-gray-300 active:scale-95 mt-6 flex items-center justify-center gap-2"
                >
                  {(isGenerating || isDiscovering) && <Loader2 className="w-5 h-5 animate-spin" />}
                  {isDiscovering
                    ? editing
                      ? 'Finding the rubrics...'
                      : 'Reading the description...'
                    : isGenerating
                      ? editing
                        ? 'Reading the rubrics...'
                        : 'Generating Rubric...'
                      : editing
                        ? 'Find the rubrics in this document'
                        : 'Analyze Description'}
                </button>
              </>
            )}
            </>
            )}
          </>
        ) : (
          <>
            {/*
              The heading this half of the card never had.

              This is one card with two states: before anything is generated it is headed "Create
              Draft Rubric" with a line saying what to do, and afterwards it simply began with the
              rubric switcher. So everything below — the list, the table, the save buttons, the
              adjust and request-changes panels, the deploy button — sat under no heading at all,
              and the biggest text in the area was the rubric's own title, which made a single
              rubric look like the subject of the page rather than one of eight.

              h1 at the scale DESIGN_SYSTEM.md sets, matching the other state's heading, which
              also puts the rubric title back down to h2 where it belongs.
            */}
            <h2 className="text-2xl font-black text-gray-900 mb-2">Review Your Draft Rubrics</h2>
            <p className="text-gray-600 font-medium mb-8">
              Check each rubric, make any changes, then send them to Canvas.
            </p>

            {/* Display Generated Rubric — comparison layout */}
            <div className={showComparison ? 'grid grid-cols-2 gap-8' : ''}>

              {/* Left column: original assignment text */}
              {showComparison && snapshotDescription && (
                <div className="flex flex-col">
                  <h3 className="text-xs font-black text-gray-600 uppercase tracking-widest mb-3">Original Assignment</h3>
                  <div className="flex-1 h-96 overflow-y-auto p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 whitespace-pre-wrap leading-relaxed font-mono">
                    {snapshotDescription}
                  </div>
                </div>
              )}

              {/* Right column (or full width): rubric */}
              <div>
                {/*
                  The deliverables checklist, back in place without leaving the page.

                  It is the pre-generation form, so it appears here only when the user has asked
                  to choose the parts again — and confirming it replaces every rubric below. The
                  rubrics stay rendered underneath rather than being hidden, so what is about to
                  be replaced is visible while the choice is being made.
                */}
                {plan !== null && (
                  <div className="mb-6 p-5 bg-white border-2 border-brand rounded-2xl shadow-md">
                    <h3 className="text-lg font-black text-gray-900 mb-1">
                      {editing ? 'Choose the rubrics again' : 'Choose the parts again'}
                    </h3>
                    <p className="text-sm text-gray-700 mb-4">
                      Rename anything, change the points, tick or untick a part. Drafting replaces
                      the {state.rubrics.length === 1 ? 'rubric' : `${state.rubrics.length} rubrics`} below.
                    </p>
                    <DeliverableChecklist
                      rows={plan}
                      onChange={setPlan}
                      onConfirm={() => void handleConfirmPlan()}
                      onCancel={() => setPlan(null)}
                      mode={mode}
                      busy={isGenerating}
                    />
                  </div>
                )}

                <RubricSwitcher
                  rubrics={state.rubrics}
                  activeIndex={state.activeRubricIndex}
                  onOpen={openRubric}
                  pending={queuedIndexes}
                  revised={revisedIndexes}
                />
                <h3 className="text-lg font-bold text-gray-900 mb-2">
                  {state.rubric.title}
                </h3>
                {/*
                  The computed total, not `rubric.totalPoints`. That field is the AI's own claim
                  about its criteria and can contradict them — it is what said 100 on a rubric
                  whose criteria added up to 300. canvasTotal reads the rating strings, which are
                  the only thing Canvas receives, so this number and the deployed rubric cannot
                  disagree.
                */}
                <p className="text-sm text-gray-600 mb-6">
                  {state.rubric.criteria.length} criteria • {canvasTotal(state.rubric)} points
                </p>

                {activeReport && (
                  <RubricPointsWarning
                    report={activeReport}
                    evenSplitPreview={rescalePreview}
                    onSplitByImportance={handleSplitByImportance}
                    onDivideEvenly={handleRescaleToIntended}
                    /*
                      No setReadyForCanvas(false) on this one, unlike the other two. It moves no
                      rating and changes nothing Canvas will receive — it only records that the
                      criteria, not the drafted total, are the ones to go by. Retiring the
                      readiness tick for that would ask for a no-op to be re-confirmed.
                    */
                    onKeepActual={() => {
                      if (!state.rubric) return;
                      updateRubricAt(state.activeRubricIndex, settleStatedTotal(state.rubric));
                    }}
                  />
                )}

                {/* Preview Table */}
                <div className="overflow-x-auto mb-6 border rounded-2xl">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-2 text-left font-black text-gray-900">Criteria</th>
                        <th className="px-4 py-2 text-left font-black text-gray-900">Exemplary</th>
                        <th className="px-4 py-2 text-left font-black text-gray-900">Proficient</th>
                        <th className="px-4 py-2 text-left font-black text-gray-900">Developing</th>
                        <th className="px-4 py-2 text-left font-black text-gray-900">Unsatisfactory</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.rubric.criteria.map((criterion, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-2 font-bold text-gray-900">{criterion.category}</td>
                          <td className="px-4 py-2 text-gray-700">{criterion.exemplary.points}</td>
                          <td className="px-4 py-2 text-gray-700">{criterion.proficient.points}</td>
                          <td className="px-4 py-2 text-gray-700">{criterion.developing.points}</td>
                          <td className="px-4 py-2 text-gray-700">{criterion.unsatisfactory.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Success Banner — below table */}
                <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
                    <div>
                      {rubricSource === 'uploaded' ? (
                        <>
                          <p className="font-black text-green-900">✓ Draft Rubric Received!</p>
                          <p className="text-sm text-green-800">Your uploaded rubric has been processed and is ready to review.</p>
                        </>
                      ) : rubricSource === 'revised' ? (
                        <>
                          <p className="font-black text-green-900">✓ Draft Rubric Updated!</p>
                          <p className="text-sm text-green-800">Your requested changes have been applied to the rubric.</p>
                          <p className="text-sm text-green-800 mt-1">We recommend reviewing all changes before deploying to Canvas.</p>
                        </>
                      ) : (
                        <>
                          <p className="font-black text-green-900">✓ Draft Rubric Created!</p>
                          <p className="text-sm text-green-800">Your draft rubric has been generated successfully.</p>
                          <p className="text-sm text-green-800 mt-1">We recommend making your own edits to this AI-generated rubric.</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/*
                  Two buttons. One changes the rubric in front of you; the other discards the lot.

                  There were five, then four. Open in Google Docs and Save to this computer moved
                  into the document card at the foot of this screen. Then "Replace this rubric
                  from a file" was cut and "Adjust this rubric" folded into the panel below —
                  three ways to change a rubric, sitting in three places, two of them looking
                  identical while one was instant and the other took ten seconds of Gemini. A
                  tester asked three times what the file button did, which is the finding.
                */}
                <div className="flex gap-3 mb-3">
                  {/*
                    A toggle, not a one-way switch, and deliberately not closed by moving between
                    rubrics — writing a request for each and applying them in one run is the
                    whole point of it. The cost is a panel which, several rubrics later, looks
                    like part of the page rather than something switched on earlier; so the
                    button says that it did, and carries aria-expanded for anyone not going by
                    colour.
                  */}
                  <button
                    onClick={() => {
                      setShowRequestChangesCard((open) => !open);
                      setShowStartOverCard(false);
                    }}
                    aria-expanded={showRequestChangesCard}
                    className={`flex-[2] px-4 py-3 rounded-xl font-bold transition-all text-sm flex items-center justify-center gap-2 ${
                      showRequestChangesCard
                        ? 'bg-brand/10 text-brand border-2 border-brand'
                        : 'bg-gray-100 text-gray-900 hover:bg-gray-200 border-2 border-transparent'
                    }`}
                  >
                    <RotateCw className="w-4 h-4" />
                    Change this rubric
                  </button>
                  {/*
                    Moved here from the bottom of "Adjust this rubric", which was the wrong home
                    for it twice over. That panel is headed "rename it or change its points" and
                    promises "Changes here are instant and keep every word as written. No AI
                    involved" — and this discards every rubric and re-runs the AI across all of
                    them. It also acts on the whole set, where everything else in that panel acts
                    on one rubric. A user reported not knowing what it did.

                    "Start over" carries the scope and the cost; "from the description" names the
                    input. Neither depends on remembering the word "parts" from a screen that is
                    no longer on display.
                  */}
                  {lastPlan && (
                    <button
                      onClick={() => {
                        setShowStartOverCard((open) => !open);
                        setShowRequestChangesCard(false);
                      }}
                      aria-expanded={showStartOverCard}
                      className={`flex-1 px-4 py-3 rounded-xl font-bold transition-all text-sm flex items-center justify-center gap-2 ${
                        showStartOverCard
                          ? 'bg-brand/10 text-brand border-2 border-brand'
                          : 'bg-gray-100 text-gray-900 hover:bg-gray-200 border-2 border-transparent'
                      }`}
                    >
                      <RotateCcw className="w-4 h-4" />
                      {editing ? 'Choose different rubrics' : 'Start over from the description'}
                    </button>
                  )}
                </div>

                {/*
                  The confirmation, unchanged in substance — it was always explicit about what is
                  lost. The problem was never this text; it was that nothing before the click
                  suggested you were near anything destructive.
                */}
                {showStartOverCard && lastPlan && (
                  <div className="mb-6 p-4 bg-white border-2 border-brand rounded-2xl">
                    <p className="text-sm font-bold text-gray-900 mb-1">
                      {editing
                        ? 'Go back to the list of rubrics in the document?'
                        : 'Re-draft from the assignment description?'}
                    </p>
                    <p className="text-sm text-gray-700 mb-3">
                      {editing
                        ? 'This brings back the list the app found in your document so you can tick a different set — then reads every ticked rubric again from the document.'
                        : 'This brings back the list of parts so you can change which ones get a rubric, their names and their points — then writes every ticked rubric again from scratch.'}
                      <span className="font-bold">
                        {' '}
                        Everything currently on screen is replaced, including any changes you have
                        applied.
                      </span>{' '}
                      Save your CSVs first if you want to keep them.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setShowStartOverCard(false);
                          setPlan(lastPlan);
                        }}
                        className="px-4 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand-dark transition-all active:scale-95"
                      >
                        {editing ? 'Choose the rubrics again' : 'Choose the parts again'}
                      </button>
                      <button
                        onClick={() => setShowStartOverCard(false)}
                        className="px-4 py-2 bg-gray-100 text-gray-900 rounded-xl font-bold text-sm hover:bg-gray-200 transition-all"
                      >
                        Keep what I have
                      </button>
                    </div>
                  </div>
                )}

                {/*
                  Name and points, before the AI options rather than after them.

                  Both used to be reachable only through Request Changes, which sends the whole
                  rubric back to Gemini: ten seconds and a request to change a string, with no
                  guarantee the model changed only what was asked. These do the two cheap things
                  directly and leave Request Changes for what actually needs judgement.
                */}
                {/*
                  Request Changes, above the confirm and deploy controls rather than below them.
                  It used to render after the deploy button, so opening it put "describe your
                  changes" underneath "deploy to Canvas" — the reading order of the page said to
                  deploy first and revise afterwards. Placing it here makes deploy the last thing
                  on the screen, which is where the one irreversible action belongs, and needs no
                  controls that move about depending on state.
                */}
                {showRequestChangesCard && state.rubric && (
                  <div className="mb-4 rounded-2xl border border-gray-200 bg-gray-50 p-5">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      {/* The heading names the rubric because the panel is identical for all of
                          them, and the only other thing saying which one you are editing is the
                          switcher further up the page. */}
                      <h3 className="text-base font-bold text-gray-900">
                        Change this rubric — {state.rubric.title}
                      </h3>
                      <button
                        onClick={() => setShowRequestChangesCard(false)}
                        aria-label="Close change this rubric"
                        className="text-gray-600 hover:text-gray-900 transition-colors flex-shrink-0"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/*
                      Two ways to change a rubric, each labelled with what it costs.

                      These used to be separate controls that looked alike — "Adjust this rubric"
                      in a disclosure and "Request Changes" in the button row — and nothing said
                      that the first was instant and local while the second sent the whole rubric
                      to Gemini for ten seconds. A user cannot be expected to guess that, and the
                      cheap one is the one worth reaching for: renaming a rubric through the AI
                      is ten seconds and a chance of rewording for a change a text field makes
                      exactly.

                      Cheapest first, so the order of the panel is the order of preference.
                    */}
                    <div className="pb-5 border-b border-gray-200">
                      <span className="inline-block text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-green-50 text-green-800">
                        Instant · no AI
                      </span>
                      <h4 className="text-sm font-bold text-gray-900 mt-2">
                        Rename it, or change its points
                      </h4>
                      <p className="text-xs text-gray-600 mt-0.5 mb-3">
                        Every word stays exactly as written.
                      </p>
                      <RubricAdjustPanel
                        embedded
                        rubric={state.rubric}
                        rubricIndex={state.activeRubricIndex}
                        onChange={(next) => {
                          updateRubricAt(state.activeRubricIndex, next);
                          // Any change to a rubric retires the readiness confirmation. The tick
                          // says no further revision is needed, and a rename is a revision.
                          setReadyForCanvas(false);
                          setShowDeployCard(false);
                        }}
                        deployedToCanvas={state.deployedToCanvas}
                        busy={isGenerating || isApplyingChanges}
                      />
                    </div>

                    <div className="pt-5">
                      <span className="inline-block text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-blue-50 text-brand">
                        Asks the AI · about 10 seconds each
                      </span>
                      <h4 className="text-sm font-bold text-gray-900 mt-2">
                        Ask for a change in your own words
                      </h4>
                      <p className="text-sm text-gray-600 mt-0.5 mb-3">
                        {state.rubrics.length > 1
                          ? 'Describe what should change in this rubric. Nothing is rewritten yet — tick the box below, move to another rubric if you want, and apply them all together.'
                          : 'Describe what should change. Tick the box below, then apply.'}
                      </p>

                    <textarea
                      value={activeDraft}
                      onChange={(e) => setDraft(state.activeRubricIndex, e.target.value)}
                      aria-label={`Changes for ${state.rubric.title}`}
                      placeholder="e.g. Add a criterion for Peer Collaboration worth 10 points. Rename 'Communication' to 'Written Communication'."
                      className="w-full h-32 p-4 border border-gray-300 rounded-2xl focus:border-brand focus:outline-none resize-none text-sm"
                    />

                    {/*
                      One tick for the whole run, listing what it covers. Per-rubric ticks meant
                      the box on screen confirmed only the rubric on screen, so the thing you were
                      agreeing to was never visible in one place — and forgetting one left a
                      rubric silently unchanged.
                    */}
                    <label className="flex items-start gap-3 mt-3 cursor-pointer select-none">
                      {/*
                        The box stays visible when it is disabled; only the words beside it dim.

                        It used to fade to 40%, and an empty checkbox at 40% on a grey panel is
                        invisible — leaving "then tick this to send it" pointing at nothing, which
                        reads as a leftover sentence rather than an instruction. Dimming the text
                        says "not yet" without hiding the thing being described.
                      */}
                      <input
                        type="checkbox"
                        checked={changesConfirmed}
                        disabled={queuedIndexes.length === 0}
                        onChange={(e) => setChangesConfirmed(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-brand flex-shrink-0 disabled:cursor-not-allowed"
                      />
                      <span
                        className={`text-sm ${
                          queuedIndexes.length === 0 ? 'text-gray-600' : 'text-gray-700'
                        }`}
                      >
                        {queuedIndexes.length === 0 ? (
                          'Describe a change above, then tick this to send it.'
                        ) : queuedIndexes.length === 1 ? (
                          <>
                            Send this change for{' '}
                            <strong>{state.rubrics[queuedIndexes[0]]?.title}</strong>.
                          </>
                        ) : (
                          <>
                            Send these changes for <strong>{queuedIndexes.length} rubrics</strong>:{' '}
                            {queuedIndexes
                              .map((i) => state.rubrics[i]?.title)
                              .filter(Boolean)
                              .join(', ')}
                            .
                          </>
                        )}
                      </span>
                    </label>
                    </div>
                  </div>
                )}

                {/*
                  The run button sits outside the panel on purpose. Inside a card headed with one
                  rubric's name it would read as "apply to this rubric", and it applies to every
                  one that has been ticked — the same confusion of scope the shared text box used
                  to cause. So it names its own count instead.
                */}
                {showRequestChangesCard && queuedIndexes.length > 0 && (
                  <button
                    onClick={handleApplyChanges}
                    disabled={isApplyingChanges || !changesConfirmed}
                    className="w-full py-3 mb-3 bg-brand text-white rounded-2xl font-black uppercase tracking-widest shadow-lg hover:bg-brand-dark transition-all disabled:bg-gray-300 active:scale-95 flex items-center justify-center gap-2"
                  >
                    {isApplyingChanges && <Loader2 className="w-5 h-5 animate-spin" />}
                    {isApplyingChanges
                      ? 'Applying changes...'
                      : queuedIndexes.length === 1
                        ? 'Apply changes to 1 rubric'
                        : `Apply changes to ${queuedIndexes.length} rubrics`}
                  </button>
                )}

                {showRequestChangesCard && queuedIndexes.length > 0 && !changesConfirmed && (
                  <p className="text-xs text-gray-600 mb-3 text-center">
                    Tick the box above to turn on the button.
                  </p>
                )}

                {/*
                  Outside the Request Changes card, which closes itself on a successful run — a
                  confirmation that disappears along with the thing it is confirming is no
                  confirmation at all. Live so it is announced rather than only drawn.
                */}
                {/*
                  Everything about the document, at the point the document is finished with.

                  It used to sit above the rubric table, which is where a user asked why: every
                  action on the document happens after the rubric has been read and changed, and
                  the card naming it sat a scroll above all of them. It is now the last thing in
                  the review card, directly before Deploy to Canvas.

                  One card in three states. A run summary that needs the document updated, a
                  document edited by hand since the app wrote it, and the plain record of where
                  the rubrics went are all the same question — what should happen to this file —
                  so they share one set of buttons instead of stacking three panels with three
                  versions of the same two actions.

                  role="status" stays on the outside: the summary inside it is the result of a
                  run that has just finished, and it is announced rather than only drawn.
                */}
                <div role="status" aria-live="polite">
                  <div
                    className={`mb-3 p-4 rounded-2xl border ${
                      docCardState === 'conflict'
                        ? 'bg-amber-50 border-amber-200'
                        : docCardState === 'updated'
                          ? 'bg-green-50 border-green-200'
                          : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {docCardState === 'conflict' ? (
                        <AlertTriangle
                          className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                      ) : docCardState === 'updated' ? (
                        <CheckCircle
                          className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                      ) : null}

                      <div className="min-w-0 flex-1">
                        {/* The run first, where there has been one: it is why the rest matters. */}
                        {changeSummary && !isApplyingChanges && (
                          <p
                            className={`text-sm font-bold ${
                              docCardState === 'conflict' ? 'text-amber-900' : 'text-green-900'
                            }`}
                          >
                            {changeSummary}
                          </p>
                        )}

                        {docCardState === 'conflict' ? (
                          <p className="text-sm text-amber-900 mt-1">
                            {docConflict === 'trashed'
                              ? 'That document is in your Google Drive bin, so nothing can be written back to it. The rubrics need a new document.'
                              : 'That document is no longer in your Google Drive, so nothing can be written back to it. The rubrics need a new document.'}
                          </p>
                        ) : changeSummary && !isApplyingChanges ? (
                          /* The gap someone actually hit: the table redraws, the document does
                             not, and nothing said so. */
                          <p className="text-sm text-green-800 mt-1">
                            {state.savedDoc
                              ? 'The rubrics on screen are the new versions. Your Google Doc still holds the previous ones.'
                              : 'The rubrics on screen are the new versions. Anything you have already saved still holds the previous ones.'}
                          </p>
                        ) : (
                          <p className="text-sm font-bold text-gray-900">
                            {state.savedDoc ? 'Google Doc' : 'Not saved yet'}
                          </p>
                        )}

                        {/*
                          The document's own name, on screen rather than announced once and
                          forgotten. Creating it used to return a file id and a link that were
                          both thrown away, so the only record of where the rubrics went was a
                          browser tab that may have opened behind the app or on another screen.
                        */}
                        {state.savedDoc && (
                          <>
                            <p
                              className="text-sm text-gray-700 truncate mt-2"
                              title={state.savedDoc.name}
                            >
                              {state.savedDoc.name}
                            </p>
                            <div className="flex flex-wrap items-center gap-4 mt-1">
                              {/* A plain link: the window's navigation guard sends it to the
                                  system browser, and Google Docs is already on the external-link
                                  allowlist. */}
                              <a
                                href={state.savedDoc.webViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-bold text-brand hover:text-brand-dark underline"
                              >
                                Open
                              </a>
                              <button
                                type="button"
                                onClick={() => state.savedDoc && copy(state.savedDoc.webViewLink)}
                                className="text-sm font-bold text-brand hover:text-brand-dark underline"
                              >
                                {copyState === 'copied'
                                  ? 'Link copied'
                                  : copyState === 'failed'
                                    ? 'Could not copy'
                                    : 'Copy link'}
                              </button>
                            </div>
                          </>
                        )}

                        {/*
                          The buttons the state calls for, and never two that contradict.

                          A gone document offers the one move left. There is nothing to weigh:
                          the file cannot be written to by anybody, so Overwrite and Leave it
                          alone would both be buttons that do nothing.
                        */}
                        <div className="flex flex-wrap items-center gap-3 mt-3">
                          {docCardState === 'conflict' ? (
                            <button
                              type="button"
                              onClick={handleExportToDrive}
                              disabled={savingToDrive}
                              className="px-3 py-2 rounded-xl text-sm font-bold bg-white border-2 border-amber-500 text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                            >
                              Create a new document
                            </button>
                          ) : (
                            <>
                              {/*
                                One button, two jobs. Once a document exists this writes back to
                                it, which is what keeps its link permanent and its Google Docs
                                revision history worth reading; creating another copy is the
                                quieter link further along, where it reads as the deliberate
                                choice it is rather than the default.
                              */}
                              <button
                                type="button"
                                onClick={state.savedDoc ? handleUpdateDoc : handleExportToDrive}
                                disabled={
                                  savingToDrive || !state.isGoogleAuthenticated || docIsCurrent
                                }
                                title={
                                  !state.isGoogleAuthenticated
                                    ? 'Sign in to Google under Initial Setup to use this'
                                    : docIsCurrent
                                      ? 'The document already holds these rubrics'
                                      : undefined
                                }
                                className={`px-4 py-2 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:bg-gray-300 disabled:text-gray-500 flex items-center gap-2 ${
                                  preferLocalOutput
                                    ? 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                                    : 'bg-brand text-white hover:bg-brand-dark'
                                }`}
                              >
                                {savingToDrive && <Loader2 className="w-4 h-4 animate-spin" />}
                                {/*
                                  "Update the Google Doc" was read as pulling the document's own
                                  edits back into the app — the opposite of what it does. The
                                  rubrics go out; the document is a destination, the same as the
                                  button beside it. Two labels starting "Save to" can only be
                                  read one way, and the line below carries what "Update" used to
                                  say about replacing what is there.
                                */}
                                {savingToDrive
                                  ? state.savedDoc
                                    ? 'Saving…'
                                    : 'Creating…'
                                  : state.savedDoc
                                    ? 'Save changes to the Google Doc'
                                    : 'Open in Google Docs'}
                              </button>

                              {/*
                                Available whether or not the user is signed in. Google sign-in is
                                the part of this app most likely to be broken for someone, and a
                                rubric they cannot get out of the app is worse than one in a
                                slightly less convenient format.
                              */}
                              <button
                                type="button"
                                onClick={handleSaveLocal}
                                disabled={savingLocal}
                                className={`px-4 py-2 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2 ${
                                  preferLocalOutput
                                    ? 'bg-brand text-white hover:bg-brand-dark'
                                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                {savingLocal ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Download className="w-4 h-4" />
                                )}
                                {savingLocal ? 'Saving…' : 'Save to this computer'}
                              </button>

                              {state.savedDoc && (
                                <button
                                  type="button"
                                  onClick={handleExportToDrive}
                                  disabled={savingToDrive}
                                  className="text-sm text-gray-700 hover:text-gray-900 underline disabled:opacity-50"
                                >
                                  Create a new one instead
                                </button>
                              )}
                            </>
                          )}
                        </div>

                        {/*
                          Where the previous version went, said once and quietly.

                          This replaces a card that stopped the update to ask permission. The
                          information in it was worth keeping — an update does replace whatever
                          is in the document — but as a line beside the button rather than a gate
                          in front of it. Google Docs keeps every revision, so nothing is lost
                          that cannot be fetched back in two clicks.
                        */}
                        {state.savedDoc && (
                          <p className="text-xs text-gray-600 mt-3">
                            {docIsCurrent
                              ? 'The document already holds these rubrics. Change one above and this turns back on.'
                              : 'Saving replaces what is in the document. Google Docs keeps the previous version under File → Version history.'}
                          </p>
                        )}

                        {driveSaveSuccess && (
                          <p className="text-xs text-green-800 font-bold mt-3">
                            ✓ {driveSaveSuccess}
                          </p>
                        )}
                        {!state.isGoogleAuthenticated && (
                          <p className="text-xs text-gray-600 mt-3">
                            You need to go to Initial Setup and sign into Google first to use the
                            Google Docs route. Saving to this computer works either way.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/*
        Deploying is its own card.

        It used to sit at the bottom of the review card, inside the same column as the rubric
        table — so the confirmation tick, the deploy button and the CSV link read as more of the
        reviewing rather than as the thing reviewing leads to. Two cards put the seam where the
        decision is: everything above is "is this rubric right?", everything here is "send it".

        Rendered as a sibling of the review card, which is how the Upload Replacement card
        already works, and kept at max-w-2xl so it does not stretch when the comparison view
        widens the card above it.
      */}
      {state.rubric && (
        <div className="bg-white p-8 rounded-3xl shadow-2xl border border-gray-100 w-full max-w-2xl mt-6">
          <h2 className="text-2xl font-black text-gray-900 mb-2">
            {onAnalyzeDeploy ? 'Deploy to Canvas' : 'Continue to Part 2'}
          </h2>
          <p className="text-gray-600 font-medium mb-2">
            {onAnalyzeDeploy
              ? state.rubrics.length > 1
                ? `Send all ${state.rubrics.length} rubrics to your Canvas course.`
                : 'Send this rubric to your Canvas course.'
              : 'Turn the rubric into a Canvas CSV in Part 2.'}
          </p>

          {/*
            What is actually sent, said where the sending happens.

            A tester assumed that deploying takes whatever is currently in the Google Doc. It does
            not: Canvas is built from the rubrics in this app, and the document is a rendering of
            those rubrics rather than the source of them. The assumption is a reasonable one —
            the document is the thing they have been reading and may well have typed in — and
            nothing on this screen corrected it. Anything typed into the document by hand reaches
            Canvas only after coming back through "Edit existing draft rubrics".
          */}
          <p className="text-sm text-gray-600 mb-6">
            {state.rubrics.length > 1
              ? 'The rubrics above are what gets sent.'
              : 'The rubric above is what gets sent.'}
            {state.savedDoc
              ? ' Anything you have typed into the Google Doc by hand is not included — open that document through "Edit existing draft rubrics" first to bring it in.'
              : ''}
          </p>

          {/*
            Named here as well as on each rubric, because this is the screen where the decision
            is actually made. Rubrics deploy as a set, and a set is reviewed by opening the first
            one — so a problem on the fourth never gets seen unless the deploy step says so.
          */}
          {flaggedRubrics.length > 0 && (
            <div className="mb-6 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
              <AlertTriangle
                className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm font-bold text-amber-900">
                  {flaggedRubrics.length === 1
                    ? 'One rubric is not worth the points it was asked for'
                    : `${flaggedRubrics.length} rubrics are not worth the points they were asked for`}
                </p>
                {/* The figures, not just the names. Someone told only that a rubric is wrong goes
                    looking for the problem in the document, where there is now nothing to find —
                    the document states the real total, and the total that was asked for appears
                    nowhere in it. */}
                <ul className="mt-1 space-y-0.5">
                  {flaggedRubrics.map(({ rubric, report }, i) => (
                    <li key={i} className="text-sm text-amber-900">
                      <strong>{rubric.title}</strong>
                      {report.totalsDisagree
                        ? ` — worth ${report.actual} points, asked for ${report.intended}.`
                        : ' — its point ranges overlap.'}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-sm text-amber-900">
                  Open {flaggedRubrics.length === 1 ? 'it' : 'each one'} above to choose how to fix
                  it. Deploying anyway is allowed — Canvas receives the points shown on each
                  rubric.
                </p>
              </div>
            </div>
          )}

          {/*
            A second thing the set can be wrong about, in the same place and the same shape.

            Canvas does not enforce unique rubric names, so a document holding two rubrics called
            the same thing deploys both and leaves a course with entries nobody can tell apart
            without opening them. Legal, occasionally intended, and never a reason to block the
            deploy — so it states the clash and leaves the decision alone, exactly as the points
            warning above does.
          */}
          {duplicateWarning && (
            <div className="mb-6 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
              <AlertTriangle
                className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <p className="text-sm text-amber-900 min-w-0">{duplicateWarning}</p>
            </div>
          )}

        {/* Ready confirmation checkbox */}
        {onAnalyzeDeploy && (
          /*
            This is the only thing standing between the user and the deploy button, and
            as a bare 16px check box under grey 14px text it did not look like one — the
            button below reads as broken rather than waiting. So the box asks for
            something, and the panel carries the brand border until it is ticked,
            at which point it turns green and stops asking for attention. Brand is a
            border and text here, never a fill: this is a gate, not a button.
          */
          <label
            className={`flex items-start gap-4 mb-3 p-5 rounded-2xl border-2 cursor-pointer select-none transition-all ${
              readyForCanvas
                ? 'bg-green-50 border-green-400'
                : 'bg-white border-brand ring-4 ring-brand/15 shadow-md hover:bg-gray-50'
            }`}
          >
            <input
              type="checkbox"
              checked={readyForCanvas}
              onChange={(e) => {
                setReadyForCanvas(e.target.checked);
                if (!e.target.checked) setShowDeployCard(false);
              }}
              className="mt-0.5 w-6 h-6 accent-green-600 flex-shrink-0"
            />
            <span>
              <span
                className={`block text-base font-black ${
                  readyForCanvas ? 'text-green-800' : 'text-brand'
                }`}
              >
                {readyForCanvas
                  ? 'Ready to proceed'
                  : 'Tick this box when you are ready to proceed'}
              </span>
              {/* Written when a run made one rubric. With eight, confirming "the rubric
                  currently displayed" while the button deploys all of them is a tick box
                  that does not describe what it authorises. */}
              <span className="block text-sm text-gray-700 mt-1">
                {state.rubrics.length > 1
                  ? `No further revision is needed. All ${state.rubrics.length} rubrics are ready for Canvas.`
                  : 'No further revision is needed. The rubric above is ready for Canvas.'}
              </span>
            </span>
          </label>
        )}

        {/* Deploy Action — bottom */}
        <button
          onClick={() => {
            if (onAnalyzeDeploy) {
              setShowDeployCard(true);
            } else {
              handleContinue();
            }
          }}
          disabled={!!(onAnalyzeDeploy && (!canAnalyzeDeploy || !readyForCanvas))}
          aria-describedby={
            onAnalyzeDeploy && (!canAnalyzeDeploy || !readyForCanvas)
              ? 'deploy-blocked-reason'
              : undefined
          }
          className={`w-full py-4 bg-brand text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-brand-dark transition-all active:scale-95 flex items-center justify-center gap-2 disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none disabled:cursor-not-allowed ${showDeployCard ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <ArrowRight className="w-5 h-5" />
          {onAnalyzeDeploy
            ? state.rubrics.length > 1
              ? `Deploy All ${state.rubrics.length} Rubrics to Canvas`
              : 'Deploy Displayed Rubric to Canvas'
            : 'Continue to Part 2: Convert to CSV'}
        </button>

        {/*
          A disabled button with no stated reason is indistinguishable from a broken one.
          Say which of the two gates is closed; aria-describedby ties it to the button so
          a screen reader reads the reason when focus lands there.
        */}
        {onAnalyzeDeploy && (!canAnalyzeDeploy || !readyForCanvas) && (
          <p id="deploy-blocked-reason" className="text-xs text-gray-600 mt-2 text-center">
            {!canAnalyzeDeploy
              ? 'Add your Gemini API key and Canvas token in Initial Setup to deploy.'
              : 'Tick the box above to confirm the rubric is ready.'}
          </p>
        )}

        {/*
          The CSVs, before anything is sent to Canvas.

          They exist already — or rather, they cost nothing to make: converting a rubric
          object to Canvas CSV is a local string build with no AI call behind it (see
          utils/rubricCsv.ts), so the files offered here are byte-for-byte the ones the
          deploy will push. The deploy panel offered them only on the way out, which is
          the wrong end for the case that needs them most: if Canvas rejects the upload,
          or the token has expired, the work is still recoverable from a CSV you already
          have. Saving one first costs a click and removes that whole class of loss.

          A link rather than a second button: there is one primary action on this screen
          and it is the one above.
        */}
        {onAnalyzeDeploy && state.rubrics.length > 0 && !showDeployCard && (
          <div className="mt-3">
            <CsvSaveOptions
              csvs={csvsForRubrics}
              prompt={
                state.rubrics.length > 1
                  ? `Keep a copy of all ${state.rubrics.length} CSVs?`
                  : 'Keep a copy of the CSV?'
              }
              footnote="These are the same files the deploy sends to Canvas. Saving them here changes nothing about the deploy."
            />
          </div>
        )}

        {/* Inline Canvas Course URL card */}
        {showDeployCard && onAnalyzeDeploy && (
          <div className={`mt-4 bg-white rounded-2xl border-2 p-6 shadow-sm transition-all duration-300 ${
            deployCourseVerified
              ? 'border-green-400 ring-2 ring-green-300 ring-offset-1 shadow-green-100'
              : 'border-gray-200'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <Link className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <h3 className="font-black text-lg text-gray-900">Target Canvas Course</h3>
              {deployCourseVerified && <Check className="w-4 h-4 text-green-600 ml-auto flex-shrink-0" />}
            </div>
            <p className="text-sm text-gray-600 mb-3">Enter the homepage URL of the Canvas course you want to deploy this rubric to.</p>
            <input
              type="url"
              value={deployUrlInput}
              onChange={(e) => {
                deployUrlTouched.current = true;
                setDeployUrlInput(e.target.value);
                setDeployCourseName(null);
              }}
              placeholder="https://canvas.institution.edu/courses/12345"
              aria-invalid={!!((deployUrlInput && !deployUrlValid) || deployNameError)}
              aria-describedby={deployNameError ? 'deploy-course-status' : undefined}
              className={`w-full px-4 py-3 border-2 rounded-xl text-sm focus:outline-none transition-all ${
                (deployUrlInput && !deployUrlValid) || deployNameError
                  ? 'border-red-300 focus:border-red-400'
                  : deployCourseVerified
                  ? 'border-green-400 focus:border-green-500'
                  : 'border-gray-200 focus:border-blue-400'
              }`}
            />
            {deployUrlInput && !deployUrlValid && (
              <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                <X className="w-3 h-3" /> URL must include a /courses/&lt;ID&gt; path
              </p>
            )}
            {/*
              Mounted unconditionally rather than rendered on demand: a live region that
              appears with its text already inside it is announced unreliably. It
              collapses to sr-only when there is nothing to say.
            */}
            <div
              id="deploy-course-status"
              role="status"
              aria-live="polite"
              className={
                deployCourseNameLoading || deployCourseName || deployNameError
                  ? 'mt-3 flex items-center gap-2 min-h-[1.5rem]'
                  : 'sr-only'
              }
            >
              {deployCourseNameLoading ? (
                <>
                  <Loader2 className="w-4 h-4 text-gray-400 animate-spin" aria-hidden="true" />
                  <span className="text-sm text-gray-600">Checking this course…</span>
                </>
              ) : deployCourseName ? (
                <>
                  <Check className="w-4 h-4 text-green-600 flex-shrink-0" aria-hidden="true" />
                  <span className="text-sm font-bold text-green-800">
                    <span className="sr-only">Course found: </span>
                    {deployCourseName}
                  </span>
                </>
              ) : deployNameError ? (
                <span className="text-xs text-red-700">{deployNameError}</span>
              ) : null}
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowDeployCard(false)}
                className="flex-1 py-3 px-4 bg-gray-100 text-gray-700 rounded-2xl font-bold hover:bg-gray-200 transition-all text-sm"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!deployUrlValid) return;
                  // Awaited, and checked. setCourseUrl is an IPC round trip that writes
                  // settings.json, and main will only send the Canvas token to the host
                  // recorded there. Firing this without waiting started the deployment
                  // before the write landed, so every rubric failed with "No Canvas
                  // course is saved yet" while the URL on screen was perfectly correct.
                  const pinned = await setCourseUrl(deployUrlInput.trim());
                  if (!pinned.ok) {
                    setDeployNameError(pinned.message ?? 'Could not use this Canvas course.');
                    return;
                  }
                  handleContinue();
                }}
                disabled={!deployUrlValid}
                className="flex-[2] py-3 px-6 bg-brand text-white rounded-2xl font-black uppercase tracking-widest hover:bg-brand-dark transition-all shadow-lg flex items-center justify-center gap-2 text-sm disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none disabled:cursor-not-allowed"
              >
                <ArrowRight className="w-4 h-4" />
                Deploy Now
              </button>
            </div>
          </div>
        )}
        </div>
      )}

    </div>
  );
};
