import React, { ReactNode } from 'react';

/**
 * One of the three routes on the opening screen.
 *
 * Each card is a pair of icons, a heading, a line of explanation, a single action and one
 * alternative. The pair is what distinguishes these from three unrelated buttons: the blue
 * rubric grid is the output of the first two cards and the input of the third, so reading down
 * the screen gives the whole workflow before anything is clicked.
 *
 * Three cards means three blue buttons, which looks at first like a breach of the one-primary
 * rule in DESIGN_SYSTEM.md. It is not: each card is a separate decision with one primary inside
 * it, the same shape Canvas Extractor Tools uses on its own home screen.
 */
interface Props {
  from: ReactNode;
  /** Background for the first tile — a Tailwind colour class, not a hex. */
  fromClass: string;
  to: ReactNode;
  toClass: string;
  title: string;
  description: string;
  action: string;
  onAction: () => void;
  /**
   * The quieter second route — omitted where there is no true one.
   *
   * On this screen it is the local-file path, for the person whose Google sign-in has just
   * failed: making them start a flow to find out there is a way through without Google is the
   * wrong order. It is optional because a card with no honest alternative must show none. A link
   * promising something its destination cannot do is worse than no link, and worst for exactly
   * the person who needed it.
   */
  alternative?: string;
  onAlternative?: () => void;
}

/** The app's own mark: a rubric table. Same grid as the title-bar icon, without the arrow. */
export const RubricGridIcon: React.FC = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="text-white"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <rect x="3" y="4" width="18" height="5" rx="2" fill="currentColor" stroke="none" />
    <path d="M3 14h18M9 9v11M15 9v11" />
  </svg>
);

/** Where rubrics end up. The same target the stepper uses for the Canvas step. */
export const CanvasTargetIcon: React.FC = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="text-white"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="0.6" fill="currentColor" />
  </svg>
);

export const RouteCard: React.FC<Props> = ({
  from,
  fromClass,
  to,
  toClass,
  title,
  description,
  action,
  onAction,
  alternative,
  onAlternative,
}) => (
  <div className="p-5 bg-white border border-gray-200 rounded-2xl">
    <div className="flex items-center gap-3">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${fromClass}`}>
        {from}
      </div>
      {/*
        Decorative: the heading underneath already says what turns into what, so a screen reader
        announcing "arrow right" between two icons it cannot describe would only add noise.
      */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-gray-400"
        aria-hidden="true"
      >
        <line x1="4" y1="12" x2="19" y2="12" />
        <polyline points="13 6 19 12 13 18" />
      </svg>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${toClass}`}>{to}</div>
    </div>

    <h3 className="mt-4 text-base font-bold text-gray-900">{title}</h3>
    <p className="mt-1.5 text-sm text-gray-700 leading-relaxed">{description}</p>

    <button
      type="button"
      onClick={onAction}
      className="w-full mt-4 px-4 py-3 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand-dark transition-all active:scale-95"
    >
      {action}
    </button>

    {alternative && onAlternative && (
      <div className="mt-2.5 text-center">
        <button
          type="button"
          onClick={onAlternative}
          className="text-sm text-brand hover:text-brand-dark underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          {alternative}
        </button>
      </div>
    )}
  </div>
);
