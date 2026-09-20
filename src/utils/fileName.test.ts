import { describe, expect, it } from 'vitest';
import { safeFileName } from './fileName';

describe('safeFileName', () => {
  it('keeps a readable title readable', () => {
    expect(safeFileName('Module 1 Discussion')).toBe('Module 1 Discussion');
  });

  /**
   * The reason this helper exists. The old `[^a-z0-9]` version turned this into
   * `Module_1__Discussion`, and a zip of twenty-six of those is hard to read.
   */
  it('replaces only what a filesystem refuses', () => {
    expect(safeFileName('Module 1: Discussion')).toBe('Module 1_ Discussion');
    expect(safeFileName('Before/After')).toBe('Before_After');
    expect(safeFileName('What is "good" work?')).toBe('What is _good_ work_');
  });

  it('keeps hyphens, apostrophes and accents', () => {
    expect(safeFileName("Week 3 — Peer Critique (Ana's group)")).toBe(
      "Week 3 — Peer Critique (Ana's group)",
    );
  });

  /** Tabs and nulls included — legal on Linux, a menace in a zip opened on Windows. */
  it('strips control characters', () => {
    expect(safeFileName('Part\u00001\tTwo')).toBe('Part1Two');
    expect(safeFileName('Line\nBreak')).toBe('LineBreak');
  });

  /** Windows drops a trailing dot or space, which silently collides two rubrics into one file. */
  it('trims trailing dots and spaces', () => {
    expect(safeFileName('Part 1.')).toBe('Part 1');
    expect(safeFileName('Part 1   ')).toBe('Part 1');
  });

  it('falls back when nothing usable survives', () => {
    expect(safeFileName('///')).toBe('___');
    expect(safeFileName('')).toBe('rubric');
    expect(safeFileName('   ')).toBe('rubric');
    expect(safeFileName('...')).toBe('rubric');
  });
});
