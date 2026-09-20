import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { bytesToBase64 } from '../utils/driveFile';
import { useDrivePicker } from '../contexts/DrivePickerContext';
import { AppMode, PointStyle, ProcessingType, GenerationSettings } from '../types';
import { generateRubricFromScreenshot, applyRubricChanges, extractRubricFromDocument } from '../services/geminiService';
import mammoth from 'mammoth';
import { pdfjsLib } from '../utils/pdfWorker';
import { Upload, Download, Loader2, Trash2, Image as ImageIcon, HardDrive, FolderOpen, Clipboard, Clock, ChevronDown, ChevronUp, X, RotateCw, CheckCircle, FileText } from 'lucide-react';
import ErrorDisplay from './ErrorDisplay';
import { getRecentImages, saveRecentImage, RecentImage } from '../utils/recentImages';

interface ScreenshotConverterProps {
  /**
   * Hand the finished rubric to the real deploy pipeline.
   *
   * This screen used to run its own "deployment": a chain of setTimeout calls that logged
   * progress lines and finished with "Rubric deployed successfully" without ever contacting
   * Canvas. Canvas does not accept rubric documents — only CSV in its own column layout — so the
   * conversion Part 2 performs is not a step that can be skipped, which is presumably why it was
   * left as a mockup.
   *
   * Passing the work to AnalyzeDeploySection, exactly as Part 1 does, gets the shortcut that
   * button promised using the pipeline that actually works.
   */
  onAnalyzeDeploy?: () => void;
  /** False when the Gemini key or Canvas token is missing; conversion needs both. */
  canAnalyzeDeploy?: boolean;
}

