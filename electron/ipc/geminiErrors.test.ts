import { describe, it, expect } from 'vitest';
import {
  describeGeminiFailure,
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

describe('describeGeminiFailure', () => {
  it('blames Google, not the user, for a 503', () => {
    const said = describeGeminiFailure(OVERLOADED)!;
    expect(said).toContain('busy');
    // The whole point: this is what the old message got wrong.
    expect(said).not.toMatch(/shorten/i);
    expect(said).toMatch(/not your key/i);
  });

  it('tells the user a daily cap resets rather than to replace the key', () => {
    const said = describeGeminiFailure(DAILY_CAP)!;
    expect(said).toMatch(/today/i);
    expect(said).toMatch(/nothing wrong with the key/i);
  });

  it('sends a rejected key to the Dashboard', () => {
    expect(describeGeminiFailure(BAD_KEY)).toMatch(/Dashboard/);
  });

  it('prefers the daily cap over the rate limit when both could match', () => {
    // DAILY_CAP is a 429 too. Order matters, or "limit: 0" reads as "wait a minute".
    expect(describeGeminiFailure(DAILY_CAP)).toMatch(/today/i);
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
