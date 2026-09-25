import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { PointsFinding } from '../utils/rubricPoints';

interface Props {
  findings: PointsFinding[];
  /** What the ratings actually add up to, offered as the one-click way out. */
  actualTotal: number;
  /** Accept the criteria as drafted and bring the stated total in line with them. */
  onAccept: () => void;
}

/**
 * The points a rubric claims, where they disagree with the points it carries.
 *
 * This warns rather than fixes on purpose. A rubric drafted for 100 points whose criteria add up
 * to 300 has two defensible repairs — rescale the criteria down to 100, or accept that it is a
 * 300-point rubric — and which one is right is a weighting decision about the assignment, not
 * arithmetic. So both are offered and neither happens on its own.
 *
 * Amber, not red: nothing here is broken. Every number is a real number Canvas will accept, and
 * the deploy button stays live. What is wrong is that the rubric will not be worth what whoever
 * drafted it was aiming for, which is a thing to notice, not a thing to block.
 */
export const RubricPointsWarning: React.FC<Props> = ({ findings, actualTotal, onAccept }) => {
  if (findings.length === 0) return null;

  const hasTotalFinding = findings.some((finding) => finding.kind === 'total');

  return (
    <div className="mb-6 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <h4 className="text-sm font-bold text-amber-900">Check this rubric's points</h4>

        <ul className="mt-1 space-y-1">
          {findings.map((finding, i) => (
            <li key={i} className="text-sm text-amber-900">
              {finding.text}
            </li>
          ))}
        </ul>

        {hasTotalFinding && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              onClick={onAccept}
              className="px-3 py-1.5 rounded-xl text-sm font-bold bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              Make it {actualTotal} points
            </button>
            <span className="text-xs text-amber-800">
              Or set the total you meant in <strong>Adjust this rubric</strong> below, which
              rescales every criterion to fit it.
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
