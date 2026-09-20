import React, { useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';

/**
 * Confirm before Start Over throws away work that exists only in memory.
 *
 * Shown only when there is something to lose — see `hasUnsavedWork`. A confirm on every clear
 * would be the kind people learn to dismiss without reading, which is worse than none, because
 * then it is not there on the one occasion it matters.
 *
 * The same reasoning as the quit confirm in TaskCompletionDialog, and the same wording about
 * what "unsaved" means, since it is the same loss.
 */
interface Props {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const StartOverDialog: React.FC<Props> = ({ isOpen, onCancel, onConfirm }) => {
  // Focus lands on "Keep working", not on the destructive button: Enter on an unread dialog
  // should do the harmless thing.
  const keepRef = useRef<HTMLButtonElement>(null);
  const panelRef = useDialogFocus<HTMLDivElement>(isOpen, onCancel, { initialFocus: keepRef });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-over-title"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-3">
          <RotateCcw className="w-5 h-5 text-gray-700 flex-shrink-0" aria-hidden="true" />
          <h2 id="start-over-title" className="text-lg font-black text-gray-900">
            Start over?
          </h2>
        </div>
        <p className="text-sm text-gray-700 mb-5">
          Anything you have not saved to your computer or to Google Drive will be gone. Rubrics
          already deployed to Canvas stay there, and your Gemini key, Canvas token and Google
          sign-in are kept.
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
