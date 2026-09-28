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
 * One sentence naming the cause, and one saying what to do about it.
 *
 * Ordered most specific first. An unrecognised error returns null rather than a guess — the
 * caller then shows Google's own text, which is more use than a sentence this function invented.
 */
export function describeGeminiFailure(error: unknown): string | null {
  if (isHardQuotaLimit(error)) {
    return "Your Gemini API key has used up its free requests for today. It resets tomorrow; there is nothing wrong with the key or the description.";
  }
  if (isModelOverloaded(error)) {
    return "Google's AI service is busy and turned the request away. This is at Google's end — not your key, your description, or this app. It usually clears within a few minutes.";
  }
  if (isTemporaryRateLimit(error)) {
    return "Gemini is limiting how fast requests can be sent. Waiting a minute and trying again usually clears it.";
  }
  if (isKeyProblem(error)) {
    return "Gemini would not accept the API key. Check the key on the Dashboard, or paste a fresh one from Google AI Studio.";
  }
  if (isModelMissing(error)) {
    return "Gemini no longer offers the model this app asks for. This one needs a fix in the app rather than anything you can change.";
  }
  return null;
}

/**
 * The line to show the user: the plain sentence when we recognise the failure, Google's own text
 * when we do not, and a short fallback when there is no text at all.
 */
export function geminiFailureMessage(error: unknown): string {
  const described = describeGeminiFailure(error);
  if (described) return described;
  const raw = textOf(error).trim();
  return raw || 'The AI request failed without saying why.';
}
