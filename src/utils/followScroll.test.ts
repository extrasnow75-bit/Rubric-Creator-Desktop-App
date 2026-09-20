import { describe, expect, it } from 'vitest';
import { BOTTOM_SLACK_PX, isPinnedToBottom } from './followScroll';

/** A box 200px tall holding 1000px of content, scrolled to `scrollTop`. */
const box = (scrollTop: number) => ({ scrollTop, scrollHeight: 1000, clientHeight: 200 });

describe('isPinnedToBottom', () => {
  it('is true at the exact bottom', () => {
    expect(isPinnedToBottom(box(800))).toBe(true);
  });

  it('is false when scrolled up to read something', () => {
    expect(isPinnedToBottom(box(400))).toBe(false);
  });

  it('is true at the top of a box with nothing to scroll', () => {
    expect(isPinnedToBottom({ scrollTop: 0, scrollHeight: 150, clientHeight: 200 })).toBe(true);
  });

  /**
   * Interface zoom leaves these numbers fractional, so a box flat against its end can report a
   * remainder just above zero. Without slack that reads as "the user scrolled up" and the log
   * stops following on its first line — at 110% zoom and nowhere else, which is the kind of bug
   * that never reproduces for whoever is fixing it.
   */
  it('treats a sub-pixel remainder as the bottom', () => {
    expect(isPinnedToBottom({ scrollTop: 799.6, scrollHeight: 1000, clientHeight: 200 })).toBe(true);
  });

  it('tolerates a nudge of the wheel but not a deliberate scroll up', () => {
    expect(isPinnedToBottom(box(800 - (BOTTOM_SLACK_PX - 1)))).toBe(true);
    expect(isPinnedToBottom(box(800 - (BOTTOM_SLACK_PX + 1)))).toBe(false);
  });

  it('honours a caller-supplied slack', () => {
    expect(isPinnedToBottom(box(750), 100)).toBe(true);
    expect(isPinnedToBottom(box(750), 10)).toBe(false);
  });
});
