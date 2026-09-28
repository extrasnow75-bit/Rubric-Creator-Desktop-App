import React from 'react';
import { ProgressState } from '../types';
import { Loader2, StopCircle, Clock, Zap } from 'lucide-react';
import { useSession } from '../contexts/SessionContext';

interface ProgressDisplayProps {
  progress: ProgressState;
  onStop?: () => void;
}

const formatTime = (ms: number): string => {
  if (ms < 0) return '0s';
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / 1000 / 60) % 60);
  const hours = Math.floor(ms / 1000 / 60 / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ progress, onStop }) => {
  const { requestCancel } = useSession();

  if (!progress.isProcessing) {
    return null;
  }

  const percentage = Math.min(100, Math.round(progress.percentage * 100));
  const showItemCount = progress.totalItems > 1;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-blue-50 border-t-4 border-blue-600 p-4 shadow-2xl z-50">
      <div className="max-w-6xl mx-auto">
        {/* Header Row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 flex-1">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
            {/*
              role="status" on the step text only. A generation runs for tens of seconds to
              minutes, and without this a screen-reader user gets no feedback at all. Deliberately
              not wrapping the percentage: it changes ten times a second, and announcing that
              would be worse than announcing nothing.
            */}
            <div className="min-w-0 flex-1" role="status" aria-live="polite">
              <p className="text-sm font-bold text-gray-900">{progress.currentStep}</p>
              {showItemCount && (
                <p className="text-xs text-gray-600">
                  {progress.itemsProcessed} of {progress.totalItems} items processed
                </p>
              )}
              {/*
                Amber, and inside the existing status region so it is announced when it appears.
                Amber rather than red because nothing has failed — the app is recovering — and
                rather than grey because a line nobody notices does not answer the question the
                user is actually asking, which is whether this thing has stopped.
              */}
              {progress.waitingNote && (
                <p className="text-xs text-amber-700 font-bold mt-0.5">{progress.waitingNote}</p>
              )}
            </div>
          </div>

          {/* Time Estimates */}
          <div className="flex items-center gap-4 mr-4 text-xs">
            <div className="flex items-center gap-1 text-gray-700">
              <Clock className="w-4 h-4 flex-shrink-0" />
              <span>Elapsed: {formatTime(progress.timeElapsed)}</span>
            </div>
            {progress.timeRemaining > 0 && (
              <div className="flex items-center gap-1 text-blue-700 font-bold bg-blue-100 px-2 py-1 rounded">
                <Zap className="w-4 h-4 flex-shrink-0" />
                <span>Est. total: {formatTime(progress.timeElapsed + progress.timeRemaining)}</span>
              </div>
            )}
          </div>

          {/* Stop Button */}
          {progress.canCancel && (
            <button
              onClick={() => {
                requestCancel();
                onStop?.();
              }}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all flex items-center gap-2 text-sm font-bold"
            >
              <StopCircle className="w-4 h-4" />
              Stop
            </button>
          )}
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className="bg-gradient-to-r from-blue-500 to-blue-600 h-full transition-all duration-300 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* Percentage */}
        <div className="text-right mt-2">
          <span className="text-xs font-bold text-gray-700">{percentage}%</span>
        </div>
      </div>
    </div>
  );
};

export default ProgressDisplay;
