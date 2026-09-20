import React from 'react';
import { ListChecks, AlertCircle } from 'lucide-react';
import type { RubricPlanRow } from '../utils/rubricPlan';
import { planProblems, selectedRows } from '../utils/rubricPlan';

/**
 * Confirm what gets a rubric, before anything is generated.
 *
 * The model has read the description and proposed the parts it found. Nothing has been generated
 * at this point and nothing will be until the button below is pressed, which is the whole point:
 * what counts as a deliverable is a teaching decision, and a rubric made for something nobody
 * hands in costs a call and wastes the reviewer's time.
 *
 * It appears only when there is a real choice — a description with no separate parts goes
 * straight to its single rubric without stopping here.
 */
interface Props {
  rows: RubricPlanRow[];
  onChange: (rows: RubricPlanRow[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export const DeliverableChecklist: React.FC<Props> = ({
  rows,
  onChange,
  onConfirm,
  onCancel,
  busy = false,
}) => {
  const update = (id: string, patch: Partial<RubricPlanRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const problems = planProblems(rows);
  const chosen = selectedRows(rows).length;
  const found = rows.filter((r) => r.kind === 'deliverable').length;
  const allChosen = chosen === rows.length;

  /**
   * Ticks everything, or clears everything when it is already all ticked.
   *
   * Wording and placement copied from Canvas Extractor Tools, which puts "N of M selected —
   * Toggle all" at the right of its list header. The same people have both apps open, so a
   * control that does the same job should look the same in both rather than each inventing its
   * own. The count is worth having on its own: it is the only place the screen says what is
   * selected without reading the button.
   */
  const toggleAll = () => onChange(rows.map((r) => ({ ...r, selected: !allChosen })));

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
      <div className="flex items-start gap-3 mb-2">
        <ListChecks className="w-5 h-5 text-brand flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <h3 className="text-lg font-black text-gray-900">
            {found === 1
              ? 'This assignment looks like it has one separate part'
              : `This assignment looks like it has ${found} separate parts`}
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Tick what should get its own rubric. Nothing is created until you choose — you can
            rename anything here, and the name is what appears in Canvas.
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-end gap-3 text-xs">
        <span className="font-bold text-gray-600 tabular-nums">
          {chosen} of {rows.length} selected
        </span>
        <button
          onClick={toggleAll}
          className="font-bold text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
        >
          Toggle all
        </button>
      </div>

      <ul className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
        {rows.map((row) => (
          <li key={row.id} className="py-3 flex items-start gap-3">
            <input
              type="checkbox"
              id={`plan-${row.id}`}
              checked={row.selected}
              onChange={(e) => update(row.id, { selected: e.target.checked })}
              className="mt-2.5 w-4 h-4 accent-brand flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              {/* The visible name is editable because it becomes the Canvas rubric's name, and
                  deploying only ever adds — a name fixed afterwards means deleting by hand. */}
              <input
                type="text"
                value={row.title}
                onChange={(e) => update(row.id, { title: e.target.value })}
                aria-label={`Name for ${row.title || 'this rubric'}`}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg font-bold text-gray-900 text-sm focus:border-brand focus:outline-none"
              />
              {row.kind === 'whole' ? (
                <p className="text-xs text-gray-600 mt-1">
                  One rubric covering the assignment as a whole.
                </p>
              ) : (
                row.focus && <p className="text-xs text-gray-600 mt-1">{row.focus}</p>
              )}
            </div>
            <div className="flex-shrink-0">
              <label
                htmlFor={`points-${row.id}`}
                className="block text-[11px] font-bold text-gray-600 mb-1"
              >
                Points
              </label>
              <input
                id={`points-${row.id}`}
                type="text"
                inputMode="decimal"
                value={row.points}
                onChange={(e) => update(row.id, { points: e.target.value })}
                className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 tabular-nums focus:border-brand focus:outline-none"
              />
            </div>
          </li>
        ))}
      </ul>

      {problems.length > 0 && (
        <div role="alert" className="mt-4 flex items-start gap-2 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <ul className="space-y-1">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={onConfirm}
          disabled={busy || problems.length > 0}
          className="px-5 py-2.5 rounded-xl font-bold text-sm bg-brand text-white hover:bg-brand-dark transition-all disabled:bg-gray-200 disabled:text-gray-500"
        >
          {/* "Draft", not "Create": what comes back is a first pass to revise, and the screen
              after this one is built around changing it. A button that says Create promises a
              finished thing. */}
          {busy
            ? 'Drafting…'
            : chosen === 1
              ? 'Draft 1 rubric'
              : `Draft ${chosen} rubrics`}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-2.5 rounded-xl font-bold text-sm bg-gray-100 text-gray-900 hover:bg-gray-200 transition-all disabled:opacity-50"
        >
          Back
        </button>
        {/* Said plainly because it is the cost of ticking boxes, and it is not obvious that each
            rubric is its own request. */}
        {chosen > 1 && !busy && (
          <p className="text-xs text-gray-600">
            {chosen} separate requests, roughly {chosen * 10} seconds.
          </p>
        )}
      </div>
    </div>
  );
};

export default DeliverableChecklist;
