/**
 * Turning a Gemini failure into a sentence a course designer can act on.
 *
 * Split into its own module for the same reason docxText was: a test can import it without
 * pulling Electron in behind credentials.ts.
 *
 * The problem this solves. Every Gemini call already failed with a perfectly clear message from
 * Google — "This model is currently experiencing high demand" — and nobody ever saw it. Part 1
 * caught the error, threw it away, and printed "Try again, or shorten the description", which
 * sent the user off editing a description that was never the problem, and then off to replace an
 * API key that was never the problem either. The cause and the advice have to match, or the
 * message is worse than no message.
 *
 * Everything here works on the error's text. That is what the rest of this file already did for
 * 429s, and it is what survives the trip: these errors arrive as an HTTP status and a JSON body
 * rendered into `error.message` by the SDK, not as a typed object with a status field.
 */

/** The error's text, however the SDK chose to wrap it. */
function textOf(error: unknown): string {
  return String((error as { message?: unknown })?.message ?? error ?? '');
}

/**
 * A hard daily cap — "limit: 0". Retrying cannot help; the key itself is spent for the day.
 */
export function isHardQuotaLimit(error: unknown): boolean {
  return textOf(error).includes('limit: 0');
}

/**
 * Too many requests, but the day's quota is intact — typically the per-minute ceiling.
 * Worth waiting out, but the wait is measured in minutes.
 */
export function isTemporaryRateLimit(error: unknown): boolean {
  const msg = textOf(error);
  return (
    (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) && !isHardQuotaLimit(error)
  );
}

/**
 * Google's own servers are busy — HTTP 503 / UNAVAILABLE.
 *
 * This is the one that brought down a whole eight-rubric run, and the one the retry logic did not
 * recognise: isTemporaryRateLimit matches 429 only, so a 503 fell through to "not a quota error —
 * stop" and failed on the first attempt. Google's own wording is that these spikes are usually
 * temporary, which makes it the most retryable failure of the lot and the one least deserving of
 * a minute between attempts.
 */
export function isModelOverloaded(error: unknown): boolean {
  const msg = textOf(error);
  return (
    msg.includes('UNAVAILABLE') ||
    /\b503\b/.test(msg) ||
    /model is overloaded/i.test(msg) ||
    /experiencing high demand/i.test(msg)
  );
}

/** The key is missing, malformed, or not permitted to call this API. */
export function isKeyProblem(error: unknown): boolean {
  const msg = textOf(error);
  return (
    /API_KEY_INVALID/i.test(msg) ||
    /API key not valid/i.test(msg) ||
    /PERMISSION_DENIED/.test(msg) ||
    /\b40[13]\b/.test(msg)
  );
}

/** The model id no longer resolves for this key. */
export function isModelMissing(error: unknown): boolean {
  const msg = textOf(error);
  return /NOT_FOUND/.test(msg) || (/\b404\b/.test(msg) && /model/i.test(msg));
}

/**
 * Whose problem it is.
 *
 * The field exists because of what users actually do when a run fails: they start replacing
 * things. A new Gemini key in the same Google account, then a new key in a different Google
 * account, then a look at the Canvas token — none of which touch a busy Google server, and each
 * of which costs real time and leaves the setup in a worse state than it started.
 *
 * So every message names the owner of the problem before it suggests anything, and where a
 * plausible wrong fix exists it is ruled out by name. "This is not your key" is worth more to
 * someone mid-failure than any amount of advice about what to try next.
 */
export type Culprit =
  /** Google's servers. Nothing in the user's setup is involved. */
  | 'google-service'
  /** The Gemini API key itself: rejected, or out of requests. */
  | 'gemini-key'
  /** The app's own code or configuration. */
  | 'app'
  /** Not established. The message passes Google's text through rather than assigning blame. */
  | 'unknown';

export interface GeminiFailure {
  culprit: Culprit;
  /** The full line shown to the user: what failed, whose it is, and what to do or not do. */
  message: string;
}

/**
 * What went wrong, who owns it, and what not to bother trying.
 *
 * Ordered most specific first — a daily cap is also a 429, so it has to be tested before the
 * general rate limit or it reads as "wait a minute" when the real answer is "wait until
 * tomorrow". An unrecognised failure returns null rather than a guess.
 */
export function describeGeminiFailure(error: unknown): GeminiFailure | null {
  if (isHardQuotaLimit(error)) {
    return {
      culprit: 'gemini-key',
      message:
        "Your Gemini API key has used up its free requests for today. The key itself is fine and there is nothing wrong with your Google account, your Canvas token or the assignment description — replacing any of them will not give you more requests. The allowance resets tomorrow.",
    };
  }
  if (isModelOverloaded(error)) {
    return {
      culprit: 'google-service',
      message:
        "Google's AI service is busy and turned the request away. This one is at Google's end: your Gemini key, your Google account, your Canvas token and your assignment description are all fine, and a new key — in this Google account or any other — will not help, because every key reaches the same busy service. It usually clears within a few minutes.",
    };
  }
  if (isTemporaryRateLimit(error)) {
    return {
      culprit: 'gemini-key',
      message:
        "Gemini is limiting how fast this key may send requests. Nothing is wrong with the key, your Google account or your Canvas token. Waiting a minute and trying again usually clears it.",
    };
  }
  if (isKeyProblem(error)) {
    return {
      culprit: 'gemini-key',
      message:
        "Gemini would not accept your API key. This is the key specifically — not your Google sign-in, not your Canvas token, and not Boise State's Canvas. Check it on the Dashboard, or paste a fresh one from Google AI Studio.",
    };
  }
  if (isModelMissing(error)) {
    return {
      culprit: 'app',
      message:
        "Gemini no longer offers the AI model this app asks for. This one is the app's problem, not yours — a new key will not fix it. Report it so the app can be pointed at a current model.",
    };
  }
  return null;
}

/**
 * The line to show the user: the plain sentence when we recognise the failure, Google's own text
 * when we do not, and a short fallback when there is no text at all.
 *
 * Nothing is invented. Where the failure is unrecognised the user gets Google's wording untouched
 * and no claim about whose fault it is, which is more honest than a confident guess and is what
 * lets a reported message be traced back to what actually happened.
 */
export function geminiFailureMessage(error: unknown): string {
  const described = describeGeminiFailure(error);
  if (described) return described.message;
  const raw = textOf(error).trim();
  return raw || 'The AI request failed without saying why.';
}

/** Whose problem it is, for anywhere that wants to label a failure rather than narrate it. */
export function geminiFailureCulprit(error: unknown): Culprit {
  return describeGeminiFailure(error)?.culprit ?? 'unknown';
}
