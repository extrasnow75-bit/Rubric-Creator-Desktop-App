/**
 * Turn a Canvas failure into a cause and a next step.
 *
 * Every deploy failure used to surface as one red line holding whatever text came back — some of
 * it ours, some of it Canvas's, none of it saying what to do. "No Canvas course is saved yet"
 * names a real cause but not the screen that fixes it; "Invalid access token" is Canvas's wording
 * for an expired token and reads like an accusation; a 500 is not the user's problem at all.
 *
 * This maps them. It is deliberately a pure function over the message text: the same strings are
 * produced in the main process, so they can be matched here without another IPC round trip, and
 * a pure function is one the tests can cover exhaustively — which matters, because every branch
 * here is a claim about what the user should go and do.
 *
 * Matching is on substrings rather than exact equality on purpose. Our own messages are stable,
 * but Canvas's come from its API and vary by version and instance, so the rules look for the
 * distinguishing phrase and fall back to something honest when nothing matches.
 */

/** What the app can offer to do about a failure. */
export type CanvasFixAction =
  /** Nothing the app can do; the text explains what the user must change. */
  | { kind: 'none' }
  /** Send the user to Initial Setup — a credential or the course URL is missing or wrong. */
  | { kind: 'open-setup'; label: string }
  /** Try the same request again; the failure looked temporary. */
  | { kind: 'retry'; label: string };

export interface CanvasDiagnosis {
  /** What went wrong, in the user's terms rather than the API's. */
  cause: string;
  /** What to do about it. Empty when there is genuinely nothing to suggest. */
  fix: string;
  /**
   * Whether repeating the identical request could plausibly succeed.
   *
   * Drives the one automatic retry. A wrong course ID or a rejected token never becomes right on
   * its own, and retrying those only makes a confusing failure slower.
   */
  transient: boolean;
  action: CanvasFixAction;
  /**
   * Whether editing the CSV could plausibly fix this.
   *
   * True only where Canvas objected to the rubric's own contents. Everything else — a dead token,
   * a wrong course, a 500 — is unaffected by anything in the file, and offering to repair it would
   * send the user off to inspect a CSV that was never the problem.
   *
   * This is a field rather than a match on `cause` because it is what gates the AI repair offer,
   * and a wording change to a message should not silently switch that offer on or off.
   */
  repairable: boolean;
}

/** Case-insensitive substring test, so Canvas's capitalisation does not matter. */
const has = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase());

