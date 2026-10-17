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
  /**
   * Whether this card's route is the one currently showing below.
   *
   * The button is a disclosure, not a one-way door: pressing it again puts the screen back to
   * the three cards, which is what every other expanding control in the app already does —
   * Request Changes, Upload Replacement and Start over all close themselves. Nothing is
   * discarded by closing; the route is hidden, not unloaded, so a half-written description and a
   * chosen file are both still there when it is opened again.
   */
  open?: boolean;
  /**
   * The id of the region this card's button opens.
   *
   * aria-expanded says a thing opened; aria-controls says which thing, which matters more here
   * than in most disclosures because what opens is nowhere near the button — three of the four
   * routes render in a different part of the page entirely. House style is both together; see
   * RubricAdjustPanel and CsvSaveOptions.
   */
  controls?: string;
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

/**
 * The rubric grid again, marked as revised.
 *
 * The star sits on the tile's corner rather than inside the 24px grid: inside, it competes with
 * the grid's own strokes and disappears. The outline is the tile's colour, so the points keep a
 * clean edge instead of dissolving into the blue — which matters here more than anywhere, since
 * both tiles on that card are the same blue and the star is the only thing telling them apart.
 */
export const RevisedRubricIcon: React.FC = () => (
  <span className="relative">
    <RubricGridIcon />
    <span className="absolute -top-2.5 -right-2.5 leading-none">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="#eab308"
        stroke="#1d4ed8"
        strokeWidth="2.5"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2.5l2.9 5.9 6.6.95-4.75 4.65 1.1 6.5L12 17.4l-5.85 3.1 1.1-6.5L2.5 9.35l6.6-.95z" />
      </svg>
    </span>
  </span>
);

/**
 * Canvas's own mark, drawn the way Canvas Extractor Tools draws it.
 *
 * Eight arc segments and eight dots around one centre, rather than a copied logo file — the same
 * geometry, so the two apps show the same thing to the same people on the same day. It replaces
 * a pair of concentric circles with a filled middle, which at 24px was a record button.
 */
export const CanvasLogoIcon: React.FC = () => (
  <svg width="24" height="24" viewBox="0 0 100 100" fill="#fff" aria-hidden="true">
    <path d="M 38 14 A 12 12 0 0 0 62 14 Z" />
    <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(45,50,50)" />
    <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(90,50,50)" />
    <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(135,50,50)" />
    <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(180,50,50)" />
    <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(225,50,50)" />
    <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(270,50,50)" />
    <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(315,50,50)" />
    <circle cx="50" cy="28" r="5" transform="rotate(22.5,50,50)" />
    <circle cx="50" cy="28" r="5" transform="rotate(67.5,50,50)" />
    <circle cx="50" cy="28" r="5" transform="rotate(112.5,50,50)" />
    <circle cx="50" cy="28" r="5" transform="rotate(157.5,50,50)" />
    <circle cx="50" cy="28" r="5" transform="rotate(202.5,50,50)" />
    <circle cx="50" cy="28" r="5" transform="rotate(247.5,50,50)" />
    <circle cx="50" cy="28" r="5" transform="rotate(292.5,50,50)" />
    <circle cx="50" cy="28" r="5" transform="rotate(337.5,50,50)" />
  </svg>
);

/** Kept for the stepper, which still uses the target for its Canvas step. */
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
  open = false,
  controls,
}) => (
  <div
    className={`p-5 bg-white rounded-2xl ${
      open ? 'border-2 border-brand' : 'border border-gray-200'
    }`}
  >
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
      {/* No overflow-hidden anywhere on this row: the revised-rubric star sits outside its
          icon's box on purpose, and a clipped star is a smudge. */}
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${toClass}`}>{to}</div>
    </div>

    <h3 className="mt-4 text-base font-bold text-gray-900">{title}</h3>
    <p className="mt-1.5 text-sm text-gray-700 leading-relaxed">{description}</p>

    <button
      type="button"
      onClick={onAction}
      aria-expanded={open}
      aria-controls={controls}
      className={`w-full mt-4 px-4 py-3 rounded-xl font-bold text-sm transition-all active:scale-95 ${
        open
          ? 'bg-brand/10 text-brand border-2 border-brand hover:bg-brand/20'
          : 'bg-brand text-white hover:bg-brand-dark'
      }`}
    >
      {/*
        An open card's button is the way back out, so it says so. Leaving it reading "Start from
        a description" while it closes what it started would be a button lying about itself. The
        card's own heading sits directly above, so one word is enough to say what is closing.
      */}
      {open ? 'Close' : action}
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
