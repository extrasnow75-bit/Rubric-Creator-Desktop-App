import React from 'react';
import type { RubricData } from '../types';

/**
 * Move between the rubrics a run produced, one open at a time.
 *
 * Deliberately not a second editor. The rubric being looked at is still `state.rubric`, so the
 * table, the cell editing, "request changes" and the save buttons below are the same code they
 * were when a run made one rubric — this only changes which one they are pointed at. Building a
 * stacked view of all eight instead would have meant every one of those controls appearing eight
 * times.
 *
 * Hidden for a single rubric, where it would be a list of one.
 */
interface Props {
  rubrics: RubricData[];
  activeIndex: number;
  onOpen: (index: number) => void;
  /**
   * Indexes carrying a change request that has not been applied yet.
   *
   * Marked because writing requests across eight rubrics otherwise means clicking through all
   * of them to remember which ones you have already done.
   */
  pending?: number[];
}

export const RubricSwitcher: React.FC<Props> = ({ rubrics, activeIndex, onOpen, pending = [] }) => {
  const pendingSet = new Set(pending);
  if (rubrics.length < 2) return null;

  return (
    <nav aria-label="Generated rubrics" className="mb-5">
      <p className="text-xs font-black text-gray-600 uppercase tracking-widest mb-2">
        {rubrics.length} rubrics — showing {activeIndex + 1}
      </p>
      <ul className="flex flex-wrap gap-2">
        {rubrics.map((rubric, i) => {
          const active = i === activeIndex;
          const hasRequest = pendingSet.has(i);
          return (
            <li key={`${rubric.title}-${i}`}>
              <button
                onClick={() => onOpen(i)}
                aria-current={active ? 'true' : undefined}
                className={`px-3 py-1.5 rounded-xl text-sm font-bold border transition-all max-w-[18rem] truncate ${
                  active
                    ? 'bg-brand text-white border-brand'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
                title={
                  hasRequest ? `${rubric.title} — changes requested` : rubric.title
                }
              >
                {/* A dot rather than a count: what matters is which rubrics you have written
                    something for, not how much. The title attribute carries it for anyone who
                    cannot see the dot. */}
                {hasRequest && (
                  <span
                    aria-hidden="true"
                    className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${
                      active ? 'bg-white' : 'bg-amber-500'
                    }`}
                  />
                )}
                {rubric.title}
                {hasRequest && <span className="sr-only"> — changes requested</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {/* Edits are kept as you move: setRubric writes the open rubric back into the set, so
          switching away and back does not lose a change. Said here because a tab strip does not
          obviously promise that. */}
      <p className="text-xs text-gray-600 mt-2">
        Your edits are kept when you switch between them.
      </p>
    </nav>
  );
};

export default RubricSwitcher;
