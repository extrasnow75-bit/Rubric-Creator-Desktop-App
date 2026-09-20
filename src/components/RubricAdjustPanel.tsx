import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Info, Pencil, RotateCcw } from 'lucide-react';
import type { RubricData } from '../types';
import { canvasTotal, rescaleRubric } from '../utils/rescaleRubric';

/**
 * Change a rubric's name and what it is worth, without asking the AI to write it again.
 *
 * Both of these used to be possible only through "Request changes", which sends the rubric back
 * to Gemini and waits ten seconds to get a rewritten one — for a rename, which is a string
 * assignment, and for a point total, which is arithmetic. Worse, an AI rewrite is not guaranteed
 * to change only the thing asked for, so a rename could quietly reword a criterion.
 *
 * The third control is the honest version of "let me start over": it puts the deliverables
 * checklist back so the set of rubrics can be chosen again. That one *does* re-run generation and
 * throws away every edit, which is why it is a separate button behind a confirmation rather than
 * something that happens when a field changes.
 */

interface Props {
  rubric: RubricData;
  /**
   * Which rubric this is, used to tell "a different rubric is now open" from "this one changed".
   *
   * The two need different handling: switching chips should clear the confirmation message,
   * whereas editing should leave it up — that message is the only evidence a rename happened.
   */
  rubricIndex: number;
  /** Write the changed rubric back. Index is handled by the caller. */
  onChange: (rubric: RubricData) => void;
  /**
   * Restore the deliverables checklist so the set can be chosen again, or undefined when there is
   * no plan to go back to (a rubric uploaded from a file never had one).
   */
  onReplan?: () => void;
  /** Whether anything has reached Canvas yet, which changes what a further edit means. */
  deployedToCanvas: boolean;
  /** Disabled while a generation or revision is in flight. */
  busy?: boolean;
}

