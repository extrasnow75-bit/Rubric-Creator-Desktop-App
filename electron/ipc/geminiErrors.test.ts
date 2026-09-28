import { describe, it, expect } from 'vitest';
import {
  describeGeminiFailure,
  geminiFailureCulprit,
  geminiFailureMessage,
  isHardQuotaLimit,
  isKeyProblem,
  isModelMissing,
  isModelOverloaded,
  isTemporaryRateLimit,
} from './geminiErrors';

/**
 * The strings here are the real ones, copied from the app's own deployment timeline and from
 * Google's documented error bodies. A classifier tested against invented text proves nothing:
 * the whole failure this fixes was a predicate that matched 429 and not the 503 that actually
 * arrived.
 */
const OVERLOADED = new Error(
  'Failed to analyze "Various Rubrics For App Test.docx": {"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}',
);
const RATE_LIMITED = new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}');
const DAILY_CAP = new Error('429 RESOURCE_EXHAUSTED: quota exceeded, limit: 0');
const BAD_KEY = new Error('{"error":{"code":400,"status":"INVALID_ARGUMENT","message":"API key not valid. Please pass a valid API key."}}');
const GONE = new Error('{"error":{"code":404,"status":"NOT_FOUND","message":"models/gemini-x is not found"}}');

describe('isModelOverloaded', () => {
  it('recognises the 503 that broke the run', () => {
    expect(isModelOverloaded(OVERLOADED)).toBe(true);
  });

  it('recognises Google\'s other wording for the same thing', () => {
    expect(isModelOverloaded(new Error('The model is overloaded. Please try again later.'))).toBe(true);
    expect(isModelOverloaded(new Error('{"status":"UNAVAILABLE"}'))).toBe(true);
  });

  it('is not fooled by 503 appearing as part of a longer number', () => {
    expect(isModelOverloaded(new Error('rubric worth 15039 points'))).toBe(false);
  });

  it('does not claim a rate limit or a bad key', () => {
    expect(isModelOverloaded(RATE_LIMITED)).toBe(false);
    expect(isModelOverloaded(BAD_KEY)).toBe(false);
  });
});

describe('the classes stay apart', () => {
  it('separates a daily cap from a per-minute limit', () => {
    expect(isHardQuotaLimit(DAILY_CAP)).toBe(true);
    expect(isTemporaryRateLimit(DAILY_CAP)).toBe(false);

    expect(isHardQuotaLimit(RATE_LIMITED)).toBe(false);
    expect(isTemporaryRateLimit(RATE_LIMITED)).toBe(true);
  });

  it('reads a rejected key and a missing model', () => {
    expect(isKeyProblem(BAD_KEY)).toBe(true);
    expect(isModelMissing(GONE)).toBe(true);
    expect(isKeyProblem(GONE)).toBe(false);
  });

  it('claims nothing about an unrelated failure', () => {
    const other = new Error('Could not extract text from the Word document');
    expect(isModelOverloaded(other)).toBe(false);
    expect(isTemporaryRateLimit(other)).toBe(false);
    expect(isKeyProblem(other)).toBe(false);
    expect(isModelMissing(other)).toBe(false);
    expect(describeGeminiFailure(other)).toBeNull();
  });
});

describe('describeGeminiFailure names whose problem it is', () => {
  it('puts a busy service on Google, and rules out the key swap by name', () => {
    const { culprit, message } = describeGeminiFailure(OVERLOADED)!;
    expect(culprit).toBe('google-service');
    expect(message).toMatch(/at Google's end/i);
    // The wasted fix this exists to prevent: a new key, then a new key in another account.
    expect(message).toMatch(/new key/i);
    expect(message).toMatch(/any other/i);
    // And the advice the old message gave, which was never right for this.
    expect(message).not.toMatch(/shorten/i);
  });

  it('puts a spent allowance on the key without blaming the key', () => {
    const { culprit, message } = describeGeminiFailure(DAILY_CAP)!;
    expect(culprit).toBe('gemini-key');
    expect(message).toMatch(/resets tomorrow/i);
    expect(message).toMatch(/key itself is fine/i);
  });

  it('puts a rejected key on the key, and says so against the alternatives', () => {
    const { culprit, message } = describeGeminiFailure(BAD_KEY)!;
    expect(culprit).toBe('gemini-key');
    expect(message).toMatch(/Dashboard/);
    expect(message).toMatch(/not your Google sign-in/i);
    expect(message).toMatch(/not your Canvas token/i);
  });

  it('puts a withdrawn model on the app rather than the user', () => {
    const { culprit, message } = describeGeminiFailure(GONE)!;
    expect(culprit).toBe('app');
    expect(message).toMatch(/app's problem/i);
    expect(message).toMatch(/new key will not fix it/i);
  });

  it('prefers the daily cap over the rate limit when both could match', () => {
    // DAILY_CAP is a 429 too. Order matters, or "limit: 0" reads as "wait a minute".
    expect(describeGeminiFailure(DAILY_CAP)!.message).toMatch(/today/i);
  });

  it('clears the user\'s other credentials in every message it owns', () => {
    // Whatever the cause, the user should never be left wondering whether to go and replace
    // their Canvas token or their Google sign-in over an AI failure.
    for (const error of [OVERLOADED, DAILY_CAP, RATE_LIMITED, BAD_KEY]) {
      expect(describeGeminiFailure(error)!.message).toMatch(/Canvas token/i);
    }
  });
});

describe('geminiFailureCulprit', () => {
  it('reports unknown rather than guessing', () => {
    expect(geminiFailureCulprit(new Error('Could not extract text from the Word document'))).toBe(
      'unknown',
    );
    expect(geminiFailureCulprit(OVERLOADED)).toBe('google-service');
  });
});

describe('geminiFailureMessage', () => {
  it('passes an unrecognised failure through untouched', () => {
    expect(geminiFailureMessage(new Error('Could not extract text from the Word document'))).toBe(
      'Could not extract text from the Word document',
    );
  });

  it('says something rather than nothing when the error has no text', () => {
    expect(geminiFailureMessage(new Error(''))).toBe('The AI request failed without saying why.');
    expect(geminiFailureMessage(undefined)).toBe('The AI request failed without saying why.');
  });
});
