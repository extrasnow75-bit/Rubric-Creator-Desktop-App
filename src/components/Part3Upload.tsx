import React, { useState, useEffect } from 'react';
import { useSession } from '../contexts/SessionContext';
import { useDrivePicker } from '../contexts/DrivePickerContext';
import { AppMode, BatchItemStatus, CanvasConfig } from '../types';
import { Eye, EyeOff, Loader2, Upload, CheckCircle, AlertCircle, X, Zap, FolderOpen, ChevronLeft } from 'lucide-react';
import ErrorDisplay from './ErrorDisplay';
import { useCopyAction } from '../hooks/useCopyAction';
import JSZip from 'jszip';

interface BatchFile {
  id: string;
  name: string;
  content: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  message?: string;
}

export const Part3Upload: React.FC = () => {
  const {
    state,
    setCsvOutput,
    setCanvasConfig,
    setError,
    setIsLoading,
    addToHistory,
    setTaskCompletionOpen,
    startProgress,
    stopProgress,
    setProgress,
    getAbortSignal,
    startGoogleAuth,
    setCurrentStep,
    downloadDriveFile,
    setCourseUrl: pinCourseUrl,
  } = useSession();
  const { pickFile } = useDrivePicker();

  const [courseUrl, setCourseUrl] = useState('');
  /** The token itself is in the OS keychain; this is all the renderer knows about it. */
  const hasToken = !!state.canvasTokenStatus?.hasValue;
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [manualCsv, setManualCsv] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [batchFiles, setBatchFiles] = useState<BatchFile[]>([]);
  const [uploadMode, setUploadMode] = useState<'from-phase2' | 'batch' | 'google-drive'>('from-phase2');
  // Per-item upload status for the from-phase2 batch flow (keyed by batchItem id)
  const [phase2UploadStatuses, setPhase2UploadStatuses] = useState<
    Record<string, { status: 'pending' | 'uploading' | 'success' | 'error'; message?: string }>
  >({});
  const [deploymentLogs, setDeploymentLogs] = useState<string[]>([]);
  const { state: copyState, copy } = useCopyAction();

  /** Same header as the Part 1 / screenshot timeline, so a pasted log reads the same either way. */
  const handleCopyLogs = async () => {
    const header = [
      `Canvas Rubric Creator v${await window.api.app.version()} — deployment log`,
      `Copied ${new Date().toLocaleString()}`,
      '',
    ].join('\n');
    await copy(header + deploymentLogs.join('\n'));
  };
  const [pickingFromDrive, setPickingFromDrive] = useState(false);
  const [drivePickedCsv, setDrivePickedCsv] = useState<string | null>(null);
  const [drivePickedFileName, setDrivePickedFileName] = useState('');
  const [driveUrl, setDriveUrl] = useState('');
  const [fetchingDriveUrl, setFetchingDriveUrl] = useState(false);

  // When Phase 2 items are present, activate the From Phase 2 tab and
  // initialise per-item upload statuses.  Data stays in context (never
  // copied to local state) so it survives tab switches.
  useEffect(() => {
    const completed = state.batchItems.filter(
      item => item.status === BatchItemStatus.COMPLETED && !!item.csvContent,
    );
    if (completed.length > 0) {
      setUploadMode('from-phase2');
      const statuses: Record<string, { status: 'pending' }> = {};
      completed.forEach(item => { statuses[item.id] = { status: 'pending' }; });
      setPhase2UploadStatuses(statuses);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const csvToUse = state.csvOutput || drivePickedCsv || manualCsv;

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDeploymentLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  // Helper: extract course ID from full Canvas course URL
  const extractCourseId = (url: string): string => {
    const match = url.match(/\/courses\/(\d+)/i);
    return match ? match[1] : '';
  };

  // Handle file selection (CSV or ZIP)
  const handleFileSelect = async (files: FileList | null) => {
    if (!files) return;

    const newBatchFiles: BatchFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file.name.endsWith('.zip')) {
        // Extract CSV files from ZIP
        try {
          const zip = new JSZip();
          const zipContent = await zip.loadAsync(file);

          for (const [fileName, fileObj] of Object.entries(zipContent.files)) {
            if (fileName.endsWith('.csv') && !fileObj.dir) {
              const csvContent = await fileObj.async('string');
              newBatchFiles.push({
                id: `${Date.now()}-${Math.random()}`,
                name: fileName,
                content: csvContent,
                status: 'pending',
              });
            }
          }
        } catch (err: any) {
          setError(`Failed to extract ZIP file: ${err.message}`);
        }
      } else if (file.name.endsWith('.csv')) {
        // Read CSV file directly
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          newBatchFiles.push({
            id: `${Date.now()}-${Math.random()}`,
            name: file.name,
            content,
            status: 'pending',
          });
        };
        reader.readAsText(file);
      }
    }

    // Wait for all file reads to complete
    setTimeout(() => {
      setBatchFiles((prev) => [...prev, ...newBatchFiles]);
      setUploadMode('batch');
    }, 100);
  };

  // Derive phase2Items at render time so it's available in both JSX and handleUpload
  const phase2Items = state.batchItems.filter(
    item => item.status === BatchItemStatus.COMPLETED && !!item.csvContent,
  );

  const handleUpload = async () => {
    if (!courseUrl.trim() || !hasToken) {
      setError('Please enter Canvas URL and access token');
      return;
    }

    if (uploadMode === 'from-phase2' && phase2Items.length === 0 && !csvToUse.trim()) {
      setError('No CSV content to upload. Go back to Phase 2 to generate CSVs.');
      return;
    }

    if (uploadMode === 'google-drive' && !csvToUse.trim()) {
      setError('No CSV content to upload');
      return;
    }

    if (uploadMode === 'batch' && batchFiles.length === 0) {
      setError('No CSV files to upload');
      return;
    }

    setIsUploading(true);
    setError(null);
    setUploadStatus(null);

    const courseHomeUrl = courseUrl.startsWith('http')
      ? courseUrl.replace(/\/$/, '')
      : `https://${courseUrl.replace(/\/$/, '')}`;
    const config: CanvasConfig = { courseHomeUrl };

    // Record the course before uploading. Main sends the Canvas token only to the host saved in
    // settings, and this screen keeps its URL in local state, so nothing here had ever saved
    // one: every upload failed with "No Canvas course is saved yet" unless the user happened to
    // have filled the Dashboard's course field earlier in the session. Going through the context
    // setter also keeps the confirmation prompt for a host the app has not used before.
    const pinned = await pinCourseUrl(courseHomeUrl);
    if (!pinned.ok) {
      setError(pinned.message ?? 'Could not use this Canvas course.');
      setIsUploading(false);
      return;
    }

    try {
      if (uploadMode === 'from-phase2' && phase2Items.length >= 1) {
        // ── From Phase 2 — upload all items sequentially from context ──
        const label = phase2Items.length === 1 ? '1 file' : `${phase2Items.length} files`;
        addLog(`Starting upload (${label})...`);
        startProgress(phase2Items.length, true);

        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < phase2Items.length; i++) {
          const signal = getAbortSignal();
          if (signal.aborted) {
            addLog('Upload cancelled by user');
            setError('Upload cancelled by user');
            break;
          }

          if (i > 0) {
            addLog('Waiting 10 seconds before next upload…');
            try {
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, 10_000);
                signal.addEventListener('abort', () => {
                  clearTimeout(timer);
                  reject(new Error('Upload cancelled'));
                }, { once: true });
              });
            } catch {
              addLog('Upload cancelled during wait');
              setError('Upload cancelled by user');
              break;
            }
            if (getAbortSignal().aborted) break;
          }

          const item = phase2Items[i];
          const fileName = `${item.name}.csv`;
          setPhase2UploadStatuses(prev => ({ ...prev, [item.id]: { status: 'uploading' } }));
          addLog(`Uploading: ${fileName}...`);

          setProgress({
            currentStep: `Uploading: ${fileName}`,
            percentage: i / phase2Items.length,
            itemsProcessed: i,
          });

          try {
            const result = await window.api.canvas.pushRubric({
              csvContent: item.csvContent!,
              courseUrl: courseHomeUrl,
            });
            if (result.success) {
              setPhase2UploadStatuses(prev => ({ ...prev, [item.id]: { status: 'success', message: 'Successfully uploaded' } }));
              successCount++;
              addLog(`✓ ${fileName} uploaded successfully`);
              addToHistory({
                id: Date.now().toString(),
                timestamp: Date.now(),
                rubricName: item.name,
                totalPoints: parseInt(item.totalPoints || '0') || 100,
                csvFileName: fileName,
                canvasUploadStatus: 'success',
              });
            } else {
              setPhase2UploadStatuses(prev => ({ ...prev, [item.id]: { status: 'error', message: result.message } }));
              errorCount++;
              addLog(`✗ ${fileName} failed: ${result.message}`);
            }
          } catch (err: any) {
            setPhase2UploadStatuses(prev => ({ ...prev, [item.id]: { status: 'error', message: err.message } }));
            errorCount++;
            addLog(`✗ ${fileName} error: ${err.message}`);
          }
        }

        setProgress({ percentage: 1, itemsProcessed: phase2Items.length });
        const uploadSuccess = errorCount === 0;
        setUploadStatus({
          success: uploadSuccess,
          message: `Batch upload complete: ${successCount} successful, ${errorCount} failed`,
        });
        if (uploadSuccess) {
          setTimeout(() => stopProgress(), 500);
        } else {
          stopProgress();
        }

      } else if (uploadMode === 'from-phase2' || uploadMode === 'google-drive') {
        addLog('Starting single rubric upload...');
        // Single upload
        startProgress(1, true);
        setProgress({ currentStep: 'Uploading rubric to Canvas...' });

        try {
          const result = await window.api.canvas.pushRubric({
            csvContent: csvToUse,
            courseUrl: courseHomeUrl,
          });

          if (result.success) {
            addLog('✓ Upload successful!');
            setUploadStatus(result);
            setCanvasConfig(config);
            addToHistory({
              id: Date.now().toString(),
              timestamp: Date.now(),
              rubricName: 'Uploaded Rubric',
              totalPoints: parseInt(state.rubricMetadata?.totalPoints || '0') || 100,
              csvFileName: state.csvFileName || 'rubric.csv',
              canvasUploadStatus: 'success',
            });
            setProgress({ percentage: 1, itemsProcessed: 1 });

            setTimeout(() => {
              stopProgress();
            }, 500);
          } else {
            // Full error detail goes to the log; status box shows a short summary
            addLog(`✗ Upload failed: ${result.message}`);
            setUploadStatus({ success: false, message: 'Upload failed — see the deployment log above for details.' });
            stopProgress();
          }
        } catch (err: any) {
          addLog(`✗ Error: ${err.message}`);
          setUploadStatus({ success: false, message: 'Upload failed — see the deployment log above for details.' });
          stopProgress();
        }
      } else {
        // Batch upload with progress tracking
        addLog(`Starting batch upload (${batchFiles.length} files)...`);
        startProgress(batchFiles.length, true);

        const updatedFiles = [...batchFiles];
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < updatedFiles.length; i++) {
          // Check if cancelled
          const signal = getAbortSignal();
          if (signal.aborted) {
            addLog('Upload cancelled by user');
            setError('Upload cancelled by user');
            break;
          }

          // Wait 10 seconds between uploads (not before the first)
          if (i > 0) {
            addLog('Waiting 10 seconds before next upload…');
            try {
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, 10_000);
                signal.addEventListener('abort', () => {
                  clearTimeout(timer);
                  reject(new Error('Upload cancelled'));
                }, { once: true });
              });
            } catch {
              addLog('Upload cancelled during wait');
              setError('Upload cancelled by user');
              break;
            }
            // Re-check after the wait
            if (getAbortSignal().aborted) break;
          }

          const file = updatedFiles[i];
          updatedFiles[i] = { ...file, status: 'uploading' };
          setBatchFiles([...updatedFiles]);
          addLog(`Uploading: ${file.name}...`);

          // Update progress
          const percentage = i / updatedFiles.length;
          setProgress({
            currentStep: `Uploading: ${file.name}`,
            percentage,
            itemsProcessed: i,
          });

          try {
            const result = await window.api.canvas.pushRubric({
              csvContent: file.content,
              courseUrl: courseHomeUrl,
            });

            if (result.success) {
              updatedFiles[i] = {
                ...file,
                status: 'success',
                message: 'Successfully uploaded',
              };
              successCount++;
              addLog(`✓ ${file.name} uploaded successfully`);

              addToHistory({
                id: Date.now().toString(),
                timestamp: Date.now(),
                rubricName: file.name.replace('.csv', ''),
                totalPoints: 100,
                csvFileName: file.name,
                canvasUploadStatus: 'success',
              });
            } else {
              updatedFiles[i] = {
                ...file,
                status: 'error',
                message: result.message,
              };
              errorCount++;
              addLog(`✗ ${file.name} failed: ${result.message}`);
            }
          } catch (err: any) {
            updatedFiles[i] = {
              ...file,
              status: 'error',
              message: err.message,
            };
            errorCount++;
            addLog(`✗ ${file.name} error: ${err.message}`);
          }

          setBatchFiles([...updatedFiles]);
        }

        // Final progress update
        setProgress({ percentage: 1, itemsProcessed: batchFiles.length });

        const uploadSuccess = errorCount === 0;
        setUploadStatus({
          success: uploadSuccess,
          message: `Batch upload complete: ${successCount} successful, ${errorCount} failed`,
        });

        if (uploadSuccess) {
          setTimeout(() => {
            stopProgress();
          }, 500);
        } else {
          stopProgress();
        }
      }
    } catch (err: any) {
      stopProgress();
      setUploadStatus({
        success: false,
        message: `Upload failed: ${err.message}`,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const removeBatchFile = (id: string) => {
    setBatchFiles((prev) => prev.filter((f) => f.id !== id));
    if (batchFiles.length === 1) {
      setUploadMode('from-phase2');
    }
  };

  const clearBatchFiles = () => {
    setBatchFiles([]);
    setUploadMode('from-phase2');
  };

  /** Resolve a picked/fetched Drive file to CSV based on its mimeType. */
  const resolveDriveCsv = async (fileId: string, mimeType: string, name: string): Promise<void> => {
    let csvData: string;
    let fileName: string;
    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      csvData = await window.api.drive.getSheetCsv(fileId);
      fileName = `${name}.csv`;
    } else if (mimeType === 'text/csv' || mimeType === 'text/plain') {
      const arrayBuffer = await downloadDriveFile(fileId);
      csvData = new TextDecoder().decode(arrayBuffer);
      fileName = name.endsWith('.csv') ? name : `${name}.csv`;
    } else {
      throw new Error(`"${name}" is not a supported type. Please select a Google Sheet or a CSV file.`);
    }
    setDrivePickedCsv(csvData);
    setDrivePickedFileName(fileName);
    setCsvOutput(csvData, fileName);
  };

  /** Open the Google Drive file picker filtered to Sheets and CSV files. */
  const handleGoogleDrivePick = async () => {
    if (!state.isGoogleAuthenticated) {
      setError('Please sign in with Google on the Dashboard first.');
      return;
    }
    setPickingFromDrive(true);
    setError(null);
    try {
      const result = await pickFile({ mimeTypes: ['application/vnd.google-apps.spreadsheet', 'text/csv'] });
      if (result) {
        await resolveDriveCsv(result.fileId, result.mimeType, result.name);
      }
    } catch (err: any) {
      setError(`Google Drive: ${err.message}`);
    } finally {
      setPickingFromDrive(false);
    }
  };

  /** Fetch a CSV or Google Sheet from a pasted Drive URL. */
  const handleFetchFromDriveUrl = async () => {
    if (!state.isGoogleAuthenticated) {
      setError('Please sign in with Google on the Dashboard first.');
      return;
    }
    if (!driveUrl.trim()) return;
    setFetchingDriveUrl(true);
    setError(null);
    try {
      const resolved = await window.api.drive.resolveUrl(driveUrl.trim());
      if (!resolved.ok) throw new Error(resolved.message);
      const fileId = resolved.fileId;
      const meta = { name: resolved.name, mimeType: resolved.mimeType };
      await resolveDriveCsv(fileId, meta.mimeType, meta.name);
      setDriveUrl('');
    } catch (err: any) {
      setError(`Google Drive: ${err.message}`);
    } finally {
      setFetchingDriveUrl(false);
    }
  };

  /**
   * Confirm the saved token still works against this course.
   *
   * The whole request happens in the main process: it loads the token from the keychain, calls
   * Canvas directly and returns a verdict. The previous version built the request here with the
   * token in an Authorization header and sent it through the Canvas proxy — which is also why it
   * had to distinguish a genuine Canvas 404 from a proxy routing error. With no proxy in the
   * path, a 404 means what it says.
   */
  const handleValidate = async () => {
    const courseId = extractCourseId(courseUrl);
    if (!courseUrl.trim() || !courseId || !hasToken) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await window.api.canvas.getCourseName({ courseUrl: courseUrl.trim() });
      const msg = result.ok
        ? `\u2713 Connected \u2014 ${result.name || 'Course found'}`
        : `\u2717 ${result.message || 'Could not reach that course.'}`;
      setValidationResult({ ok: result.ok, message: msg });
      addLog(msg);
    } catch (e) {
      const msg = `\u2717 ${e instanceof Error ? e.message : 'Validation failed.'}`;
      setValidationResult({ ok: false, message: msg });
      addLog(msg);
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto w-full">
        {/* Phase 2 carry-forward banner */}
        {state.csvOutput && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-6">
            <p className="font-bold text-green-900 text-sm">CSV Rubric batch from Phase 2 is ready</p>
            <p className="text-xs text-green-800 mt-0.5">
              Review the file(s) and proceed when ready.
            </p>
          </div>
        )}

        {/* Back to Phase 2 Button */}
        <button
          onClick={() => setCurrentStep(AppMode.PART_2)}
          className="mb-6 px-4 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all flex items-center gap-2 inline-flex"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Phase 2
        </button>

        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-black text-gray-900 mb-2">Deploy to Canvas</h2>
          <p className="text-gray-600 font-medium mb-6">
            {uploadMode === 'from-phase2'
              ? phase2Items.length > 0
                ? `Upload ${phase2Items.length === 1 ? 'your rubric' : `${phase2Items.length} rubrics`} from Phase 2 to Canvas`
                : 'Enter your Canvas credentials to upload the rubric'
              : uploadMode === 'google-drive'
              ? 'Upload CSV rubric(s) to Canvas'
              : 'Upload multiple CSV files to Canvas LMS'}
          </p>

          {/* Informational Box */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl">
            <p className="text-sm text-blue-900 font-medium">
              This app will upload one or more CSV rubric files to Canvas at a time, and Canvas will then transform each file into a separate rubric.
            </p>
          </div>
        </div>

        {/* Upload Mode Tabs */}
        <div className="mb-6 border-b border-gray-200 flex gap-0">
          <button
            onClick={() => setUploadMode('from-phase2')}
            className={`px-4 py-3 font-bold text-sm transition-all border-b-2 -mb-px ${
              uploadMode === 'from-phase2'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            From Phase 2
          </button>
          <button
            onClick={() => setUploadMode('google-drive')}
            className={`px-4 py-3 font-bold text-sm transition-all border-b-2 -mb-px ${
              uploadMode === 'google-drive'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            From Google Drive
          </button>
          <button
            onClick={() => setUploadMode('batch')}
            className={`px-4 py-3 font-bold text-sm transition-all border-b-2 -mb-px ${
              uploadMode === 'batch'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Batch Upload
          </button>
        </div>

        {/* Two-Column Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Queue + Timeline */}
          <div className="lg:col-span-2 flex flex-col gap-6">

            {/* From Phase 2 Tab Content */}
            {uploadMode === 'from-phase2' && phase2Items.length > 0 && (
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <h3 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <Upload className="w-5 h-5 text-blue-600" />
                  Phase 2 Rubrics ({phase2Items.length})
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {phase2Items.map((item) => {
                    const st = phase2UploadStatuses[item.id];
                    return (
                      <div
                        key={item.id}
                        className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center gap-3"
                      >
                        {(!st || st.status === 'pending') && (
                          <Upload className="w-5 h-5 text-gray-600 flex-shrink-0" />
                        )}
                        {st?.status === 'uploading' && (
                          <div className="w-5 h-5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin flex-shrink-0" />
                        )}
                        {st?.status === 'success' && (
                          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                        )}
                        {st?.status === 'error' && (
                          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-900 truncate">{item.name}</p>
                          {st?.message && (
                            <p className="text-xs text-gray-600 truncate">{st.message}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {uploadMode === 'from-phase2' && phase2Items.length === 0 && csvToUse && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl">
                <p className="text-sm font-bold text-blue-900">
                  ✓ CSV file ready ({state.csvFileName || 'rubric.csv'})
                </p>
              </div>
            )}

            {uploadMode === 'from-phase2' && phase2Items.length === 0 && !csvToUse && (
              <div className="p-5 bg-yellow-50 border border-yellow-200 rounded-2xl space-y-2">
                <p className="text-sm font-bold text-yellow-900">
                  ⚠ No CSV available from Phase 2.
                </p>
                <p className="text-xs text-yellow-700">
                  Go back to Phase 2 to generate a CSV, use the Google Drive tab, or paste CSV content in the manual input below.
                </p>
              </div>
            )}

            {/* Google Drive Tab Content */}
            {uploadMode === 'google-drive' && (
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-blue-600" />
                  Pick CSV from Google Drive
                </h3>
                {drivePickedCsv ? (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                    <p className="text-sm font-bold text-blue-900">✓ CSV ready: {drivePickedFileName}</p>
                    <button
                      onClick={() => { setDrivePickedCsv(null); setDrivePickedFileName(''); }}
                      className="text-xs text-blue-600 hover:underline mt-1"
                    >
                      Pick a different file
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={handleGoogleDrivePick}
                      disabled={pickingFromDrive || !state.isGoogleAuthenticated}
                      className="w-full py-3 px-4 bg-brand text-white rounded-xl font-bold hover:bg-brand-dark disabled:bg-gray-200 disabled:text-gray-400 transition-all flex items-center justify-center gap-2"
                    >
                      {pickingFromDrive ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FolderOpen className="w-4 h-4" />
                      )}
                      {pickingFromDrive ? 'Opening Drive…' : 'Open Google Drive Picker'}
                    </button>
                    {!state.isGoogleAuthenticated && (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                        <p className="text-sm font-bold text-gray-700 mb-1">Google sign-in required</p>
                        <p className="text-xs text-gray-600 mb-3">Sign in to pick CSV files directly from your Drive.</p>
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

                    {/* OR divider */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-gray-200" />
                      <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">or paste a URL</span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>

                    {/* Drive URL input */}
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">
                        Paste Google Sheets or CSV Drive URL
                      </label>
                      <input
                        type="url"
                        value={driveUrl}
                        onChange={(e) => setDriveUrl(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleFetchFromDriveUrl(); }}
                        placeholder="docs.google.com/spreadsheets/d/… or drive.google.com/file/d/…"
                        className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm mb-3"
                      />
                      <button
                        onClick={handleFetchFromDriveUrl}
                        disabled={!driveUrl.trim() || fetchingDriveUrl || !state.isGoogleAuthenticated}
                        className="w-full py-3 px-4 bg-blue-100 text-blue-700 rounded-xl font-bold hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 transition-all text-sm flex items-center justify-center gap-2"
                      >
                        {fetchingDriveUrl && <Loader2 className="w-4 h-4 animate-spin" />}
                        {fetchingDriveUrl ? 'Fetching…' : 'Fetch from Drive'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Batch File Upload / Queue */}
            {uploadMode === 'batch' && (
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Upload className="w-5 h-5 text-blue-600" />
                  Batch Rubric Queue
                </h3>
                <div className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center hover:border-blue-400 transition-all cursor-pointer relative">
                  <input
                    type="file"
                    multiple
                    accept=".csv,.zip"
                    onChange={(e) => handleFileSelect(e.target.files)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <Upload className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                  <p className="text-sm font-bold text-gray-700">
                    Drag & drop CSV files or ZIP archive here
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    Supports .csv files and .zip archives containing CSV files
                  </p>
                </div>

                {/* Batch Files List */}
                {batchFiles.length > 0 && (
                  <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
                    {batchFiles.map((file) => (
                      <div
                        key={file.id}
                        className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {file.status === 'success' && (
                            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                          )}
                          {file.status === 'error' && (
                            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                          )}
                          {file.status === 'pending' && (
                            <Upload className="w-5 h-5 text-gray-600 flex-shrink-0" />
                          )}
                          {file.status === 'uploading' && (
                            <div className="w-5 h-5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin flex-shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-gray-900 truncate">
                              {file.name}
                            </p>
                            {file.message && (
                              <p className="text-xs text-gray-600 truncate">
                                {file.message}
                              </p>
                            )}
                          </div>
                        </div>
                        {file.status === 'pending' && (
                          <button
                            onClick={() => removeBatchFile(file.id)}
                            className="ml-2 text-gray-600 hover:text-red-600 flex-shrink-0"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {batchFiles.length > 0 && (
                  <button
                    onClick={clearBatchFiles}
                    className="mt-3 text-sm font-bold text-gray-600 hover:text-red-600"
                  >
                    Clear all files
                  </button>
                )}

              </div>
            )}

            {/* Deployment Timeline / Logs */}
            <div className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800 shadow-sm">
              <div className="flex justify-between items-center p-4 border-b border-gray-800">
                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Deployment Timeline</h3>
                <div className="flex gap-3">
                  <button
                    onClick={() => void handleCopyLogs()}
                    disabled={deploymentLogs.length === 0}
                    className={`text-xs font-bold disabled:opacity-40 transition-colors ${
                      copyState === 'failed'
                        ? 'text-amber-300'
                        : copyState === 'copied'
                          ? 'text-green-300'
                          : 'text-gray-300 hover:text-white'
                    }`}
                  >
                    {copyState === 'copied'
                      ? 'Copied'
                      : copyState === 'failed'
                        ? 'Could not copy'
                        : 'Copy Logs'}
                  </button>
                  <button
                    onClick={() => setDeploymentLogs([])}
                    className="text-xs text-gray-300 hover:text-gray-300 font-bold"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="p-4 h-64 overflow-y-auto font-mono text-xs">
                {deploymentLogs.length === 0 ? (
                  <p className="text-gray-300">No activity yet. Upload CSVs to start deployment.</p>
                ) : (
                  deploymentLogs.map((log, i) => {
                    const isSuccess = log.includes('✓');
                    const isError = log.includes('✗');
                    return (
                      <div
                        key={i}
                        className={`whitespace-pre-wrap break-words mb-1 ${
                          isSuccess ? 'text-green-400' : isError ? 'text-red-400' : 'text-gray-300'
                        }`}
                      >
                        {log}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Status Messages in Left Column */}
            {state.error && (
              <ErrorDisplay error={state.error} />
            )}

            {/* Mounted for the whole session, empty until there is a result.
                A live region that appears with its text already inside is not reliably
                announced, so this cannot live inside the block below — and an upload that takes
                minutes previously finished in silence for anyone not watching the panel.
                The deployment timeline deliberately stays outside the live region: announcing
                every line of it, including each "Waiting 10 seconds before next upload", would
                be unusable. */}
            <span role="status" aria-live="polite" className="sr-only">
              {uploadStatus?.message ?? ''}
            </span>

            {uploadStatus && (
              <div
                className={`p-4 border rounded-2xl ${
                  uploadStatus.success
                    ? 'bg-green-50 border-green-200'
                    : 'bg-amber-50 border-amber-200'
                }`}
              >
                <p
                  className={`text-sm font-semibold ${
                    uploadStatus.success ? 'text-green-900' : 'text-amber-800'
                  }`}
                >
                  {uploadStatus.message}
                </p>
              </div>
            )}
          </div>

          {/* Right Column: Config Panel */}
          <div className="lg:col-span-1 flex flex-col gap-6">
            {/* Target Course & User Section */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-4 uppercase text-sm tracking-wider">Target Course & User</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    Canvas Course URL
                  </label>
                  <p className="text-xs text-gray-900 mb-2">
                    Paste the URL of your Canvas course home page.
                  </p>
                  <input
                    type="text"
                    value={courseUrl}
                    onChange={(e) => {
                      setValidationResult(null);
                      setCourseUrl(e.target.value);
                    }}
                    placeholder="https://boisestate.instructure.com/courses/12345"
                    className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>

                {/*
                  The token is not editable here.

                  It used to be a second password box duplicating the one in Initial Setup, which
                  meant two places to paste the same secret and no clear answer to which one was
                  in effect. Now there is one: it is saved once, encrypted in the OS keychain, and
                  this panel only reports whether it is there.
                */}
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <label className="block text-sm font-bold text-gray-900 mb-1">
                    Canvas API Token
                  </label>
                  {hasToken ? (
                    <p className="text-sm text-gray-700 flex items-center gap-2">
                      <span className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
                      Saved in your keychain, ending &hellip;{state.canvasTokenStatus?.hint}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-700">
                      No token saved yet. Add one under{' '}
                      <button
                        onClick={() => setCurrentStep(AppMode.DASHBOARD)}
                        className="font-bold text-brand underline hover:text-blue-800"
                      >
                        Initial Setup
                      </button>{' '}
                      to upload to Canvas.
                    </p>
                  )}
                </div>

                <button
                  onClick={handleValidate}
                  disabled={validating || !courseUrl.trim() || !hasToken}
                  className="w-full px-4 py-2 bg-brand text-white rounded-lg font-bold hover:bg-brand-dark transition-all text-sm disabled:opacity-50 disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2"
                >
                  {validating ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</>
                  ) : (
                    'Validate Connection'
                  )}
                </button>
                {!validationResult && (!courseUrl.trim() || !hasToken) && (
                  <p className="text-xs text-gray-600 text-center">
                    {!courseUrl.trim() ? 'Enter Canvas URL (with course ID)' : 'Enter API Token'} to enable validation
                  </p>
                )}
                {validationResult && (
                  <p className={`text-xs font-semibold mt-1 text-center ${validationResult.ok ? 'text-green-800' : 'text-red-600'}`}>
                    {validationResult.message}
                  </p>
                )}
              </div>
            </div>

            {/* Manual CSV Input (From Phase 2 fallback — only when no Phase 2 items) */}
            {uploadMode === 'from-phase2' && phase2Items.length === 0 && !state.csvOutput && (
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <button
                  onClick={() => setShowManualInput(!showManualInput)}
                  className="text-sm font-bold text-blue-600 hover:underline"
                >
                  {showManualInput ? '▼ Hide CSV Input' : '▶ Paste CSV Manually'}
                </button>
                {showManualInput && (
                  <textarea
                    value={manualCsv}
                    onChange={(e) => setManualCsv(e.target.value)}
                    placeholder="Paste your CSV content here..."
                    className="w-full h-32 p-3 border rounded-xl mt-3 focus:ring-2 focus:ring-blue-500 outline-none text-xs font-mono"
                  />
                )}
              </div>
            )}

            {/* BUILD IN CANVAS Section */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-4 uppercase text-sm tracking-wider flex items-center gap-2">
                <Zap className="w-4 h-4 text-blue-600" />
                Build in Canvas
              </h3>

              {/* Upload Button */}
              <button
                onClick={handleUpload}
                disabled={
                  isUploading ||
                  !courseUrl.trim() ||
                  !hasToken ||
                  (uploadMode === 'from-phase2' && phase2Items.length === 0 && !csvToUse.trim()) ||
                  (uploadMode === 'google-drive' && !csvToUse.trim()) ||
                  (uploadMode === 'batch' && batchFiles.length === 0)
                }
                className="w-full py-4 bg-brand text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-brand-dark transition-all disabled:bg-gray-200 disabled:text-gray-700 active:scale-95 flex items-center justify-center gap-2"
              >
                {isUploading && <Loader2 className="w-5 h-5 animate-spin" />}
                {isUploading
                  ? uploadMode === 'batch'
                    ? 'Uploading Batch...'
                    : 'Uploading...'
                  : uploadMode === 'batch'
                  ? `Deploy ${batchFiles.length} File(s)`
                  : uploadMode === 'from-phase2' && phase2Items.length > 1
                  ? `Deploy ${phase2Items.length} Rubrics to Canvas`
                  : 'Deploy Rubric to Canvas'}
              </button>

              {/* Time estimate */}
              {!isUploading && uploadMode === 'batch' && batchFiles.length > 0 && (
                <p className="text-xs text-gray-600 text-center mt-2">
                  {batchFiles.length === 1
                    ? 'Estimated time: ~2s'
                    : `Estimated time: ~${batchFiles.length * 2 + (batchFiles.length - 1) * 10}s (${batchFiles.length} uploads + ${batchFiles.length - 1}×10s gaps)`}
                </p>
              )}
              {!isUploading && uploadMode === 'from-phase2' && phase2Items.length > 1 && (
                <p className="text-xs text-gray-600 text-center mt-2">
                  {`Estimated time: ~${phase2Items.length * 2 + (phase2Items.length - 1) * 10}s (${phase2Items.length} uploads + ${phase2Items.length - 1}×10s gaps)`}
                </p>
              )}
              {!isUploading && uploadMode === 'from-phase2' && phase2Items.length === 1 && (
                <p className="text-xs text-gray-600 text-center mt-2">
                  Estimated time: ~2 seconds
                </p>
              )}
              {!isUploading && uploadMode === 'from-phase2' && phase2Items.length === 0 && csvToUse.trim() && (
                <p className="text-xs text-gray-600 text-center mt-2">
                  Estimated time: ~2 seconds
                </p>
              )}

              {/* Additional Actions */}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <button
                  onClick={() => {
                    setCourseUrl('');
                    setManualCsv('');
                    setUploadStatus(null);
                    clearBatchFiles();
                  }}
                  className="px-4 py-2 text-gray-700 rounded-xl font-bold hover:bg-gray-100 transition-all text-sm border border-gray-200"
                >
                  Clear All
                </button>
                <button
                  onClick={() => window.open('https://canvas.instructure.com/doc/api/file.accessing_via_api.html', '_blank')}
                  className="px-4 py-2 text-blue-600 rounded-xl font-bold hover:bg-blue-50 transition-all text-sm border border-blue-200"
                >
                  Canvas Docs
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
