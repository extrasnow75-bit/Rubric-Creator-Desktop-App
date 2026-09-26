import React, { useState } from 'react';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import type { PointsReport } from '../utils/rubricPoints';

interface Props {
  report: PointsReport;
  /** What dividing the total evenly would produce, e.g. "34 / 33 / 33". Omitted when it is long. */
  evenSplitPreview: string | null;
  /** Ask the AI to weight the criteria. Resolves with a message to show, or null when it worked. */
  onSplitByImportance: () => Promise<string | null>;
  /** Divide the intended total evenly, locally and instantly. */
  onDivideEvenly: () => void;
  /** Accept the criteria as drafted and bring the stated total in line with them. */
  onKeepActual: () => void;
}

/**
 * What a rubric is worth, where that is not what was asked for.
 *
 * Three ways out, because the arithmetic does not decide between them. Rescaling a rubric whose
 * criteria were each given the whole budget can only produce an even split — the weighting that
 * would say one criterion matters more was never written down — so the app cannot know whether
 * 50/25/25 or 34/33/33 is right. Asking the AI for a weighting is a fourth number-only call;
 * keeping the larger total is legitimate too, since the rubric it describes is a real rubric.
 *
 * Amber, not red, and the deploy button stays live throughout. Every number here is a number
 * Canvas will accept. What is wrong is that the rubric will not be worth what whoever drafted it
 * intended, which is worth stopping to look at, not worth being prevented from shipping.
 *
 * The heading leads with both figures. An earlier version said the rubric "will not be worth what
 * it says" — true, but the number it referred to was the AI's claimed total, which by then was
 * displayed nowhere, having been replaced everywhere by the computed one. It described a
 * contradiction that could not be seen.
 */
export const RubricPointsWarning: React.FC<Props> = ({
  report,
  evenSplitPreview,
  onSplitByImportance,
  onDivideEvenly,
  onKeepActual,
}) => {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!report.totalsDisagree && report.bandProblems.length === 0) return null;

  const askForSplit = async () => {
    setBusy(true);
    setNote(null);
    try {
      setNote(await onSplitByImportance());
    } finally {
      setBusy(false);
    }
  };

  const quiet =
    'px-3 py-1.5 rounded-xl text-sm bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-60';

  return (
    <div className="mb-6 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {report.totalsDisagree && (
          <>
            <h4 className="text-sm font-bold text-amber-900">
              This rubric is worth {report.actual} points, not the {report.intended} you asked for.
            </h4>
            <p className="mt-1 text-sm text-amber-900">
              {report.everyCriterionHasWholeTotal
                ? `Each of its ${report.criteriaCount} criteria was given the full ${report.intended} points instead of a share of them.`
                : `Its ${report.criteriaCount} criteria add up to ${report.actual}.`}{' '}
              The wording is fine — only the numbers are wrong.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={askForSplit}
                disabled={busy}
                className={`${quiet} border-2 border-amber-500 font-bold flex items-center gap-2`}
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {busy ? 'Asking…' : `Split ${report.intended} points by importance`}
              </button>
              {/*
                Two labels for one action, because the same proportional rescale means different
                things depending on what it starts from. Where every criterion holds the whole
                total the proportions are all equal, so it can only divide evenly, and promising
                anything else would be a lie. Where the weighting survived, it is kept.
              */}
              <button type="button" onClick={onDivideEvenly} disabled={busy} className={`${quiet} font-medium`}>
                {report.everyCriterionHasWholeTotal
                  ? `Divide ${report.intended} evenly`
                  : `Rescale to ${report.intended} points`}
                {evenSplitPreview && (
                  <span className="font-normal text-amber-800"> ({evenSplitPreview})</span>
                )}
              </button>
              <button type="button" onClick={onKeepActual} disabled={busy} className={`${quiet} font-medium`}>
                Keep it at {report.actual}
              </button>
            </div>

            <p className="mt-2 text-xs text-amber-800">
              The first asks the AI to weight the criteria by importance and takes a few seconds.
              The other two are instant. None of them changes any wording.
            </p>
          </>
        )}

        {report.bandProblems.length > 0 && (
          <ul className={report.totalsDisagree ? 'mt-3 space-y-1' : 'space-y-1'}>
            {report.bandProblems.map((problem, i) => (
              <li key={i} className="text-sm text-amber-900">
                {problem}
              </li>
            ))}
          </ul>
        )}

        {/* Mounted empty so the outcome of the AI call is announced, not just drawn. */}
        <div role="status" aria-live="polite" className="mt-2 empty:mt-0">
          {note && (
            <p className="flex items-start gap-2 text-sm text-amber-900">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
              {note}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
