import { describe, it, expect } from 'vitest';
import { diagnoseCanvasError } from './diagnoseCanvasError';

/**
 * Every branch here is a claim about what the user should go and do, so a wrong match is worse
 * than no match: it sends someone to change their token when the course ID was the problem.
 *
 * The messages below are the real ones — ours copied from electron/ipc/canvas.ts, Canvas's taken
 * from what its API actually returns — rather than paraphrases that would pass whatever the
 * matcher happened to do.
 */
describe('diagnoseCanvasError', () => {
  describe('the app’s own messages', () => {
    it('sends a missing course to setup, and does not retry it', () => {
      const d = diagnoseCanvasError(
        'No Canvas course is chosen yet. Choose one under Target Canvas Course, or paste its address there.',
      );
      expect(d.action.kind).toBe('none'); // the course field is not in Initial Setup
      expect(d.fix).toMatch(/Target Canvas Course/);
      expect(d.transient).toBe(false);
    });

    it('sends a missing token to setup', () => {
      const d = diagnoseCanvasError(
        'No Canvas token is saved. Add one in Initial Setup so rubrics can be sent to your course.',
      );
      expect(d.action.kind).toBe('open-setup');
      expect(d.cause).toMatch(/token/i);
    });

    it('explains a host mismatch as an institution switch', () => {
      const d = diagnoseCanvasError(
        'That course is on a different Canvas site than the one you set up. ' +
          'Change the address under Target Canvas Course first if you meant to switch institutions.',
      );
      expect(d.action.kind).toBe('none');
      expect(d.transient).toBe(false);
    });

    it('handles an unavailable keychain without offering a useless retry', () => {
      const d = diagnoseCanvasError(
        'Your operating system keychain is not available, so credentials cannot be stored securely.',
      );
      expect(d.action.kind).toBe('none');
      expect(d.transient).toBe(false);
    });
  });

  describe('Canvas’s own responses', () => {
    it('reads "Invalid access token" as expiry rather than a malformed request', () => {
      const d = diagnoseCanvasError('Invalid access token.');
      expect(d.cause).toMatch(/expire|revoke/i);
      expect(d.action.kind).toBe('open-setup');
      // Canvas will keep rejecting a dead token, so retrying only slows the failure down.
      expect(d.transient).toBe(false);
    });

    it('distinguishes a permissions problem from a token problem', () => {
      const d = diagnoseCanvasError('user not authorized to perform that action');
      expect(d.cause).toMatch(/not allowed|permission/i);
      // Nothing in setup fixes an enrolment, so it must not send them there.
      expect(d.action.kind).toBe('none');
    });

    it('points a 404 at the course ID, not the token', () => {
      const d = diagnoseCanvasError('The specified resource does not exist.');
      expect(d.cause).toMatch(/no course with that ID|cannot see it/i);
      expect(d.fix).toMatch(/number at the end/i);
      expect(d.transient).toBe(false);
    });

    it('treats rate limiting as worth retrying', () => {
      const d = diagnoseCanvasError('403 Forbidden (Rate Limit Exceeded)');
      expect(d.transient).toBe(true);
      expect(d.action.kind).toBe('retry');
    });

    it('treats an unreachable Canvas as transient', () => {
      expect(diagnoseCanvasError('Could not reach Canvas: fetch failed').transient).toBe(true);
      expect(diagnoseCanvasError('getaddrinfo ENOTFOUND canvas.example.edu').transient).toBe(true);
    });

    it('treats a server error as Canvas’s problem and retryable', () => {
      const d = diagnoseCanvasError('Internal Server Error');
      expect(d.transient).toBe(true);
      expect(d.cause).toMatch(/their end|server error/i);
    });

    it('sends a rejected rubric to the CSV, not to setup', () => {
      const d = diagnoseCanvasError('criterion ratings: points cannot be blank');
      expect(d.fix).toMatch(/csv/i);
      expect(d.action.kind).toBe('none');
      expect(d.transient).toBe(false);
      // This is the one branch an AI repair can help with, and the only one that may offer it.
      expect(d.repairable).toBe(true);
    });
  });

  describe('ordering', () => {
    /**
     * Rate limiting arrives as a 403, and "Forbidden" also matches the permissions rule. The
     * rate-limit test above pins the precedence; this states why it matters.
     */
    it('reads a rate-limited 403 as rate limiting rather than a permissions problem', () => {
      const d = diagnoseCanvasError('Forbidden (Rate Limit Exceeded)');
      expect(d.transient).toBe(true);
    });

    /** "Invalid access token" contains "invalid", which the rubric-contents rule also matches. */
    it('reads an invalid token as a token problem rather than bad rubric contents', () => {
      const d = diagnoseCanvasError('Invalid access token.');
      expect(d.action.kind).toBe('open-setup');
    });
  });

  describe('offering an AI repair', () => {
    /**
     * A repair offer is a claim that the file is the problem. On a dead token or a wrong course it
     * is a false claim, and it sends someone to read a CSV that was never at fault.
     */
    it.each([
      'Invalid access token.',
      'The specified resource does not exist.',
      'user not authorized to perform that action',
      'Could not reach Canvas: fetch failed',
      'Internal Server Error',
      'No Canvas course is chosen yet. Choose one under Target Canvas Course, or paste its address there.',
      'Your operating system keychain is not available, so credentials cannot be stored securely.',
      'Something nobody has seen before',
    ])('does not offer to repair the CSV for %p', (message) => {
      expect(diagnoseCanvasError(message).repairable).toBe(false);
    });

    it('offers a repair for the ways Canvas words a bad rubric', () => {
      for (const message of [
        'criterion ratings: points cannot be blank',
        'ratings is invalid',
        'malformed rubric criteria',
      ]) {
        expect(diagnoseCanvasError(message).repairable).toBe(true);
      }
    });
  });

  describe('edge cases', () => {
    it.each([undefined, null, '', '   '])('handles %p without throwing', (input) => {
      const d = diagnoseCanvasError(input as string | undefined);
      expect(d.cause).toBeTruthy();
      expect(typeof d.transient).toBe('boolean');
    });

    it('matches regardless of capitalisation', () => {
      const lower = diagnoseCanvasError('invalid access token');
      const upper = diagnoseCanvasError('INVALID ACCESS TOKEN');
      expect(lower.cause).toBe(upper.cause);
    });

    it('always returns a usable cause and a boolean for an unknown message', () => {
      const d = diagnoseCanvasError('Something nobody has seen before');
      expect(d.cause).toBeTruthy();
      expect(d.transient).toBe(false);
    });
  });
  it('does not mistake a course number in a criterion name for a Canvas 5xx', () => {
    // The message quotes the user's rubric back at them, and the 5xx rule matches any bare
    // three-digit number starting with 5. A criterion named "Meets EDUC 502 outcomes" was
    // therefore diagnosed as a Canvas server error: wrong cause, a retry that could only fail
    // the same way, and repairable turned off — suppressing the one button that would fix it.
    const d = diagnoseCanvasError(
      'Every rating needs a single number in its Rating Points column, and one does not: ' +
        '"Meets EDUC 502 outcomes" -> "Exemplary" has "N/A".',
    );
    expect(d.repairable).toBe(true);
    expect(d.transient).toBe(false);
    expect(d.cause).not.toContain('server error');
  });

  it('still reports a genuine Canvas 5xx as one', () => {
    expect(diagnoseCanvasError('502 Bad Gateway').transient).toBe(true);
    expect(diagnoseCanvasError('Internal Server Error').repairable).toBe(false);
  });
});
