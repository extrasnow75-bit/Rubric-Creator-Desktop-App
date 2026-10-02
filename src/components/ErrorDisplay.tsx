import React, { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Convert a raw error message into a user-friendly description.
 *
 * Pass `compact = true` to get a short 1-line version suitable for
 * compact card displays.  The default (compact = false) returns a fuller
 * explanation with actionable next steps.
 */
export function friendlyError(raw: string, compact = false): string {
  const msg = raw.toLowerCase();

  // BoiseState.ai errors are written for the user already, and name the real fix (a key that
  // expires every 90 days, a spent monthly allowance). The Gemini wording below would send them
  // to Google AI Studio for a key that has nothing to do with it.
  if (msg.includes('boisestate.ai')) return raw;

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

  return compact
    ? 'Request failed — try again.'
    : 'Something went wrong. Please try again. If the problem continues, check your API key on the Dashboard.';
}

interface ErrorDisplayProps {
  error: string;
  className?: string;
}

/**
 * Shows a friendly plain-English error message with an optional expandable
 * "Show technical details" section containing the original raw error.
 */
const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error, className = '' }) => {
  const [showDetails, setShowDetails] = useState(false);
  const friendly = friendlyError(error);
  // Only show the details toggle when the raw message adds something beyond the friendly text
  const hasDetails = error.length > 80 || error.includes('{') || error.includes('code":');

  return (
    // role="alert": a failed generation or upload was previously silent to assistive tech
    // unless the user happened to be focused nearby.
    <div role="alert" className={`p-4 bg-red-50 border border-red-200 rounded-2xl ${className}`}>
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-red-800 font-semibold leading-snug">{friendly}</p>

          {hasDetails && (
            <button
              onClick={() => setShowDetails(prev => !prev)}
              className="mt-2 flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors"
            >
              {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showDetails ? 'Hide technical details' : 'Show technical details'}
            </button>
          )}

          {showDetails && (
            <pre className="mt-2 text-xs text-red-600 bg-red-100 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {error}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};

export default ErrorDisplay;