export const ScreenshotConverter: React.FC<ScreenshotConverterProps> = ({
  onAnalyzeDeploy,
  canAnalyzeDeploy,
}) => {
  const {
    state,
    setRubric,
    setCourseUrl,
    setIsLoading,
    setError,
    startProgress,
    stopProgress,
    setProgress,
    getAbortSignal,
    downloadDriveFile,
    startGoogleAuth,
    signOutGoogle,
  } = useSession();
  const { pickFile, pickFolder } = useDrivePicker();

  const googleSignedIn = state.isGoogleAuthenticated;

  const [activeTab, setActiveTab] = useState<'local' | 'google-drive'>('local');
  const [imageFile, setImageFile] = useState<{ data: string; mimeType: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isPasteFocused, setIsPasteFocused] = useState(false);
  const [settings] = useState<GenerationSettings>({
    totalPoints: 100,
    pointStyle: PointStyle.RANGE,
    processingType: ProcessingType.SINGLE,
  });

  // Google Drive tab state
  const [driveImageUrl, setDriveImageUrl] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [isPickerLoading, setIsPickerLoading] = useState(false);
  const [recentImages, setRecentImages] = useState<RecentImage[]>(() => getRecentImages());
  const [showRecentImages, setShowRecentImages] = useState(false);

  // Upload to Canvas state
  const [showUploadSection, setShowUploadSection] = useState(false);
  const [uploadDocTab, setUploadDocTab] = useState<'phase1' | 'local' | 'google-drive'>('phase1');
  const [canvasUrl, setCanvasUrl] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  // Request Changes
  const [showRequestChangesCard, setShowRequestChangesCard] = useState(false);
  const [requestChangesText, setRequestChangesText] = useState('');
  const [isApplyingChanges, setIsApplyingChanges] = useState(false);

  // Upload Replacement Rubric
  const [showReplaceCard, setShowReplaceCard] = useState(false);
  const [replaceFileText, setReplaceFileText] = useState<string | null>(null);
  const [replaceFileName, setReplaceFileName] = useState<string | null>(null);
  const [replaceIsDragging, setReplaceIsDragging] = useState(false);
  const [isProcessingReplacement, setIsProcessingReplacement] = useState(false);

  // Rubric source — controls which success banner to show
  const [rubricSource, setRubricSource] = useState<'generated' | 'uploaded' | 'revised' | null>(null);

  // Drive save
  const [savingToDrive, setSavingToDrive] = useState(false);
  const [driveSaveSuccess, setDriveSaveSuccess] = useState<string | null>(null);

  // Ready for Canvas checkbox
  const [readyForCanvas, setReadyForCanvas] = useState(false);

  const pasteAreaRef = useRef<HTMLDivElement>(null);

  // ── Deployment timer ───────────────────────────────────────────────────────────


  // ── Image handler ──────────────────────────────────────────────────────────

  const handleImageSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG, JPG, or WebP).');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const imageData = event.target?.result as string;
        setImageFile({ data: imageData.split(',')[1], mimeType: file.type });
        setImagePreview(imageData);
        setIsLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setError(`Failed to process image: ${err.message}`);
      setIsLoading(false);
    }
  }, [setIsLoading, setError]);

  // ── Drag & drop ────────────────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleImageSelect(e.dataTransfer.files[0]);
  };

  // ── Clipboard paste (global + paste area) ─────────────────────────────────

  const extractImageFromClipboard = useCallback((clipboardData: DataTransfer | null) => {
    if (!clipboardData) return;
    const items = Array.from(clipboardData.items);
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) handleImageSelect(file);
        return;
      }
    }
  }, [handleImageSelect]);

  const imagePreviewRef = useRef(imagePreview);
  imagePreviewRef.current = imagePreview;

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (imagePreviewRef.current) return;
      extractImageFromClipboard(e.clipboardData as unknown as DataTransfer);
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [extractImageFromClipboard]);

  const handlePasteAreaPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    extractImageFromClipboard(e.clipboardData);
  };

  // ── Shared helper: load image from Drive buffer ────────────────────────────

  const loadImageFromBuffer = (buffer: ArrayBuffer, mimeType: string) => {
    // One-character-at-a-time string concatenation built a multi-megabyte string for every
    // screenshot; bytesToBase64 does the same job in 32KB chunks.
    const base64 = bytesToBase64(new Uint8Array(buffer));
    const dataUrl = `data:${mimeType};base64,${base64}`;
    setImageFile({ data: base64, mimeType });
    setImagePreview(dataUrl);
  };

  // ── Google Drive picker ────────────────────────────────────────────────────

  const handleGooglePickerImage = async () => {
    setIsPickerLoading(true);
    setError(null);
    try {
      const result = await pickFile();
      if (!result) return;
      if (!result.mimeType.startsWith('image/')) {
        setError('Please select an image file (PNG, JPG, or WebP).');
        return;
      }
      const buffer = await downloadDriveFile(result.fileId);
      loadImageFromBuffer(buffer, result.mimeType);
      saveRecentImage({ name: result.name, fileId: result.fileId, mimeType: result.mimeType, source: 'picker' });
      setRecentImages(getRecentImages());
    } catch (err: any) {
      setError(`Google Drive error: ${err.message}`);
    } finally {
      setIsPickerLoading(false);
    }
  };

  // ── Google Drive URL fetch ─────────────────────────────────────────────────

  const handleFetchDriveUrl = async () => {
    if (!state.isGoogleAuthenticated) { setError('Please sign in with Google first.'); return; }
    if (!driveImageUrl.trim()) { setError('Please enter a Google Drive URL.'); return; }
    setIsFetchingUrl(true);
    setError(null);
    try {
      const urlToSave = driveImageUrl.trim();
      const resolved = await window.api.drive.resolveUrl(urlToSave);
      if (!resolved.ok) throw new Error(resolved.message);
      const fileId = resolved.fileId;
      const meta = { name: resolved.name, mimeType: resolved.mimeType };
      if (!meta.mimeType.startsWith('image/')) {
        setError(`"${meta.name}" is not an image file. Please provide a link to a PNG, JPG, or WebP image.`);
        return;
      }
      const buffer = await downloadDriveFile(fileId);
      loadImageFromBuffer(buffer, meta.mimeType);
      saveRecentImage({ name: meta.name, url: urlToSave, fileId, mimeType: meta.mimeType, source: 'url' });
      setRecentImages(getRecentImages());
      setDriveImageUrl('');
    } catch (err: any) {
      setError(`Failed to fetch from Google Drive: ${err.message}`);
    } finally {
      setIsFetchingUrl(false);
    }
  };

  // ── Recent image click ─────────────────────────────────────────────────────

  const handleRecentImageClick = async (img: RecentImage) => {
    setShowRecentImages(false);
    if (!state.isGoogleAuthenticated) { setError('Please sign in with Google first.'); return; }
    setIsPickerLoading(true);
    setError(null);
    try {
      let fileId = img.fileId ?? null;
      if (!fileId && img.url) {
        const resolved = await window.api.drive.resolveUrl(img.url);
        if (!resolved.ok) { setError(resolved.message); return; }
        fileId = resolved.fileId;
      }
      if (!fileId) { setError('Could not work out which Drive file this was.'); return; }
      const buffer = await downloadDriveFile(fileId);
      const mimeType = img.mimeType || 'image/png';
      loadImageFromBuffer(buffer, mimeType);
    } catch (err: any) {
      setError(`Failed to re-load image: ${err.message}`);
    } finally {
      setIsPickerLoading(false);
    }
  };

  // ── Process image ──────────────────────────────────────────────────────────

  const handleProcessImage = async () => {
    if (!imageFile) { setError('Please select an image'); return; }
    setIsProcessing(true);
    setError(null);
    startProgress(1, true);
    setProgress({ currentStep: 'Analyzing screenshot...' });
    try {
      const signal = getAbortSignal();
      setProgress({ currentStep: 'Detecting rubric content...', percentage: 0.3 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (signal.aborted) { setError('Screenshot processing cancelled'); return; }
      setProgress({ currentStep: 'Extracting rubric data...', percentage: 0.6 });
      // See Part1Rubric: the signal has to be passed or Stop is decorative.
      const rubric = await generateRubricFromScreenshot(imageFile, settings, signal);
      if (signal.aborted) { setError('Screenshot processing cancelled'); return; }
      setProgress({ currentStep: 'Finalizing rubric...', percentage: 0.9 });
      setRubric(rubric);
      setRubricSource('generated');
      setProgress({ percentage: 1, itemsProcessed: 1 });
    } catch (err: any) {
      if (!getAbortSignal().aborted) setError(`Failed to process screenshot: ${err.message}`);
    } finally {
      setIsProcessing(false);
      stopProgress();
    }
  };

  /** Create a Google Doc in Drive and open it. Needs a Google sign-in. */
  const handleExportToDrive = async () => {
    if (!state.rubric) return;
    try {
      const folder = await pickFolder({ title: 'Where should the rubric go?' });
      if (!folder) return;
      const result = await window.api.rubric.exportToDrive({
        rubrics: [state.rubric],
        folderId: folder.folderId,
      });
      if (!result.ok) setError(result.message ?? 'Could not create the Google Doc.');
    } catch (err) {
      setError(`Failed to export: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** Save the same rubric to this computer. Works with no Google account. */
  const handleSaveLocal = async () => {
    if (!state.rubric) return;
    const result = await window.api.rubric.saveHtml({ rubrics: [state.rubric] });
    if (!result.ok && !result.cancelled) setError(result.message ?? 'Could not save the file.');
  };

  const handleReset = () => {
    setImageFile(null);
    setImagePreview(null);
    setRubric(null);
    setError(null);
    setRubricSource(null);
    setShowReplaceCard(false);
    setShowRequestChangesCard(false);
    setReadyForCanvas(false);
    setDriveSaveSuccess(null);
    setShowUploadSection(false);
  };

  // ── Deploy to Canvas ───────────────────────────────────────────────────────────

  /**
   * Record the course, then hand off to the real deploy pipeline.
   *
   * setCourseUrl is awaited because it is an IPC round trip that writes settings.json, and main
   * sends the Canvas token only to the host recorded there. Starting the deploy without waiting
   * is what made Part 1 fail with "No Canvas course is saved yet" while showing a correct URL.
   */
  const handleDeployToCanvas = async () => {
    if (!canvasUrl.trim() || !onAnalyzeDeploy) return;
    setIsDeploying(true);
    setDeployError(null);
    try {
      const pinned = await setCourseUrl(canvasUrl.trim());
      if (!pinned.ok) {
        setDeployError(pinned.message ?? 'Could not use this Canvas course.');
        return;
      }
      onAnalyzeDeploy();
    } finally {
      setIsDeploying(false);
    }
  };

  // ── Save to Google Drive ───────────────────────────────────────────────────

  const handleSaveToDrive = async () => {
    if (!state.rubric || !state.isGoogleAuthenticated) return;
    setSavingToDrive(true);
    setDriveSaveSuccess(null);
    try {
      const folder = await pickFolder();
      if (!folder) { setSavingToDrive(false); return; }
      const rubric = state.rubric;
      const lines: string[] = [
        rubric.title,
        '',
        ...rubric.criteria.flatMap(c => [
          `${c.category}`,
          c.description ? `  ${c.description}` : '',
          `  Exemplary (${c.exemplary.points} pts): ${c.exemplary.text}`,
          `  Proficient (${c.proficient.points} pts): ${c.proficient.text}`,
          `  Developing (${c.developing.points} pts): ${c.developing.text}`,
          `  Unsatisfactory (${c.unsatisfactory.points} pts): ${c.unsatisfactory.text}`,
          '',
        ]),
        `Total Points: ${rubric.totalPoints}`,
      ];
      await window.api.drive.upload({
        content: lines.join('\n'),
        name: rubric.title,
        sourceMimeType: 'text/plain',
        targetMimeType: 'application/vnd.google-apps.document',
        folderId: folder.folderId,
      });
      setDriveSaveSuccess(`Saved to "${folder.folderName}"`);
    } catch (err: any) {
      setError(`Google Drive save failed: ${err.message}`);
    } finally {
      setSavingToDrive(false);
    }
  };

  // ── Upload Replacement Rubric ──────────────────────────────────────────────

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
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          pages.push(content.items.map((item: any) => item.str).join(' '));
        }
        text = pages.join('\n\n');
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
      setShowUploadSection(false);
    } catch (err: any) {
      setError(`Failed to process rubric: ${err.message}`);
    } finally {
      setIsProcessingReplacement(false);
    }
  };

  // ── Request Changes ────────────────────────────────────────────────────────

  const handleApplyChanges = async () => {
    if (!state.rubric || !requestChangesText.trim()) return;
    setIsApplyingChanges(true);
    setError(null);
    try {
      const signal = getAbortSignal();
      const updated = await applyRubricChanges(state.rubric, requestChangesText, signal);
      setRubric(updated);
      setRubricSource('revised');
      setShowRequestChangesCard(false);
      setRequestChangesText('');
      setReadyForCanvas(false);
      setShowUploadSection(false);
    } catch (err: any) {
      setError(`Failed to apply changes: ${err.message}`);
    } finally {
      setIsApplyingChanges(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className="bg-white p-10 rounded-3xl shadow-2xl border border-gray-100 max-w-2xl w-full">

        {!state.rubric ? (
          <>
            {/* Title */}
            <h2 className="text-2xl font-black text-gray-900 mb-4">
              Screenshot to Word/Google Doc
            </h2>

            {/* Instructions */}
            <p className="text-sm font-black text-gray-900 uppercase tracking-wide mb-2">
              Instructions
            </p>
            <ol className="space-y-2 mb-6 text-sm text-gray-700">
              <li className="flex gap-2">
                <span className="font-black text-gray-900 flex-shrink-0">1.</span>
                <span>
                  Take a screenshot of the <span className="font-bold text-gray-900">full rubric</span>.
                  You may need to zoom out first so the entire rubric is visible on screen — press{' '}
                  <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs font-mono">Ctrl</kbd>
                  {' + '}
                  <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs font-mono">−</kbd>
                  {' '}on Windows, or{' '}
                  <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs font-mono">⌘</kbd>
                  {' + '}
                  <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs font-mono">−</kbd>
                  {' '}on Mac.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-black text-gray-900 flex-shrink-0">2.</span>
                <span>Upload the screenshot using one of the options below.</span>
              </li>
            </ol>

            {!imagePreview ? (
              <>
                {/* Tabs */}
                <div className="flex gap-3 mb-6 border-b border-gray-200">
                  <button
                    onClick={() => { setActiveTab('local'); setError(null); }}
                    className={`px-4 py-3 font-bold border-b-2 transition-all ${
                      activeTab === 'local'
                        ? 'border-brand text-brand'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    From Local Drive
                  </button>
                  <button
                    onClick={() => { setActiveTab('google-drive'); setError(null); }}
                    className={`px-4 py-3 font-bold border-b-2 transition-all ${
                      activeTab === 'google-drive'
                        ? 'border-brand text-brand'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    From Google Drive
                  </button>
                </div>

                {activeTab === 'local' ? (
                  <>
                    {/* Drag & drop zone */}
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
                      <ImageIcon className="w-8 h-8 text-gray-700" />
                      <p className="text-sm font-bold text-gray-700">
                        Drag & drop a screenshot here, or click to browse
                      </p>
                      <p className="text-xs text-gray-600 font-semibold">PNG, JPG, WebP supported</p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => { if (e.target.files?.[0]) handleImageSelect(e.target.files[0]); e.target.value = ''; }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        aria-label="Drag and drop a screenshot here, or click to browse"
                      />
                    </div>

                    {/* Divider */}
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-gray-200" />
                      <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">or</span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>

                    {/* Paste from clipboard */}
                    <div
                      ref={pasteAreaRef}
                      tabIndex={0}
                      onFocus={() => setIsPasteFocused(true)}
                      onBlur={() => setIsPasteFocused(false)}
                      onPaste={handlePasteAreaPaste}
                      className={`w-full p-5 border-2 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-text transition-all outline-none ${
                        isPasteFocused
                          ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-200 ring-offset-1'
                          : 'border-gray-200 bg-gray-50 hover:border-blue-300'
                      }`}
                      onClick={() => pasteAreaRef.current?.focus()}
                    >
                      <Clipboard className={`w-5 h-5 transition-colors ${isPasteFocused ? 'text-blue-700' : 'text-gray-700'}`} />
                      <p className={`text-sm font-bold transition-colors ${isPasteFocused ? 'text-blue-700' : 'text-gray-700'}`}>
                        {isPasteFocused ? 'Ready — press Ctrl+V (or ⌘+V) to paste' : 'Click here to paste from clipboard'}
                      </p>
                      <p className="text-xs text-gray-700">
                        You can also paste anywhere on this page after copying a screenshot
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Google sign-in status */}
                    {googleSignedIn ? (
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
                        <p className="text-sm font-bold text-gray-700 mb-1">Google sign-in required</p>
                        <p className="text-xs text-gray-600 mb-3">Sign in to access images directly from your Drive.</p>
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
                      onClick={handleGooglePickerImage}
                      disabled={isPickerLoading || !googleSignedIn}
                      className="w-full py-3 px-4 bg-brand text-white rounded-xl font-bold hover:bg-brand-dark disabled:bg-gray-300 disabled:text-gray-400 transition-all text-sm flex items-center justify-center gap-2 mb-6"
                    >
                      {isPickerLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FolderOpen className="w-4 h-4" />
                      )}
                      {isPickerLoading ? 'Opening Drive...' : 'Browse Google Drive'}
                    </button>

                    {/* Recent Images */}
                    {recentImages.length > 0 && (
                      <div className="mb-6">
                        <button
                          onClick={() => setShowRecentImages(!showRecentImages)}
                          className="flex items-center gap-2 text-sm font-bold text-gray-700 hover:text-gray-900 transition-colors mb-2"
                        >
                          <Clock className="w-4 h-4" />
                          Recent Images
                          {showRecentImages ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {showRecentImages && (
                          <div className="border border-gray-200 rounded-xl overflow-hidden">
                            {recentImages.map((img, i) => (
                              <button
                                key={i}
                                onClick={() => handleRecentImageClick(img)}
                                disabled={isPickerLoading || !googleSignedIn}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-all text-left border-b border-gray-100 last:border-0 disabled:opacity-50"
                              >
                                <ImageIcon className="w-4 h-4 text-gray-600 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-gray-900 truncate">{img.name}</p>
                                  <p className="text-xs text-gray-600">
                                    {img.source === 'picker' ? 'Drive Picker' : 'URL'} · {new Date(img.timestamp).toLocaleDateString()}
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

                    {/* Google Drive URL input */}
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">
                        Google Drive URL
                      </label>
                      <input
                        type="url"
                        value={driveImageUrl}
                        onChange={(e) => setDriveImageUrl(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleFetchDriveUrl(); }}
                        placeholder="drive.google.com/file/d/… or drive.google.com/open?id=…"
                        className="w-full px-4 py-3 border rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none mb-3"
                      />
                      <p className="text-xs text-gray-600 mb-4">
                        Supports PNG, JPG, and WebP image files stored in Drive. The file must be accessible to your signed-in account.
                      </p>
                      <button
                        onClick={handleFetchDriveUrl}
                        disabled={!driveImageUrl.trim() || isFetchingUrl || !googleSignedIn}
                        className="w-full py-3 px-4 bg-blue-100 text-blue-700 rounded-xl font-bold hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 transition-all text-sm"
                      >
                        {isFetchingUrl ? 'Fetching...' : 'Fetch Image'}
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                {/* Image Preview */}
                <div className="mb-6">
                  <p className="text-sm font-bold text-gray-700 mb-2">Preview</p>
                  <div className="border rounded-2xl overflow-hidden">
                    <img
                      src={imagePreview}
                      alt="Screenshot preview"
                      className="w-full max-h-64 object-contain"
                    />
                  </div>
                </div>

                {/* Process Button */}
                <button
                  onClick={handleProcessImage}
                  disabled={isProcessing}
                  className="w-full py-4 bg-brand text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-brand-dark transition-all disabled:bg-gray-300 active:scale-95 flex items-center justify-center gap-2 mb-3"
                >
                  {isProcessing && <Loader2 className="w-5 h-5 animate-spin" />}
                  {isProcessing ? 'Processing...' : 'Convert to Rubric'}
                </button>

                {/* Change Image */}
                <button
                  onClick={() => { setImageFile(null); setImagePreview(null); }}
                  className="w-full py-2 text-gray-700 rounded-xl font-bold hover:bg-gray-100 transition-all"
                >
                  Choose Different Image
                </button>
              </>
            )}

            {state.error && <ErrorDisplay error={state.error} className="mt-6" />}
          </>
        ) : (
          <>
            {/* Results */}
            <div>
              <h3 className="text-xl font-black text-gray-900 mb-2">{state.rubric.title}</h3>
              <p className="text-sm text-gray-600 mb-6">
                {state.rubric.criteria.length} criteria • {state.rubric.totalPoints} points
              </p>

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

              {/* Success Banner */}
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
                  className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <Download className="w-4 h-4" />
                  Open in Google Docs
                </button>
                <button
                  onClick={handleSaveToDrive}
                  disabled={savingToDrive || !state.isGoogleAuthenticated}
                  className="flex-1 px-4 py-3 bg-gray-100 text-gray-900 rounded-xl font-bold hover:bg-gray-200 disabled:opacity-50 transition-all text-sm flex items-center justify-center gap-2"
                >
                  {savingToDrive ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 -960 960 960" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                      <path d="M220-100q-17 0-34.5-10.5T160-135L60-310q-8-14-8-34.5t8-34.5l260-446q8-14 25.5-24.5T380-860h200q17 0 34.5 10.5T640-825l182 312q-23-6-47.5-8t-48.5 2L574-780H386L132-344l94 164h316q11 23 25.5 43t33.5 37H220Zm70-180-29-51 183-319h72l101 176q-17 13-31.5 28.5T560-413l-80-139-110 192h164q-7 19-10.5 39t-3.5 41H290Zm430 160v-120H600v-80h120v-120h80v120h120v80H800v120h-80Z"/>
                    </svg>
                  )}
                  {savingToDrive ? 'Adding…' : 'Add to Drive'}
                </button>
                <button
                  onClick={() => { setShowReplaceCard(true); setShowRequestChangesCard(false); }}
                  className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all text-sm flex items-center justify-center gap-2"
                >
                  <RotateCw className="w-4 h-4" />
                  Upload Replacement Rubric
                </button>
                <button
                  onClick={() => { setShowRequestChangesCard(true); setShowReplaceCard(false); }}
                  className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all text-sm flex items-center justify-center gap-2"
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

              {/* Ready confirmation checkbox */}
              <label className="flex items-start gap-3 mb-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={readyForCanvas}
                  onChange={(e) => {
                    setReadyForCanvas(e.target.checked);
                    if (!e.target.checked) setShowUploadSection(false);
                  }}
                  className="mt-0.5 w-4 h-4 accent-green-600 flex-shrink-0"
                />
                <span className="text-sm text-gray-700">
                  No further revision is needed. The rubric currently displayed above is ready for Canvas.
                </span>
              </label>

              {/* Deploy Action — bottom */}
              <button
                onClick={() => setShowUploadSection(!showUploadSection)}
                disabled={!readyForCanvas}
                className={`w-full py-4 bg-brand text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-brand-dark transition-all active:scale-95 flex items-center justify-center gap-2 disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none disabled:cursor-not-allowed ${showUploadSection ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <Upload className="w-5 h-5" />
                Deploy Displayed Rubric to Canvas
              </button>
            </div>

            {/* Upload to Canvas Section */}
            {showUploadSection && (
              <div className="mt-6 space-y-6">
                {/* Draft Rubric Document Section */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-gray-900">Draft Rubric Document</h3>
                      <p className="text-sm text-gray-600">Do you already have a draft rubric document ready to deploy?</p>
                    </div>
                  </div>

                  <select className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-900 mb-6">
                    <option>Yes - I have a draft rubric document</option>
                    <option>No - Create a new rubric</option>
                  </select>

                  {/* File Upload Tabs */}
                  <div className="flex gap-3 mb-4 border-b border-gray-200 pb-3">
                    {state.rubric && (
                      <button
                        onClick={() => setUploadDocTab('phase1')}
                        className={`px-4 py-2 font-bold transition-all ${
                          uploadDocTab === 'phase1'
                            ? 'border-b-2 border-brand text-brand'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        From Phase 1
                      </button>
                    )}
                    <button
                      onClick={() => setUploadDocTab('local')}
                      className={`px-4 py-2 font-bold transition-all ${
                        uploadDocTab === 'local'
                          ? 'border-b-2 border-brand text-brand'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      From Local Drive
                    </button>
                    <button
                      onClick={() => setUploadDocTab('google-drive')}
                      className={`px-4 py-2 font-bold transition-all ${
                        uploadDocTab === 'google-drive'
                          ? 'border-b-2 border-brand text-brand'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      From Google Drive
                    </button>
                  </div>

                  {/* From Phase 1 Tab */}
                  {uploadDocTab === 'phase1' && state.rubric && (
                    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 mb-6">
                      <div className="flex items-start gap-3 mb-4">
                        <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <div className="flex-1">
                          <p className="font-bold text-blue-900">{state.rubric.title}</p>
                          <p className="text-sm text-blue-700">{state.rubric.criteria.length} criteria • {state.rubric.totalPoints} points</p>
                        </div>
                      </div>
                      <p className="text-sm text-blue-700">This rubric from Phase 1 is ready to deploy. No file upload needed — just enter your Canvas course URL below.</p>
                    </div>
                  )}

                  {/* From Local Drive Tab */}
                  {uploadDocTab === 'local' && (
                    <div className="border-2 border-dashed border-gray-300 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 bg-gray-50 cursor-pointer hover:border-blue-400 transition-all">
                      <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-sm font-bold text-gray-700">Drop a .docx or .doc file here or click to browse</p>
                    </div>
                  )}

                  {/* From Google Drive Tab */}
                  {uploadDocTab === 'google-drive' && (
                    <div className="border-2 border-dashed border-gray-300 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 bg-gray-50 cursor-pointer hover:border-blue-400 transition-all">
                      <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      <p className="text-sm font-bold text-gray-700">Drop a .docx or .doc file from Google Drive here or click to browse</p>
                    </div>
                  )}
                </div>

                {/* Target Canvas Course Section */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200">
                  <div className="flex items-start gap-3 mb-4">
                    <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5.951-1.429 5.951 1.429a1 1 0 001.169-1.409l-7-14z" />
                    </svg>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">Target Canvas Course</h3>
                      <p className="text-sm text-gray-600">Enter the homepage URL of the Canvas course you want to deploy rubrics to.</p>
                    </div>
                  </div>

                  <input
                    type="url"
                    value={canvasUrl}
                    onChange={(e) => setCanvasUrl(e.target.value)}
                    placeholder="https://canvas.institution.edu/courses/12345"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none mb-6"
                  />

                  <button
                    onClick={handleDeployToCanvas}
                    disabled={!canvasUrl.trim() || isDeploying || !canAnalyzeDeploy}
                    aria-describedby="screenshot-deploy-hint"
                    className="w-full px-4 py-3 rounded-xl font-bold transition-all bg-brand text-white hover:bg-brand-dark disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed"
                  >
                    {isDeploying ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        Starting…
                      </span>
                    ) : (
                      'Analyze Draft Rubric(s) and Deploy to Canvas'
                    )}
                  </button>

                  {/* Say which gate is closed — a disabled button with no reason reads as broken. */}
                  <p id="screenshot-deploy-hint" className="text-xs text-gray-600 text-center mt-2">
                    {!canAnalyzeDeploy
                      ? 'Add your Gemini API key and Canvas token in Initial Setup to deploy.'
                      : 'Button becomes active when the Canvas course URL has been entered.'}
                  </p>

                  <div role="status" aria-live="polite" className={deployError ? 'mt-2' : 'sr-only'}>
                    {deployError && (
                      <p className="text-xs text-red-700 text-center">{deployError}</p>
                    )}
                  </div>
                </div>

              </div>
            )}
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
              className="text-gray-600 hover:text-gray-700 transition-colors flex-shrink-0 ml-4"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <p className="text-sm text-gray-600 mb-6">
            Upload your modified draft rubric document (.docx, .pdf, or .txt) to replace the one currently displayed.
          </p>

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
              id="replace-file-input-sc"
              aria-label="Drop your modified rubric file here or click to browse"
            />
          </div>

          {replaceFileName && (
            <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl">
              <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <span className="text-sm font-bold text-blue-800 truncate flex-1">{replaceFileName}</span>
              <button
                onClick={() => { setReplaceFileName(null); setReplaceFileText(null); }}
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

      {/* Request Changes card — appears below main card */}
      {showRequestChangesCard && state.rubric && (
        <div className="bg-white p-8 rounded-3xl shadow-2xl border border-gray-100 w-full max-w-2xl mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xl font-black text-gray-900">Request Changes</h3>
            <button
              onClick={() => { setShowRequestChangesCard(false); setRequestChangesText(''); setError(null); }}
              className="text-gray-600 hover:text-gray-700 transition-colors flex-shrink-0 ml-4"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <p className="text-sm text-gray-600 mb-6">
            Describe the changes you'd like made to the rubric above. The AI will apply your changes and update the displayed rubric.
          </p>

          <textarea
            value={requestChangesText}
            onChange={(e) => setRequestChangesText(e.target.value)}
            placeholder="e.g. Add a new category for Peer Collaboration worth 10 points. Rename 'Communication' to 'Written Communication'. Increase the Exemplary threshold for Problem Analysis to 24-22 pts."
            className="w-full h-40 p-4 border rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none resize-none mb-4 text-sm"
          />

          {state.error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl mb-4">
              <p className="text-sm text-red-700 font-bold">{state.error}</p>
            </div>
          )}

          <button
            onClick={handleApplyChanges}
            disabled={isApplyingChanges || !requestChangesText.trim()}
            className="w-full py-4 bg-brand text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-brand-dark transition-all disabled:bg-gray-300 active:scale-95 flex items-center justify-center gap-2"
          >
            {isApplyingChanges && <Loader2 className="w-5 h-5 animate-spin" />}
            {isApplyingChanges ? 'Applying Changes...' : 'Apply Changes'}
          </button>
        </div>
      )}
    </div>
  );
};
