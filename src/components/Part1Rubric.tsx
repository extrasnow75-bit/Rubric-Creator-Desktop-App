import React, { useState, useRef } from 'react';
import { useSession } from '../contexts/SessionContext';
import { useDrivePicker } from '../contexts/DrivePickerContext';
import { AppMode, PointStyle, ProcessingType, GenerationSettings, RubricData } from '../types';
import { generateCsvFromRubricObject } from '../utils/rubricCsv';
import { CsvSaveOptions } from './CsvSaveOptions';
import {
  generateRubricFromDescription,
  extractRubricFromDocument,
  applyRubricChanges,
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
import { Loader2, Download, FileText, CheckCircle, ArrowRight, RotateCw, Home, X, Clock, ChevronDown, ChevronUp, Link, Check } from 'lucide-react';
import ErrorDisplay from './ErrorDisplay';
import mammoth from 'mammoth';
import { extractPdfText } from '../utils/pdfText';
import { getRecentDocs, saveRecentDoc, RecentDoc } from '../utils/recentDocs';

interface Part1RubricProps {
  onAnalyzeDeploy?: () => void;
  canAnalyzeDeploy?: boolean;
}

export const Part1Rubric: React.FC<Part1RubricProps> = ({ onAnalyzeDeploy, canAnalyzeDeploy }) => {
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
  } = useSession();
  const { pickFile, pickFolder } = useDrivePicker();

  const [assignmentDescription, setAssignmentDescription] = useState<string>('');
  const [settings, setSettings] = useState<GenerationSettings>({
    totalPoints: 100,
    pointStyle: PointStyle.RANGE,
    processingType: ProcessingType.SINGLE,
  });
  const [isGenerating, setIsGenerating] = useState(false);

  /**
   * The confirmation checklist, or null when there is nothing to confirm.
   *
   * Non-null only between discovery finding separate parts and the user choosing which get a
   * rubric. A description with no separate parts never sets it.
   */
  const [plan, setPlan] = useState<RubricPlanRow[] | null>(null);
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
  const [showReplaceCard, setShowReplaceCard] = useState(false);
  const [replaceFileText, setReplaceFileText] = useState<string | null>(null);
  const [replaceFileName, setReplaceFileName] = useState<string | null>(null);
  const [replaceIsDragging, setReplaceIsDragging] = useState(false);
  const [isProcessingReplacement, setIsProcessingReplacement] = useState(false);

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
  const [changeSettled, setChangeSettled] = useState<Record<number, boolean>>({});
  const [isApplyingChanges, setIsApplyingChanges] = useState(false);

  // Rubric source — controls which success banner to show
  const [rubricSource, setRubricSource] = useState<'generated' | 'uploaded' | 'revised' | null>(null);

  // Inline deploy card
  const [showDeployCard, setShowDeployCard] = useState(false);
  /** Whether the "keep a copy of the CSVs" panel under the deploy button is open. */
  const [showCsvSave, setShowCsvSave] = useState(false);
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
  const handleGenerateRubric = async () => {
    if (!assignmentDescription.trim()) {
      setError('Please enter an assignment description');
      return;
    }

    setSnapshotDescription(assignmentDescription);
    setError(null);
    setIsDiscovering(true);
    startProgress(1, true);
    setProgress({ currentStep: 'Reading the assignment description...' });

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

    const made: RubricData[] = [];
    const failed: string[] = [];

    try {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (signal.aborted) break;

        setProgress({
          currentStep:
            entries.length === 1
              ? 'Generating rubric criteria...'
              : `Writing "${entry.title}" (${i + 1} of ${entries.length})...`,
          percentage: i / entries.length,
          itemsProcessed: i,
        });

        try {
          // `signal` third: without it withCancellation never sends gemini:cancel, so Stop did
          // nothing and the user watched a dead button through the retry back-off.
          const rubric = await generateRubricFromDescription(
            assignmentDescription,
            { ...settings, totalPoints: entry.points },
            signal,
            entry.target,
          );
          made.push(rubric);
        } catch (err: any) {
          if (signal.aborted) break;
          // One rubric failing does not cost the others; it is named at the end instead.
          failed.push(entry.title || 'the rubric');
        }
      }

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
        setRubricSource('generated');
        setProgress({ percentage: 1, itemsProcessed: made.length });
        setShowReplaceCard(false);
        setShowRequestChangesCard(false);
        setReadyForCanvas(false);
        setShowDeployCard(false);
      }

      if (failed.length > 0) {
        setError(
          made.length === 0
            ? `Could not generate ${failed.join(', ')}. Try again, or shorten the description.`
            : `Generated ${made.length} of ${entries.length}. Could not write ${failed.join(', ')}.`,
        );
      } else if (made.length === 0 && !signal.aborted) {
        setError('Nothing was generated. Try again, or shorten the description.');
      }

      setTimeout(() => stopProgress(), 500);
    } finally {
      setIsGenerating(false);
    }
  };

  const [savingToDrive, setSavingToDrive] = useState(false);
  const [savingLocal, setSavingLocal] = useState(false);
  const [driveSaveSuccess, setDriveSaveSuccess] = useState<string | null>(null);

  /**
   * The default: create a Google Doc in Drive and open it.
   *
   * The rubric is rendered as an HTML table and handed to Drive to convert, which preserves the
   * table. The previous version of this flattened the rubric into plain-text lines before
   * uploading, so everything below the words — the grid, the ratings columns, the points — was
   * lost on the way to Drive.
   */
  const handleExportToDrive = async () => {
    if (!state.rubric) return;
    setSavingToDrive(true);
    setDriveSaveSuccess(null);
    try {
      const folder = await pickFolder({ title: 'Where should the rubric go?' });
      if (!folder) return;

      // The whole set, not just the one on screen: a run that produced eight rubrics saves as
      // one document holding all eight. A single-rubric run passes an array of one.
      const result = await window.api.rubric.exportToDrive({
        rubrics: state.rubrics.length > 0 ? state.rubrics : [state.rubric],
        documentTitle: state.rubrics.length > 1 ? describedAssignmentTitle(snapshotDescription) : undefined,
        folderId: folder.folderId,
      });
      if (result.ok) {
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

  const handleReplaceFileUpload = async (file: File) => {
    setError(null);
    try {
      if (!file.name.toLowerCase().match(/\.(docx?|pdf|txt)$/)) {
        setError('Please upload a .docx, .pdf, or .txt file.');
        return;
      }
      const name = file.name.toLowerCase();
      let text = '';
      if (name.endsWith('.docx') || name.endsWith('.doc')) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      } else if (name.endsWith('.pdf')) {
        const arrayBuffer = await file.arrayBuffer();
        text = await extractPdfText(arrayBuffer, file.name);
      } else {
        text = await file.text();
      }
      setReplaceFileText(text);
      setReplaceFileName(file.name);
    } catch (err: any) {
      setError(`Failed to read file: ${err.message}`);
    }
  };

  const handleProcessReplacement = async () => {
    if (!replaceFileText) return;
    setIsProcessingReplacement(true);
    setError(null);
    try {
      const signal = getAbortSignal();
      const parsed = await extractRubricFromDocument(replaceFileText, signal);
      setRubric(parsed);
      setRubricSource('uploaded');
      setShowReplaceCard(false);
      setReplaceFileText(null);
      setReplaceFileName(null);
      setReadyForCanvas(false);
      setShowDeployCard(false);
    } catch (err: any) {
      setError(`Failed to process rubric: ${err.message}`);
    } finally {
      setIsProcessingReplacement(false);
    }
  };

  const activeDraft = changeDrafts[state.activeRubricIndex] ?? '';
  const activeSettled = changeSettled[state.activeRubricIndex] ?? false;

  /**
   * The Canvas CSV for each rubric on screen, built on demand for the save panel.
   *
   * Free to compute: generateCsvFromRubricObject is a pure formatter over data already in
   * memory, so eight rubrics is eight string builds and no requests. Memoised only so the
   * strings keep their identity between renders while the panel is open.
   *
   * `settings.pointStyle` rather than `state.scoringMethod` because these are the rubrics as
   * they stand right now, including one generated as ranges and then regenerated as single
   * values without a deploy in between; the two agree in every case where they can disagree
   * that matters, since generating is what writes `state.scoringMethod`.
   */
  const csvsForRubrics = React.useMemo(
    () =>
      state.rubrics.map((rubric) => ({
        name: rubric.title,
        csvContent: generateCsvFromRubricObject(
          rubric,
          settings.pointStyle === PointStyle.RANGE ? 'ranges' : 'fixed',
        ),
      })),
    [state.rubrics, settings.pointStyle],
  );

  /** Rubrics with a settled, non-empty request — what "Apply changes" will actually run. */
  const queuedIndexes = state.rubrics
    .map((_, i) => i)
    .filter((i) => (changeSettled[i] ?? false) && (changeDrafts[i] ?? '').trim() !== '');

  /**
   * Rubrics with text typed but not ticked.
   *
   * Named rather than silently skipped: writing a request and forgetting to tick it would
   * otherwise mean the run quietly leaves that rubric alone, and the user discovers it by
   * reading a document that did not change.
   */
  const unsettledIndexes = state.rubrics
    .map((_, i) => i)
    .filter((i) => !(changeSettled[i] ?? false) && (changeDrafts[i] ?? '').trim() !== '');

  const setDraft = (index: number, text: string) =>
    setChangeDrafts((prev) => ({ ...prev, [index]: text }));
  const setSettled = (index: number, settled: boolean) =>
    setChangeSettled((prev) => ({ ...prev, [index]: settled }));

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
        setChangeSettled((prev) => {
          const next = { ...prev };
          for (const i of revised) delete next[i];
          return next;
        });
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

  return (
    <div className="flex flex-col items-center justify-center py-8">
      {/* About Phase 1 - Above Main Section */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 max-w-2xl w-full">
        <h3 className="text-sm font-black text-gray-900 mb-1">About Phase 1</h3>
        <p className="text-sm text-gray-700">
          Paste or upload an assignment description, or a screenshot of a rubric you already have.
          The app drafts a rubric you can edit, then opens it as a Google Doc or saves it to this
          computer. Part 2 turns it into a Canvas CSV, and Part 3 sends it to your course.
        </p>
      </div>

      <div className={`bg-white p-10 rounded-3xl shadow-2xl border border-gray-100 w-full transition-all duration-300 ${showComparison && state.rubric ? 'max-w-5xl' : 'max-w-2xl'}`}>
        {!state.rubric ? (
          <>
            <h2 className="text-2xl font-black text-gray-900 mb-2">Create Draft Rubric</h2>
            <p className="text-gray-600 font-medium mb-8">
              Specify the type of rubric you'd like and then paste or upload an assignment description.
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
              />
            ) : (
            <>
            <div className="mb-6 p-5 bg-gray-50 border border-gray-200 rounded-2xl space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="total-points" className="text-sm font-bold text-gray-900 block mb-2">
                    Total points
                  </label>
                  <input
                    id="total-points"
                    type="number"
                    value={settings.totalPoints}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        totalPoints: parseInt(e.target.value) || 100,
                      })
                    }
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
                Drop an assignment description document here or click to browse
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
                aria-label="Drop an assignment description document here or click to browse"
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
              placeholder="Or paste your assignment description here..."
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
                    ? 'Reading the description...'
                    : isGenerating
                      ? 'Generating Rubric...'
                      : 'Analyze Description'}
                </button>
                {assignmentDescription.trim() && (
                  <p className="text-xs text-gray-600 text-center mt-2 italic">
                    The app reads the description first to see how many rubrics it needs. Nothing
                    is written until you confirm.
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
                        <span className="text-green-700 font-black text-sm">✓</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-green-900">Signed in as {state.googleUser?.name}</p>
                        <p className="text-xs text-green-700">{state.googleUser?.email}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => signOutGoogle()}
                      className="text-xs font-bold text-green-700 hover:text-green-900 transition-all"
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

                {/* Generate Button */}
                <button
                  onClick={handleGenerateRubric}
                  disabled={isGenerating || isDiscovering || plan !== null || !assignmentDescription.trim()}
                  className="w-full py-4 bg-brand text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-brand-dark transition-all disabled:bg-gray-300 active:scale-95 mt-6 flex items-center justify-center gap-2"
                >
                  {(isGenerating || isDiscovering) && <Loader2 className="w-5 h-5 animate-spin" />}
                  {isDiscovering
                    ? 'Reading the description...'
                    : isGenerating
                      ? 'Generating Rubric...'
                      : 'Analyze Description'}
                </button>
              </>
            )}
            </>
            )}
          </>
        ) : (
          <>
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
                <RubricSwitcher
                  rubrics={state.rubrics}
                  activeIndex={state.activeRubricIndex}
                  onOpen={openRubric}
                  pending={[...queuedIndexes, ...unsettledIndexes]}
                />
                <h3 className="text-xl font-black text-gray-900 mb-2">
                  {state.rubric.title}
                </h3>
                <p className="text-sm text-gray-600 mb-6">
                  {state.rubric.criteria.length} criteria • {state.rubric.totalPoints} points
                </p>

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
                          <p className="text-sm text-green-700">Your uploaded rubric has been processed and is ready to review.</p>
                        </>
                      ) : rubricSource === 'revised' ? (
                        <>
                          <p className="font-black text-green-900">✓ Draft Rubric Updated!</p>
                          <p className="text-sm text-green-700">Your requested changes have been applied to the rubric.</p>
                          <p className="text-sm text-green-700 mt-1">We recommend reviewing all changes before deploying to Canvas.</p>
                        </>
                      ) : (
                        <>
                          <p className="font-black text-green-900">✓ Draft Rubric Created!</p>
                          <p className="text-sm text-green-700">Your draft rubric has been generated successfully.</p>
                          <p className="text-sm text-green-700 mt-1">We recommend making your own edits to this AI-generated rubric.</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Secondary Actions */}
                <div className="flex gap-3 mb-3">
                  <button
                    onClick={handleExportToDrive}
                    disabled={savingToDrive || !state.isGoogleAuthenticated}
                    title={
                      state.isGoogleAuthenticated
                        ? undefined
                        : 'Sign in to Google under Initial Setup to use this'
                    }
                    className="flex-1 px-4 py-3 bg-brand text-white rounded-xl font-bold hover:bg-brand-dark disabled:bg-gray-300 disabled:text-gray-400 transition-all text-sm flex items-center justify-center gap-2"
                  >
                    {savingToDrive ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 -960 960 960" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path d="M220-100q-17 0-34.5-10.5T160-135L60-310q-8-14-8-34.5t8-34.5l260-446q8-14 25.5-24.5T380-860h200q17 0 34.5 10.5T640-825l182 312q-23-6-47.5-8t-48.5 2L574-780H386L132-344l94 164h316q11 23 25.5 43t33.5 37H220Zm70-180-29-51 183-319h72l101 176q-17 13-31.5 28.5T560-413l-80-139-110 192h164q-7 19-10.5 39t-3.5 41H290Zm430 160v-120H600v-80h120v-120h80v120h120v80H800v120h-80Z"/>
                      </svg>
                    )}
                    {savingToDrive ? 'Creating\u2026' : 'Open in Google Docs'}
                  </button>
                  <button
                    onClick={handleSaveLocal}
                    disabled={savingLocal}
                    className="flex-1 px-4 py-3 bg-gray-100 text-gray-900 rounded-xl font-bold hover:bg-gray-200 disabled:opacity-50 transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    {savingLocal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {savingLocal ? 'Saving\u2026' : 'Save to this computer'}
                  </button>
                  <button
                    onClick={() => { setShowReplaceCard(true); setShowRequestChangesCard(false); }}
                    className="flex-1 px-4 py-3 bg-gray-100 text-gray-900 rounded-xl font-bold hover:bg-gray-200 transition-all text-sm flex items-center justify-center gap-2"
                  >
                    <RotateCw className="w-4 h-4" />
                    Upload Replacement Rubric to App
                  </button>
                  <button
                    onClick={() => { setShowRequestChangesCard(true); setShowReplaceCard(false); }}
                    className="flex-1 px-4 py-3 bg-gray-100 text-gray-900 rounded-xl font-bold hover:bg-gray-200 transition-all text-sm flex items-center justify-center gap-2"
                  >
                    <RotateCw className="w-4 h-4" />
                    Request Changes
                  </button>
                </div>

                {driveSaveSuccess && (
                  <p className="text-xs text-green-700 font-bold text-center mb-3">✓ {driveSaveSuccess}</p>
                )}
                {!state.isGoogleAuthenticated && (
                  <p className="text-xs text-gray-600 text-center mb-3">Sign in with Google on the Dashboard to enable Add to Drive.</p>
                )}

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
                    <div className="flex items-start justify-between gap-4 mb-1">
                      {/* The heading names the rubric because the card is identical for all of
                          them, and the only other thing saying which one you are editing is the
                          switcher further up the page. */}
                      <h3 className="text-base font-black text-gray-900">
                        Request Changes — {state.rubric.title}
                      </h3>
                      <button
                        onClick={() => setShowRequestChangesCard(false)}
                        aria-label="Close request changes"
                        className="text-gray-600 hover:text-gray-900 transition-colors flex-shrink-0"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
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

                    <label className="flex items-start gap-3 mt-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={activeSettled}
                        disabled={activeDraft.trim() === ''}
                        onChange={(e) => setSettled(state.activeRubricIndex, e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-brand flex-shrink-0 disabled:opacity-40"
                      />
                      <span className="text-sm text-gray-700">
                        These are the changes I want for <strong>{state.rubric.title}</strong>.
                      </span>
                    </label>
                  </div>
                )}

                {/*
                  The run button sits outside the card on purpose. Inside a card headed with one
                  rubric's name it would read as "apply to this rubric", and it applies to every
                  one that has been ticked — the same confusion of scope the shared text box used
                  to cause. So it names its own count instead.
                */}
                {showRequestChangesCard && queuedIndexes.length > 0 && (
                  <button
                    onClick={handleApplyChanges}
                    disabled={isApplyingChanges}
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

                {/* Only alongside the run button. With nothing queued there is no run for these
                    to be left out of, and "will be left alone" would read as an error when the
                    user has simply not finished typing yet. */}
                {showRequestChangesCard &&
                  queuedIndexes.length > 0 &&
                  unsettledIndexes.length > 0 &&
                  !isApplyingChanges && (
                  <p className="text-xs text-amber-700 mb-3">
                    {unsettledIndexes.length === 1 ? 'One rubric has' : `${unsettledIndexes.length} rubrics have`}{' '}
                    changes typed but not ticked, and will be left alone:{' '}
                    {unsettledIndexes.map((i) => state.rubrics[i]?.title).filter(Boolean).join(', ')}.
                  </p>
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
                    {!showCsvSave ? (
                      <button
                        onClick={() => setShowCsvSave(true)}
                        className="mx-auto block text-sm font-bold text-brand hover:text-brand-dark underline underline-offset-2"
                      >
                        Save CSV files
                      </button>
                    ) : (
                      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
                        <CsvSaveOptions
                          csvs={csvsForRubrics}
                          prompt={
                            state.rubrics.length > 1
                              ? `Keep a copy of all ${state.rubrics.length} CSVs?`
                              : 'Keep a copy of the CSV?'
                          }
                          onDismiss={() => setShowCsvSave(false)}
                        />
                        <p className="text-xs text-gray-600 mt-3">
                          These are the same files the deploy sends to Canvas. Saving them here
                          changes nothing about the deploy.
                        </p>
                      </div>
                    )}
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
                          <span className="text-sm font-bold text-green-700">
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
            </div>
          </>
        )}
      </div>

      {/* Upload Replacement Rubric card — appears below main card */}
      {showReplaceCard && state.rubric && (
        <div className="bg-white p-8 rounded-3xl shadow-2xl border border-gray-100 w-full max-w-2xl mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xl font-black text-gray-900">Upload Replacement Rubric</h3>
            <button
              onClick={() => { setShowReplaceCard(false); setReplaceFileText(null); setReplaceFileName(null); setError(null); }}
              aria-label="Close upload replacement rubric"
              className="text-gray-600 hover:text-gray-900 transition-colors flex-shrink-0 ml-4"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <p className="text-sm text-gray-600 mb-6">
            Upload your modified draft rubric document (.docx, .pdf, or .txt) to replace the one currently displayed.
          </p>

          {/* File drop area */}
          <div
            onDragOver={(e) => { e.preventDefault(); setReplaceIsDragging(true); }}
            onDragLeave={() => setReplaceIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setReplaceIsDragging(false);
              if (e.dataTransfer.files[0]) handleReplaceFileUpload(e.dataTransfer.files[0]);
            }}
            className={`relative w-full p-6 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-all mb-4 ${replaceIsDragging ? 'bg-blue-50 border-blue-400' : 'bg-gray-50 border-gray-200 hover:border-blue-300'}`}
          >
            <FileText className="w-7 h-7 text-gray-600" />
            <p className="text-sm font-bold text-gray-800">Drop your modified rubric file here or click to browse</p>
            <p className="text-xs text-gray-600">Supports .docx, .pdf, and .txt</p>
            <input
              type="file"
              accept=".docx,.doc,.pdf,.txt"
              onChange={(e) => { if (e.target.files?.[0]) handleReplaceFileUpload(e.target.files[0]); }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              id="replace-file-input"
              aria-label="Drop your modified rubric file here or click to browse"
            />
          </div>

          {/* Selected file chip */}
          {replaceFileName && (
            <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl">
              <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <span className="text-sm font-bold text-blue-800 truncate flex-1">{replaceFileName}</span>
              <button
                onClick={() => { setReplaceFileName(null); setReplaceFileText(null); }}
                aria-label="Remove replacement file"
                className="text-blue-600 hover:text-blue-800 flex-shrink-0 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {state.error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl mb-4">
              <p className="text-sm text-red-700 font-bold">{state.error}</p>
            </div>
          )}

          <button
            onClick={handleProcessReplacement}
            disabled={isProcessingReplacement || !replaceFileText}
            className="w-full py-4 bg-brand text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-brand-dark transition-all disabled:bg-gray-300 active:scale-95 flex items-center justify-center gap-2"
          >
            {isProcessingReplacement && <Loader2 className="w-5 h-5 animate-spin" />}
            {isProcessingReplacement ? 'Processing Rubric...' : 'Use This Rubric'}
          </button>
        </div>
      )}
    </div>
  );
};
