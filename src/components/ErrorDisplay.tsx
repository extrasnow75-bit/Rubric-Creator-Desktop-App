import React, { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { splitDetails } from '../utils/errorDetails';

/**
 * Convert a raw error message into a user-friendly description.
 *
 * Pass `compact = true` to get a short 1-line version suitable for
 * compact card displays.  The default (compact = false) returns a fuller
 * explanation with actionable next steps.
 */
export function friendlyError(raw: string, compact = false): string {
  // Already written for a person by the main process: show it as it is.
  if (splitDetails(raw).details) return splitDetails(raw).plain;
  const msg = raw.toLowerCase();

  if (msg.includes('no gemini api key') || msg.includes('please enter your api key')) {
    return compact
      ? 'No API key — add one on the Dashboard.'
      : 'No Gemini API key is saved. Go to the Dashboard and enter your API key to continue.';
  }
  if (
    msg.includes('all available gemini models') ||
    msg.includes('over capacity or restricted')
  ) {
    return compact
      ? 'All AI models unavailable — quota likely exhausted.'
      : 'All AI models are currently unavailable for your API key. Your free-tier quota is likely exhausted. Go to the Dashboard, remove your key, then create a brand-new key at aistudio.google.com — choose "Create project" to get a fresh quota.';
  }
  if (
    (msg.includes('429') || msg.includes('resource_exhausted')) &&
    msg.includes('limit: 0')
  ) {
    return compact
      ? 'Daily quota exhausted — add a new API key to continue.'
      : 'Your daily AI quota is fully exhausted (limit: 0). Retrying won\'t help until the quota resets at midnight Pacific Time. To continue now, go to the Dashboard, remove your key, and create a brand-new key at aistudio.google.com using "+ Create project" for a fresh quota.';
  }
  if (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('too many requests') ||
    msg.includes('free_tier')
  ) {
    return compact
      ? 'Gemini rate limit hit — wait a moment and retry.'
      : 'Rate limit reached. The app is automatically retrying with delays. If it keeps failing after a minute, go to the Dashboard and replace your API key with a fresh one from Google AI Studio.';
  }
  if (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('api_key_invalid') ||
    msg.includes('invalid_api_key') ||
    msg.includes('permission denied') ||
    msg.includes('api key not valid')
  ) {
    return compact
      ? 'API key rejected — check your key on the Dashboard.'
      : 'Your Gemini API key was rejected. Go to the Dashboard and double-check your key, or replace it with a new one from Google AI Studio.';
  }
  if (msg.includes('404')) {
    return compact
      ? 'AI service not found — check AI Studio settings.'
      : 'The AI service could not be reached. Your API key may not have the Gemini API enabled — check your Google AI Studio settings.';
  }
  if (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('networkerror') ||
    msg.includes('connection')
  ) {
    return compact
      ? 'Network error — check your connection.'
      : 'A network error occurred. Please check your internet connection and try again.';
  }
  if (msg.includes('no rubric found') || msg.includes('no rubric')) {
    return compact
      ? 'No rubric found in the file.'
      : 'No rubric was found in the file. Please make sure the file contains a rubric table and try again.';
  }
  if (msg.includes('failed to read') || msg.includes('unsupported file')) {
    return compact
      ? 'Could not read the file — use .docx or .pdf.'
      : 'The file could not be read. Please use a .docx or .pdf file and try again.';
  }
  if (msg.includes('cancelled') || msg.includes('aborted')) {
    return compact ? 'Cancelled.' : 'The operation was cancelled.';
  }

  if (msg.includes('unexpected token') || msg.includes('in json') || msg.includes('json at position')) {
    return compact
      ? 'The AI gave an answer the app could not use — try again.'
      : "The AI gave an answer the app couldn't use. What to do: try again. If it fails again, send the technical details to the person who supports this app.";
  }

  return compact
    ? 'Request failed — try again.'
    : 'Something went wrong. What to do: try again. If it keeps happening, send the technical details to the person who supports this app.';
}

interface ErrorDisplayProps {
  error: string;
  className?: string;
  /** The message is already written for a person (not a raw Gemini error): show it as it is. */
  asWritten?: boolean;
}

/**
 * Shows a friendly plain-English error message with an optional expandable
 * "Show technical details" section containing the original raw error.
 */
const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error, className = '', asWritten = false }) => {
  const [showDetails, setShowDetails] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  // A message the main process already wrote for a person carries its own technical details.
  // It is shown as written: the keyword matching in friendlyError is for raw Gemini errors, and
  // would turn a Google sign-in problem into advice about an API key.
  const split = splitDetails(error);
  const friendly = split.details || asWritten ? split.plain : friendlyError(error);
  const technical = split.details ?? error;
  // Only show the details toggle when there is something beyond the friendly text
  const hasDetails = split.details !== undefined || error.length > 80 || error.includes('{') || error.includes('code":');

  const copy = () => {
    const done = (state: 'copied' | 'failed') => {
      setCopyState(state);
      setTimeout(() => setCopyState('idle'), 3000);
    };
    if (!navigator.clipboard?.writeText) return done('failed');
    navigator.clipboard.writeText(technical).then(() => done('copied'), () => done('failed'));
  };

  return (
    <div className={`p-4 bg-red-50 border border-red-200 rounded-2xl ${className}`}>
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          {/* role="alert" is on the sentence only. Putting it on the whole card made a screen reader
              read the technical text again whenever the details were opened or copied. */}
          <p role="alert" className="text-sm text-red-800 font-semibold leading-snug">{friendly}</p>

          {hasDetails && (
            <button
              onClick={() => setShowDetails(prev => !prev)}
              aria-expanded={showDetails}
              className="mt-1 py-1.5 flex items-center gap-1 text-xs text-red-700 hover:text-red-900 transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
            >
              {showDetails ? <ChevronUp className="w-3 h-3" aria-hidden="true" /> : <ChevronDown className="w-3 h-3" aria-hidden="true" />}
              {showDetails ? 'Hide technical details' : 'Show technical details'}
            </button>
          )}

          {showDetails && (
            <>
              <pre className="mt-1 text-xs text-red-900 bg-red-100 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                {technical}
              </pre>
              <button
                onClick={copy}
                className="mt-1 py-1.5 text-xs text-red-700 underline hover:text-red-900 transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
              >
                {copyState === 'copied' ? 'Copied' : 'Copy details'}
              </button>
            </>
          )}

          {/* Always mounted, so a screen reader announces the change. */}
          <span role="status" className="sr-only">
            {copyState === 'copied'
              ? 'Details copied to the clipboard.'
              : copyState === 'failed'
                ? 'Could not copy. Select the technical details and copy them by hand.'
                : ''}
          </span>
          {copyState === 'failed' && (
            <p className="mt-1 text-xs text-red-800" aria-hidden="true">Could not copy. Select the text above and copy it by hand.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ErrorDisplay;
