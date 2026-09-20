import React, { useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';

/**
 * Confirm before Start Over clears the session.
 *
 * This used to be raised only when there was something to lose, on the reasoning that a confirm
 * on every clear is one people learn to dismiss without reading. What changed that: Start Over
 * lives in a ribbon that reflows when the zoom changes, so pressing the zoom control can slide
 * the button under the cursor in time for the next click. That is a misfire the session state
 * knows nothing about, and it is the case the dialog most needs to catch.
 *
 * `hasUnsavedWork` therefore no longer decides whether to ask, only what to say — warning about
 * losing a rubric when no rubric exists is the sort of wrong detail that teaches people the
 * dialog is not worth reading.
 */
interface Props {
  isOpen: boolean;
  /** Decides the wording, not whether the dialog appears. */
  hasUnsavedWork: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const StartOverDialog: React.FC<Props> = ({ isOpen, hasUnsavedWork, onCancel, onConfirm }) => {
  // Focus lands on "Keep working", not on the destructive button: Enter on an unread dialog
  // should do the harmless thing.
  const keepRef = useRef<HTMLButtonElement>(null);
  const panelRef = useDialogFocus<HTMLDivElement>(isOpen, onCancel, { initialFocus: keepRef });

  if (!isOpen) return null;

  return (
    /*
      `overflow-y-auto` on the backdrop and `m-auto` on the panel, not `items-center`.

      Centring with `items-center` looks identical while the panel fits and fails badly when it
      does not: the overflow is split above and below, and the half above y=0 cannot be scrolled
      to at all. This dialog is three short paragraphs, so at 100% it never overflows — but the
      app has a text-size control that goes to 250%, and the whole reason this dialog exists is
      a misfire caused by changing that very setting. Someone at 250% could reach a confirm whose
      buttons were off the bottom of the window with no way to get to them.

      TaskCompletionDialog records the same fix; this is the pattern, not a one-off.
    */
    <div
      className="fixed inset-0 z-[110] flex overflow-y-auto overscroll-contain bg-black/40 p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-over-title"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 m-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-3">
          <RotateCcw className="w-5 h-5 text-gray-700 flex-shrink-0" aria-hidden="true" />
          <h2 id="start-over-title" className="text-lg font-black text-gray-900">
            Start over?
          </h2>
        </div>
        <p className="text-sm text-gray-700 mb-5">
          {hasUnsavedWork
            ? 'Anything you have not saved to your computer or to Google Drive will be gone. Rubrics already deployed to Canvas stay there, and your Gemini key, Canvas token and Google sign-in are kept.'
            : 'This clears the screen and takes you back to the start. Nothing you have made is waiting to be saved, and your Gemini key, Canvas token and Google sign-in are kept.'}
        </p>
        <div className="flex gap-2">
          <button
            ref={keepRef}
            onClick={onCancel}
            className="flex-1 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold hover:bg-gray-50 transition-all text-sm"
          >
            Keep working
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all text-sm"
          >
            Yes, start over
          </button>
        </div>
      </div>
    </div>
  );
};

export default StartOverDialog;
