import React, { useEffect, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { AppMode } from '../types';
import { CheckCircle, ArrowRight, RotateCw, Home, X, Power, ArrowLeft } from 'lucide-react';

interface TaskCompletionDialogProps {
  isOpen: boolean;
  currentStep: AppMode;
  onContinue: () => void;
  onNewBatch: () => void;
  onNewSession: () => void;
  onClose: () => void;
}

const TaskCompletionDialog: React.FC<TaskCompletionDialogProps> = ({
  isOpen,
  currentStep,
  onContinue,
  onNewBatch,
  onNewSession,
  onClose,
}) => {
  /**
   * This dialog appears automatically after every generation, conversion and upload, so it had
   * the widest reach of any accessibility gap in the app: it had no dialog role, took no focus,
   * trapped none, and ignored Escape. A screen-reader user got no signal it had opened and could
   * keep interacting with a page that was visually covered.
   */
  const dialogRef = useDialogFocus(isOpen, onClose);

  /**
   * Quitting is two clicks, and this is the second one's state.
   *
   * Reset whenever the dialog opens, so a confirm left on screen from a previous rubric is never
   * what greets the next one.
   */
  const [confirmingQuit, setConfirmingQuit] = useState(false);
  useEffect(() => {
    if (isOpen) setConfirmingQuit(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const getDialogContent = () => {
    switch (currentStep) {
      case AppMode.PART_1:
        return {
          title: '✓ Draft Rubric Created!',
          message: 'Your draft rubric has been generated successfully.',
          primaryAction: { label: 'Continue to Part 2: Convert to CSV', onClick: onContinue, icon: ArrowRight },
          secondaryActions: [
            // Sends them back to the rubric, where "Open in Google Docs" and "Save to this
            // computer" live. This used to be a "Download as .docx & Stop" button, which was
            // doubly wrong: the app stopped producing .docx in the desktop rewrite, and the
            // handler was never wired up, so the button did nothing at all when clicked.
            { label: 'Back to my rubric — save or download it', onClick: onClose, icon: ArrowLeft },
            { label: 'Create Another Rubric', onClick: onNewBatch, icon: RotateCw },
            { label: 'Return to Dashboard', onClick: onNewSession, icon: Home },
          ],
        };

      case AppMode.PART_2:
        return {
          title: '✓ CSV File Generated!',
          message: 'Your rubric has been successfully converted to Canvas-compatible CSV format.',
          primaryAction: { label: 'Continue to Part 3: Upload to Canvas', onClick: onContinue, icon: ArrowRight },
          secondaryActions: [
            { label: 'Back to my CSV — save or download it', onClick: onClose, icon: ArrowLeft },
            { label: 'Convert Another Rubric', onClick: onNewBatch, icon: RotateCw },
            { label: 'Return to Dashboard', onClick: onNewSession, icon: Home },
          ],
        };

      case AppMode.PART_3:
        return {
          title: '✓ Upload Complete!',
          message: 'Your rubric(s) have been successfully uploaded to Canvas.',
          primaryAction: { label: 'Upload More Rubrics (New Batch)', onClick: onNewBatch, icon: RotateCw },
          secondaryActions: [
            // "Start Fresh (New Session)" sat here too and called the very same handler, so the
            // dialog offered one action under two names.
            { label: 'Return to Dashboard', onClick: onNewSession, icon: Home },
          ],
        };

      default:
        return null;
    }
  };

  const content = getDialogContent();
  if (!content) return null;

  const getIconColor = () => {
    switch (currentStep) {
      case AppMode.PART_1:
        return 'text-amber-500';
      case AppMode.PART_2:
        return 'text-blue-700';
      case AppMode.PART_3:
        return 'text-green-500';
      default:
        return 'text-gray-600';
    }
  };

  return (
    /**
     * The backdrop scrolls, not the panel.
     *
     * This was `flex items-center justify-center` over a panel with no height limit, which looks
     * right until the panel is taller than the window — then centring pushes the top of it above
     * y=0, a fixed element has nothing to scroll, and the title, the close button and the first
     * options are simply unreachable. It was reported from the Part 1 dialog, the tallest of the
     * three, and it needs nothing unusual to hit: a 125% display scale, one press of Ctrl +, or a
     * laptop screen is enough.
     *
     * `m-auto` on the panel rather than `items-center` on the backdrop is what fixes it: auto
     * margins centre the panel while it fits and collapse to zero when it does not, so the
     * overflow all lands at the bottom where `overflow-y-auto` can reach it.
     */
    <div className="titlebar-no-drag fixed inset-0 bg-black bg-opacity-50 flex overflow-y-auto overscroll-contain p-4 z-40">
      <div
        ref={dialogRef as React.RefObject<HTMLDivElement>}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-completion-title"
        className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full m-auto relative"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-600 hover:text-gray-900 transition-colors"
          aria-label="Close this message"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Icon */}
        <div className="flex justify-center mb-4">
          <CheckCircle className={`w-16 h-16 ${getIconColor()}`} />
        </div>

        {/* Title */}
        <h2 id="task-completion-title" className="text-2xl font-black text-gray-900 text-center mb-2">
          {content.title}
        </h2>

        {/* Message */}
        <p className="text-gray-600 text-center mb-8">{content.message}</p>

        {/* Primary Action Button */}
        <button
          onClick={content.primaryAction.onClick}
          className="w-full py-4 bg-brand text-white rounded-2xl font-black uppercase tracking-widest hover:bg-brand-dark transition-all mb-3 flex items-center justify-center gap-2 active:scale-95"
        >
          {content.primaryAction.icon && (
            <content.primaryAction.icon className="w-5 h-5" />
          )}
          {content.primaryAction.label}
        </button>

        {/* Secondary Action Buttons */}
        <div className="space-y-2">
          {content.secondaryActions.map((action, index) => (
            <button
              key={index}
              onClick={action.onClick}
              className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all text-sm flex items-center justify-center gap-2"
            >
              {action.icon && <action.icon className="w-4 h-4" />}
              {action.label}
            </button>
          ))}
        </div>

        {/*
          Leaving, kept apart from the options above and behind a confirm.
          Every other button here assumes the user wants to carry on, and until now the only way
          out was the window's own close box — which is not an option the app ever offered in
          words. The confirm is not ceremony: after Part 1 and Part 2 the work exists only in
          memory until it is saved, so a single stray click here would throw away the very thing
          the dialog is announcing.
        */}
        <div className="mt-4 pt-4 border-t border-gray-200">
          {confirmingQuit ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm text-gray-800 text-center mb-3">
                Close the app? Anything you have not saved to your computer or to Google Drive
                will be gone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmingQuit(false)}
                  className="flex-1 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold hover:bg-gray-50 transition-all text-sm"
                >
                  Keep working
                </button>
                <button
                  onClick={() => void window.api.app.quit()}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all text-sm"
                >
                  Yes, close it
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingQuit(true)}
              className="w-full py-3 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-xl font-bold transition-all text-sm flex items-center justify-center gap-2"
            >
              <Power className="w-4 h-4" />
              No thanks — I&rsquo;m finished. Close the app.
            </button>
          )}
        </div>

        {/* Workflow Progress Indicator */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-600 text-center font-bold uppercase tracking-widest mb-3">
            Workflow Progress
          </p>
          <div className="flex gap-2 justify-center">
            {/* Part 1 - Blue */}
            <div
              className={`flex-1 h-2 rounded-full ${
                [AppMode.PART_1, AppMode.PART_2, AppMode.PART_3].includes(currentStep)
                  ? 'bg-blue-500'
                  : 'bg-gray-200'
              }`}
            />
            {/* Part 2 - Green */}
            <div
              className={`flex-1 h-2 rounded-full ${
                [AppMode.PART_2, AppMode.PART_3].includes(currentStep)
                  ? 'bg-green-500'
                  : 'bg-gray-200'
              }`}
            />
            {/* Part 3 - Red */}
            <div
              className={`flex-1 h-2 rounded-full ${
                currentStep === AppMode.PART_3 ? 'bg-red-500' : 'bg-gray-200'
              }`}
            />
          </div>
          <div className="flex gap-2 justify-center mt-2 text-xs text-gray-600">
            <span>Create</span>
            <span>Convert</span>
            <span>Upload</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskCompletionDialog;
