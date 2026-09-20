import React, { useRef, useState } from 'react';
import { AlertTriangle, Check, Download, Loader2, Sparkles, X } from 'lucide-react';
import { repairRubricCsv, CsvRepairDiff } from '../services/geminiService';
import { diagnoseCanvasError } from '../utils/diagnoseCanvasError';
import { safeFileName } from '../utils/fileName';
import { revealSection, REVEAL_DELAY_MS } from '../utils/revealSection';

/**
 * Offer an AI repair for one rubric Canvas rejected, and make the user approve it.
 *
 * Two rules shape everything here:
 *
 *   1. **Nothing applies itself.** The AI can produce a confident wrong answer — asked to fix a
 *      blank point value it will supply a number, because it cannot know the criterion was worth
 *      8 rather than 10. So the change list is the product, and deploying is a separate,
 *      deliberate click.
 *   2. **Point changes are not like other changes.** A structural fix is safe to wave through: if
 *      it is wrong, Canvas rejects the file again and nothing has happened. A changed number is
 *      accepted silently and changes what a student is graded on. They are therefore separated,
 *      shown first, and never folded into a "12 changes" summary.
 *
 * The diff shown is computed in the main process by comparing the two files — it is not the
 * model's account of its own work, which cannot be checked and can under-report.
 */

interface Props {
  rubricName: string;
  /** The CSV Canvas rejected. */
  csvContent: string;
  /** What Canvas said. Passed to the model: it is the most useful input available. */
  canvasMessage: string;
  courseUrl: string;
  /** Called after the repaired CSV deploys, so the run summary can be brought up to date. */
  /**
   * Called once the repaired CSV is in Canvas, with that CSV.
   *
   * The repaired text is passed back rather than just the name because the caller is still
   * holding the rejected version: without this, "download the CSVs" afterwards hands the user
   * the broken file for a rubric it has just told them succeeded.
   */
  onDeployed: (rubricName: string, repairedCsv: string) => void;
  onLog: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void;
}

type Stage =
  | { name: 'idle' }
  | { name: 'working' }
  | { name: 'rejected'; reason: string }
  | { name: 'proposed'; repairedCsv: string; notes: string; diff: CsvRepairDiff }
  | { name: 'deploying'; repairedCsv: string; notes: string; diff: CsvRepairDiff }
  | { name: 'failed'; repairedCsv: string; notes: string; diff: CsvRepairDiff; message: string };

const fileNameFor = (rubricName: string) => `${safeFileName(rubricName)}_repaired.csv`;

/** An empty cell reads as nothing at all in a before/after pair, so it gets a word. */
const cellText = (value: string) => (value.trim() === '' ? '(blank)' : value);