export const RubricAdjustPanel: React.FC<Props> = ({
  rubric,
  rubricIndex,
  onChange,
  onReplan,
  deployedToCanvas,
  busy = false,
}) => {
  const nameId = useId();
  const pointsId = useId();
  const panelId = useId();

  /**
   * Closed until asked for.
   *
   * It used to render open, which put two text fields between the save buttons and the deploy
   * button on every visit — a standing invitation to change a name nobody had come here to
   * change, and a lot of vertical space spent on the rarest thing on the screen. Most runs need
   * no adjustment at all.
   */
  const [open, setOpen] = useState(false);

  /**
   * The name is held locally while it is being typed and written back on blur or Enter.
   *
   * Writing on every keystroke would work, but `rubric.title` is also the switcher chip's label
   * and the CSV's filename, so the chips above would reflow on each character. Committing on blur
   * keeps the field responsive and the rest of the screen still.
   */
  const [draftName, setDraftName] = useState(rubric.title);
  const [points, setPoints] = useState(String(canvasTotal(rubric)));
  const [confirmingReplan, setConfirmingReplan] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'refused'; text: string } | null>(null);
  const replanRef = useRef<HTMLButtonElement>(null);

  // The fields follow whatever rubric is open — a different one picked from the chips above, or
  // this one after an AI revision rewrote its title or its points.
  useEffect(() => {
    setDraftName(rubric.title);
    setPoints(String(canvasTotal(rubric)));
  }, [rubric]);

  // The confirmation message and the re-draft prompt belong to one rubric. Clearing them here
  // rather than in the effect above is what lets "Renamed to X" survive the change that caused
  // it: an edit gives this component a new `rubric` object, which would otherwise wipe the only
  // evidence the rename happened.
  useEffect(() => {
    setNote(null);
    setConfirmingReplan(false);
  }, [rubricIndex]);

  const commitName = () => {
    const next = draftName.trim();
    if (!next || next === rubric.title) {
      setDraftName(rubric.title);
      return;
    }
    onChange({ ...rubric, title: next });
    setNote({ kind: 'ok', text: `Renamed to "${next}".` });
  };

  const applyPoints = () => {
    const wanted = Number(points);
    const current = canvasTotal(rubric);
    if (!Number.isFinite(wanted) || wanted <= 0) {
      setNote({ kind: 'refused', text: 'Enter a total above zero.' });
      return;
    }
    if (wanted === current) {
      setNote({ kind: 'refused', text: `Already worth ${current} points.` });
      return;
    }
    const next = rescaleRubric(rubric, Math.round(wanted));
    if (next === rubric) {
      // rescaleRubric returns the original when there are no points to scale from.
      setNote({
        kind: 'refused',
        text: 'This rubric has no points to rescale — the ratings carry no numbers.',
      });
      return;
    }
    onChange(next);
    setNote({
      kind: 'ok',
      text: `Rescaled from ${current} to ${canvasTotal(next)} points. Wording is unchanged; only the numbers moved.`,
    });
  };

  return (
    <div className="mb-4 bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden">
      {/*
        Heading wrapping the button, not the other way round: a <button> may hold phrasing
        content only, so an <h3> inside one is invalid and drops out of the heading list that
        screen-reader users navigate by. This is the ARIA accordion pattern.
      */}
      <h3 className="text-base font-bold text-gray-900">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="w-full flex items-center gap-2 p-4 text-left hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
        >
          {open ? (
            <ChevronDown className="w-4 h-4 text-gray-700 flex-shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-700 flex-shrink-0" aria-hidden="true" />
          )}
          <Pencil className="w-4 h-4 text-gray-700 flex-shrink-0" aria-hidden="true" />
          Adjust this rubric
          <span className="text-sm font-normal text-gray-600 ml-1">
            — rename it or change its points
          </span>
        </button>
      </h3>

      {open && (
        <div id={panelId} className="px-5 pb-5">
          <p className="text-sm text-gray-600 mb-4">
            Changes here are instant and keep every word as written. No AI involved.
          </p>

          <div className="grid sm:grid-cols-[1fr_auto] gap-4 items-end">
        <div>
          <label htmlFor={nameId} className="text-sm font-bold text-gray-900 block mb-2">
            Rubric name
          </label>
          <input
            id={nameId}
            type="text"
            value={draftName}
            disabled={busy}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitName();
              }
              if (e.key === 'Escape') setDraftName(rubric.title);
            }}
            className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl font-medium text-gray-900 focus:border-brand focus:outline-none transition-all disabled:bg-gray-100"
          />
          <p className="text-xs text-gray-600 mt-1">This is the name Canvas will show.</p>
        </div>

        <div>
          <label htmlFor={pointsId} className="text-sm font-bold text-gray-900 block mb-2">
            Total points
          </label>
          <div className="flex gap-2">
            <input
              id={pointsId}
              type="number"
              min={1}
              value={points}
              disabled={busy}
              onChange={(e) => setPoints(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyPoints();
                }
              }}
              className="w-28 px-4 py-2.5 border-2 border-gray-200 rounded-xl font-medium text-gray-900 focus:border-brand focus:outline-none transition-all disabled:bg-gray-100"
            />
            {/*
              An explicit button, not applied on change. Rescaling rewrites the points on every
              rating in the rubric, and doing that on each keystroke while someone types "100"
              would rescale to 1, then 10, then 100 — three lossy roundings instead of one.
            */}
            <button
              onClick={applyPoints}
              disabled={busy}
              className="px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-50 disabled:opacity-50 transition-all active:scale-95"
            >
              Rescale
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-1">Spread across the criteria as they are now.</p>
        </div>
      </div>

      {/*
        Mounted empty rather than rendered on demand: a live region that arrives with its text
        already inside it is announced unreliably. Same rule as Layout.tsx.
      */}
      <div
        role="status"
        aria-live="polite"
        className={
          note
            ? `mt-3 flex items-start gap-2 text-sm ${
                note.kind === 'ok' ? 'text-green-800' : 'text-gray-700'
              }`
            : 'sr-only'
        }
      >
        {note &&
          (note.kind === 'ok' ? (
            <Check className="w-4 h-4 flex-shrink-0 mt-0.5 text-green-600" aria-hidden="true" />
          ) : (
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-500" aria-hidden="true" />
          ))}
        {note && <span>{note.text}</span>}
      </div>

      {/*
        The Canvas warning. Editing here never touches a rubric already in the course, and
        deploying again creates a second one rather than replacing the first — Canvas's rubrics
        endpoint only takes a POST. Someone who renames and redeploys ends up with two rubrics
        with similar names and no indication of which is current.
      */}
      {deployedToCanvas && (
        <div className="mt-4 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle
            className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <p className="text-xs text-amber-900">
            <span className="font-bold">You have already deployed to Canvas.</span> Changes made
            here stay in this app — they do not update the rubrics already in your course.
            Deploying again adds a second copy rather than replacing the first, so delete the old
            one in Canvas if you redeploy.
          </p>
        </div>
      )}

      {onReplan && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          {!confirmingReplan ? (
            <button
              ref={replanRef}
              onClick={() => setConfirmingReplan(true)}
              disabled={busy}
              className="flex items-center gap-2 text-sm font-bold text-brand hover:text-brand-dark underline underline-offset-2 disabled:opacity-50 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              Choose the parts again and re-draft
            </button>
          ) : (
            <div className="p-4 bg-white border-2 border-brand rounded-xl">
              <p className="text-sm font-bold text-gray-900 mb-1">
                Re-draft from the assignment description?
              </p>
              <p className="text-sm text-gray-700 mb-3">
                This brings back the list of parts so you can change which ones get a rubric, their
                names and their points — then writes every ticked rubric again from scratch.
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
                    setConfirmingReplan(false);
                    onReplan();
                  }}
                  className="px-4 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand-dark transition-all active:scale-95"
                >
                  Choose the parts again
                </button>
                <button
                  onClick={() => {
                    setConfirmingReplan(false);
                    replanRef.current?.focus();
                  }}
                  className="px-4 py-2 bg-gray-100 text-gray-900 rounded-xl font-bold text-sm hover:bg-gray-200 transition-all"
                >
                  Keep what I have
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      </div>
      )}
    </div>
  );
};
