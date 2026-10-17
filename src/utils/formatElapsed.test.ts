import { describe, it, expect } from 'vitest';
import { formatElapsed } from './formatElapsed';

describe('formatElapsed', () => {
  it('reports whole seconds under a minute', () => {
    expect(formatElapsed(3)).toBe('3 seconds');
    expect(formatElapsed(3.4)).toBe('3 seconds');
    expect(formatElapsed(59)).toBe('59 seconds');
  });

  it('says one second rather than 1 seconds', () => {
    expect(formatElapsed(1)).toBe('1 second');
  });

  /** Zero reads as a measurement that failed, which is not what a fast run deserves. */
  it('says under a second rather than nothing', () => {
    expect(formatElapsed(0)).toBe('under a second');
    expect(formatElapsed(0.4)).toBe('under a second');
  });

  it('breaks into minutes above sixty seconds', () => {
    expect(formatElapsed(60)).toBe('1 minute');
    expect(formatElapsed(65)).toBe('1 minute 5 seconds');
    expect(formatElapsed(125)).toBe('2 minutes 5 seconds');
  });

  /** "2 minutes 0 seconds" is how a clock talks, not a person. */
  it('drops the seconds when there are none', () => {
    expect(formatElapsed(120)).toBe('2 minutes');
  });

  it('rounds up into the next minute', () => {
    expect(formatElapsed(59.6)).toBe('1 minute');
  });

  it('refuses to invent a figure it does not have', () => {
    expect(formatElapsed(Number.NaN)).toBe('an unknown time');
    expect(formatElapsed(-1)).toBe('an unknown time');
  });
});