export const CsvRepairPanel: React.FC<Props> = ({
  rubricName,
  csvContent,
  canvasMessage,
  courseUrl,
  onDeployed,
  onLog,
}) => {
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const panelRef = useRef<HTMLDivElement>(null);

  const handleSuggest = async () => {
    setStage({ name: 'working' });
    onLog(`Asking the AI to repair "${rubricName}"…`, 'info');
    try {
      const result = await repairRubricCsv(csvContent, canvasMessage);
      if (!result.ok) {
        setStage({ name: 'rejected', reason: result.reason });
        onLog(`No usable repair for "${rubricName}": ${result.reason}`, 'warning');
        return;
      }
      setStage({
        name: 'proposed',
        repairedCsv: result.repairedCsv,
        notes: result.notes,
        diff: result.diff,
      });
      const pointCount = result.diff.pointChanges.length;
      onLog(
        `Repair suggested for "${rubricName}": ${result.diff.changedCells} change(s)` +
          `${pointCount > 0 ? `, ${pointCount} of them to point values` : ''}. Review before deploying.`,
        'info',
      );
      // Move focus to the proposal. It renders below the button that produced it, and without this
      // a screen-reader user is left on a button that appears to have done nothing.
      setTimeout(() => revealSection(panelRef.current), REVEAL_DELAY_MS);
    } catch (err: any) {
      const reason = err?.message ?? 'The repair request failed.';
      setStage({ name: 'rejected', reason });
      onLog(`Repair failed for "${rubricName}": ${reason}`, 'error');
    }
  };

  const handleDeploy = async () => {
    if (stage.name !== 'proposed' && stage.name !== 'failed') return;
    const { repairedCsv, notes, diff } = stage;
    setStage({ name: 'deploying', repairedCsv, notes, diff });
    onLog(`Deploying the repaired "${rubricName}" to Canvas…`, 'info');
    try {
      const res = await window.api.canvas.pushRubric({ csvContent: repairedCsv, courseUrl });
      if (res.success) {
        onLog(`✓ "${rubricName}" deployed after repair`, 'success');
        onDeployed(rubricName, stage.repairedCsv);
        return;
      }
      setStage({ name: 'failed', repairedCsv, notes, diff, message: res.message });
      onLog(`✗ Repaired "${rubricName}" still failed: ${res.message}`, 'error');
    } catch (err: any) {
      const message = err?.message ?? 'The deployment failed.';
      setStage({ name: 'failed', repairedCsv, notes, diff, message });
      onLog(`✗ Repaired "${rubricName}" still failed: ${message}`, 'error');
    }
  };

  const handleDownload = async () => {
    if (stage.name === 'idle' || stage.name === 'working' || stage.name === 'rejected') return;
    await window.api.file.saveText({
      defaultName: fileNameFor(rubricName),
      ext: 'csv',
      label: 'CSV file',
      content: stage.repairedCsv,
    });
  };

  // ── Idle: the offer ────────────────────────────────────────────────────────
  if (stage.name === 'idle') {
    return (
      <div className="mt-2">
        <button
          onClick={handleSuggest}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-bold hover:bg-brand-dark transition-all active:scale-95"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Suggest a fix for “{rubricName}”
        </button>
        <p className="mt-1 text-xs text-gray-700">
          The AI reads what Canvas objected to and proposes a corrected CSV. You see exactly what
          it changed and decide whether to use it — nothing is sent to Canvas on its own.
        </p>
      </div>
    );
  }

  if (stage.name === 'working') {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs font-bold text-gray-800" role="status">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Reading what Canvas objected to in “{rubricName}”…
      </p>
    );
  }

  // ── Rejected: a gate refused the proposal, or the call failed ──────────────
  if (stage.name === 'rejected') {
    return (
      <div className="mt-2 rounded-lg border border-gray-300 bg-white p-3" role="status">
        <p className="text-xs font-bold text-gray-900">No usable fix for “{rubricName}”.</p>
        <p className="mt-1 text-xs text-gray-700">{stage.reason}</p>
        <p className="mt-1 text-xs text-gray-700">
          Download the CSV, correct it yourself, and upload it in Part 3.
        </p>
        <button
          onClick={handleSuggest}
          className="mt-2 px-3 py-1.5 bg-white border border-gray-400 text-gray-800 rounded-lg text-xs font-bold hover:bg-gray-50 transition-all"
        >
          Try again
        </button>
      </div>
    );
  }

  // ── A checked proposal, awaiting a decision ────────────────────────────────
  const { diff, notes } = stage;
  const busy = stage.name === 'deploying';

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="group"
      aria-label={`Suggested fix for ${rubricName}`}
      /* Purple marks AI-proposed content nobody has approved yet — see DESIGN_SYSTEM.md. It is
         a border and never a button: the control that starts this is an ordinary action and
         takes the ordinary action colour. */
      className="mt-2 rounded-xl border-2 border-purple-300 bg-white p-4 space-y-3"
    >
      <p className="text-sm font-black text-gray-900">Suggested fix for “{rubricName}”</p>

      {/*
        Point values first and on their own.
        Everything else in this panel is a formatting correction that Canvas will re-reject if it
        is wrong. These are the changes that get accepted and are still wrong.
      */}
      {diff.pointChanges.length > 0 && (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
          <p className="flex items-center gap-2 text-xs font-black text-amber-900 uppercase tracking-wide">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            Check these point values
          </p>
          <p className="mt-1 text-xs text-amber-900">
            These change what a student is graded on. The AI cannot know what you intended — if a
            value was blank, it has guessed.
          </p>
          <ul className="mt-2 space-y-1">
            {diff.pointChanges.map((change, i) => (
              <li key={i} className="text-xs text-gray-900">
                <span className="font-bold">{change.criterion}</span> — {change.column}:{' '}
                <span className="font-mono">{cellText(change.before)}</span>
                {' → '}
                <span className="font-mono font-bold">{cellText(change.after)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Everything else, grouped by criterion. */}
      <div>
        <p className="text-xs font-black text-gray-800 uppercase tracking-wide">
          {diff.changedCells} change{diff.changedCells !== 1 ? 's' : ''} in total
        </p>
        <ul className="mt-1 space-y-1">
          {diff.headerAdded && (
            <li className="text-xs text-gray-800">
              Added the header row Canvas requires.
            </li>
          )}
          {diff.headerChanges.map((change, i) => (
            <li key={`h${i}`} className="text-xs text-gray-800">
              Header — {change.column}:{' '}
              <span className="font-mono">{cellText(change.before)}</span>
              {' → '}
              <span className="font-mono">{cellText(change.after)}</span>
            </li>
          ))}
          {diff.criteria.map((criterion, i) => (
            <li key={`c${i}`} className="text-xs text-gray-800">
              <span className="font-bold">{criterion.criterion}</span>
              {criterion.kind === 'added' && ' — added'}
              {criterion.kind === 'removed' && ' — removed'}
              {criterion.changes.length > 0 && (
                <ul className="ml-4 mt-0.5 space-y-0.5">
                  {criterion.changes.map((change, j) => (
                    <li key={j} className={change.isPointValue ? 'font-bold' : undefined}>
                      {change.column}: <span className="font-mono">{cellText(change.before)}</span>
                      {' → '}
                      <span className="font-mono">{cellText(change.after)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>

      {notes && (
        <p className="text-xs text-gray-600 italic">
          The AI describes its change as: “{notes}” — the list above is what it actually did.
        </p>
      )}

      {stage.name === 'failed' && (
        <p className="text-xs font-bold text-red-800" role="status">
          Canvas rejected the repaired file too: {stage.message} —{' '}
          {diagnoseCanvasError(stage.message).fix}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          onClick={handleDeploy}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg text-xs font-bold hover:bg-brand-dark transition-all active:scale-95 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {busy ? 'Deploying…' : 'Use this version and deploy'}
        </button>
        <button
          onClick={handleDownload}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-400 text-gray-800 rounded-lg text-xs font-bold hover:bg-gray-50 transition-all disabled:opacity-60"
        >
          <Download className="w-3.5 h-3.5" />
          Download it instead
        </button>
        <button
          onClick={() => setStage({ name: 'idle' })}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-400 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-50 transition-all disabled:opacity-60"
        >
          <X className="w-3.5 h-3.5" />
          Discard
        </button>
      </div>
    </div>
  );
};