export function diagnoseCanvasError(rawMessage: string | undefined | null): CanvasDiagnosis {
  const message = (rawMessage ?? '').trim();

  if (!message) {
    return {
      cause: 'Canvas rejected the rubric without saying why.',
      fix: 'Try again. If it keeps happening, deploy one rubric on its own to see the error.',
      transient: true,
      repairable: false,
      action: { kind: 'retry', label: 'Try again' },
    };
  }

  // ── Our own messages, from electron/ipc/canvas.ts ──────────────────────────
  // These name a cause already; what they lack is the screen that fixes it.

  // Checked before anything else, because this message is the only one that quotes the user's own
  // rubric back at them — and the branches below match on loose substrings of Canvas's wording.
  // A criterion named "Meets EDUC 502 outcomes" hits the 5xx test (/\b5\d{2}\b/) further down, so
  // a local validation failure was reporting as "Canvas had a server error", advising a retry that
  // could only fail identically, and turning off the repair offer this message exists to trigger.
  //
  // "Rating Points column" is our own phrasing from buildRubricPayload, verbatim and unique.
  if (has(message, 'Rating Points column')) {
    return {
      cause: 'Some ratings do not have a point value Canvas can use.',
      fix: 'Let the AI repair the file, or fix the point values listed above and upload it again.',
      transient: false,
      repairable: true,
      action: { kind: 'none' },
    };
  }

  if (has(message, 'No Canvas course is chosen')) {
    return {
      cause: 'No Canvas course has been chosen to deploy to.',
      fix: 'Choose a course under Target Canvas Course, then deploy again.',
      transient: false,
      repairable: false,
      action: { kind: 'none' },
    };
  }

  if (has(message, 'No Canvas token is saved')) {
    return {
      cause: 'No Canvas access token is saved, so the app cannot sign in to Canvas.',
      fix: 'Add your Canvas token in Initial Setup.',
      transient: false,
      repairable: false,
      action: { kind: 'open-setup', label: 'Open Initial Setup' },
    };
  }

  if (has(message, 'different Canvas site')) {
    return {
      cause: 'That course is on a different Canvas site than the one you set up.',
      fix: 'Change the address under Target Canvas Course if you meant to switch institutions.',
      transient: false,
      repairable: false,
      action: { kind: 'none' },
    };
  }

  if (has(message, 'not a recognized Canvas course URL')) {
    return {
      cause: 'The course URL is not in a form Canvas recognizes.',
      fix: 'Paste a link copied from inside your course — it should contain /courses/ and a number.',
      transient: false,
      repairable: false,
      action: { kind: 'none' },
    };
  }

  if (has(message, 'keychain is not available')) {
    return {
      cause: 'Your computer’s keychain is unavailable, so credentials could not be read.',
      fix: 'Sign out and back in to your computer, then try again. Nothing was saved insecurely.',
      transient: false,
      repairable: false,
      action: { kind: 'none' },
    };
  }

  // ── The app's own wording for Canvas failures (electron/ipc/canvasMessages.ts) ──
  // Matched on the plain sentence, ahead of the loose rules below, which would otherwise read
  // words in the technical details that follow it. A rubric Canvas rejected on its contents has
  // no rule here on purpose: it carries Canvas's own text, which the contents rule further down
  // needs in order to offer the repair.
  if (has(message, 'no longer accepts your saved access token')) {
    return {
      cause: 'Canvas rejected your access token. Tokens expire, and can be revoked.',
      fix: 'Generate a fresh token in Canvas under Account → Settings, and save it in Initial Setup.',
      transient: false,
      repairable: false,
      action: { kind: 'open-setup', label: 'Update my Canvas token' },
    };
  }
  if (has(message, 'isn’t allowed to do this in this course')) {
    return {
      cause: 'Your Canvas account is not allowed to add rubrics to that course.',
      fix: 'Check you are a teacher, designer or course administrator in the course, and that it is the right course.',
      transient: false,
      repairable: false,
      action: { kind: 'none' },
    };
  }
  if (has(message, 'can’t find this course')) {
    return {
      cause: 'Canvas has no course with that ID, or your account cannot see it.',
      fix: 'Check the number at the end of the course URL matches the course you want.',
      transient: false,
      repairable: false,
      action: { kind: 'none' },
    };
  }
  if (has(message, 'needs the app to slow down')) {
    return {
      cause: 'Canvas is rate-limiting the app for sending too many requests at once.',
      fix: 'Wait a few minutes and deploy again. Deploying fewer rubrics at a time also helps.',
      transient: true,
      repairable: false,
      action: { kind: 'retry', label: 'Try again' },
    };
  }
  if (has(message, 'is having trouble right now')) {
    return {
      cause: 'Canvas had a server error. This is a problem at their end, not with your rubric.',
      fix: 'Wait a few minutes and try again.',
      transient: true,
      repairable: false,
      action: { kind: 'retry', label: 'Try again' },
    };
  }
  if (has(message, 'can’t reach canvas')) {
    return {
      cause: 'The app could not reach Canvas.',
      fix: 'Check your internet connection and whether Canvas is up, then try again.',
      transient: true,
      repairable: false,
      action: { kind: 'retry', label: 'Try again' },
    };
  }

  if (has(message, 'rejected this rubric')) {
    // A 422 can also mean the course itself will not take a rubric (it has ended, or is locked).
    // The AI can only repair the file, so the offer is made only when Canvas's own reason is about
    // the rubric's contents.
    if (/criteri|rating|point|description|blank|invalid|malformed|title/i.test(message.split('Canvas replied')[1] ?? '')) {
      return {
        cause: 'Canvas rejected the rubric’s contents.',
        fix: 'Let the AI repair the file, or check the criteria and point values and upload it again.',
        transient: false,
        repairable: true,
        action: { kind: 'none' },
      };
    }
    return {
      cause: 'Canvas would not accept a rubric in that course.',
      fix: 'Check that the course is still open and that you are allowed to add rubrics to it, then try again.',
      transient: false,
      repairable: false,
      action: { kind: 'none' },
    };
  }
  // ── Canvas's own responses ────────────────────────────────────────────────

  // 401. Canvas says "Invalid access token", which sounds like the app sent something
  // malformed; in practice it means expired, revoked, or issued for a different site.
  if (
    has(message, 'invalid access token') ||
    has(message, 'unauthenticated') ||
    has(message, 'user authorisation required') ||
    has(message, 'user authorization required')
  ) {
    return {
      cause: 'Canvas rejected your access token. Tokens expire, and can be revoked.',
      fix: 'Generate a fresh token in Canvas under Account → Settings, and save it in Initial Setup.',
      transient: false,
      repairable: false,
      action: { kind: 'open-setup', label: 'Update my Canvas token' },
    };
  }

  if (has(message, 'rate limit') || has(message, 'too many requests') || has(message, '429')) {
    return {
      cause: 'Canvas is rate-limiting the app for sending too many requests at once.',
      fix: 'Wait a minute and deploy again. Deploying fewer rubrics at a time also helps.',
      transient: true,
      repairable: false,
      action: { kind: 'retry', label: 'Try again' },
    };
  }

  // 403. The token is valid but the account cannot edit this course.
  if (has(message, 'forbidden') || has(message, 'not authorized') || has(message, 'not authorised')) {
    return {
      cause: 'Your Canvas account is not allowed to add rubrics to that course.',
      fix: 'Check you are a teacher or designer in the course, and that the course is the right one.',
      transient: false,
      repairable: false,
      action: { kind: 'none' },
    };
  }

  if (
    has(message, 'does not exist') ||
    has(message, 'not found') ||
    has(message, '404')
  ) {
    return {
      cause: 'Canvas has no course with that ID, or your account cannot see it.',
      fix: 'Check the number at the end of the course URL matches the course you want.',
      transient: false,
      repairable: false,
      action: { kind: 'none' },
    };
  }

  if (
    has(message, 'could not reach canvas') ||
    has(message, 'network') ||
    has(message, 'econnrefused') ||
    has(message, 'enotfound') ||
    has(message, 'etimedout') ||
    has(message, 'fetch failed') ||
    has(message, 'socket hang up')
  ) {
    return {
      cause: 'The app could not reach Canvas.',
      fix: 'Check your internet connection and whether Canvas is up, then try again.',
      transient: true,
      repairable: false,
      action: { kind: 'retry', label: 'Try again' },
    };
  }

  // 5xx. Canvas's problem, not the user's, and often over in seconds.
  if (
    has(message, 'internal server error') ||
    has(message, 'bad gateway') ||
    has(message, 'service unavailable') ||
    has(message, 'gateway timeout') ||
    /\b5\d{2}\b/.test(message)
  ) {
    return {
      cause: 'Canvas had a server error. This is a problem at their end, not with your rubric.',
      fix: 'Wait a moment and try again.',
      transient: true,
      repairable: false,
      action: { kind: 'retry', label: 'Try again' },
    };
  }

  // The rubric data itself was rejected. Distinct from the causes above because nothing in
  // setup will fix it — the CSV needs changing.
  if (
    has(message, 'criterion') ||
    has(message, 'rating') ||
    has(message, 'points') ||
    has(message, 'blank') ||
    has(message, 'invalid') ||
    has(message, 'malformed')
  ) {
    return {
      cause: 'Canvas rejected the rubric’s contents.',
      fix:
        'Download the CSV, check the criteria and point values, then upload the corrected file ' +
        'in Part 3.',
      transient: false,
      repairable: true,
      action: { kind: 'none' },
    };
  }

  // Unmatched. Say so plainly rather than inventing a cause; the raw text is shown alongside.
  return {
    cause: 'Canvas refused the rubric.',
    fix: 'Try again. If it keeps happening, the message above is what Canvas reported.',
    transient: false,
    repairable: false,
    action: { kind: 'retry', label: 'Try again' },
  };
}
