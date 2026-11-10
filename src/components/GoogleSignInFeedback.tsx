import React from 'react';
import { useSession } from '../contexts/SessionContext';
import ErrorDisplay from './ErrorDisplay';
import { SUPPORT_CONTACT } from '../utils/supportContact';

/**
 * What a person needs to see around any "Sign in with Google" button: that the app is waiting for
 * their browser (with a way to stop waiting), and, if sign-in failed, why.
 *
 * Google's "Access blocked" page never returns to the app, so without the Cancel button the only
 * way out was a three-minute timeout. And the error was shown only beside the button in Initial
 * Setup, so a failed sign-in from any other screen looked like nothing had happened.
 */
export const GoogleSignInFeedback: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { state, cancelGoogleAuth } = useSession();
  return (
    <div className={className}>
      {state.isAuthenticating && (
        <div role="status" className="mt-2 text-xs text-gray-700">
          <p className="font-bold">
            Waiting for Google in your browser. If Google shows &ldquo;Access blocked&rdquo;, close that tab and
            contact {SUPPORT_CONTACT}. The app stops waiting after 3 minutes.
          </p>
          <button
            onClick={cancelGoogleAuth}
            className="mt-1.5 py-1.5 px-3 rounded-lg border border-gray-400 bg-white font-bold text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Cancel sign-in
          </button>
        </div>
      )}
      {state.googleAuthError && !state.isAuthenticating && (
        <ErrorDisplay error={state.googleAuthError} asWritten className="mt-3" />
      )}
    </div>
  );
};
