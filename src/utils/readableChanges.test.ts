import { describe, it, expect } from 'vitest';
import { changedRubricTitles, plainText } from './rubricFingerprint';
import type { RubricData } from '../types';

function rubric(title: string, text = 'Clear and organised.'): RubricData {
  const rating = (t: string, points: string) => ({ text: t, points });
  return {
    title,
    totalPoints: 10,
    criteria: [
      {
        category: 'Clarity',
        description: 'How clear the writing is.',
        exemplary: rating(text, '10-9'),
        proficient: rating('Mostly clear.', '9-7'),
        developing: rating('Sometimes clear.', '7-4'),
        unsatisfactory: rating('Unclear.', '4-0'),
        totalPoints: 10,
      },
    ],
  } as RubricData;
}

describe('plainText', () => {
  it('treats formatting that Google changes as no change at all', () => {
    expect(plainText('It\u2019s  “fine” \u2013 really\u00a0')).toBe('It\'s "fine" - really');
  });
});

describe('changedRubricTitles', () => {
  it('reports nothing when only punctuation style and spacing differ', () => {
    const before = [rubric('Part 1', "Doesn't miss a thing - ever.")];
    const after = [rubric('Part 1', 'Doesn\u2019t  miss a thing \u2013 ever. ')];
    expect(changedRubricTitles(before, after)).toEqual([]);
  });

  it('names a rubric whose wording changed, and only that one', () => {
    const before = [rubric('Part 1'), rubric('Part 2')];
    const after = [rubric('Part 1'), rubric('Part 2', 'Clear. MANUAL EDIT #1')];
    expect(changedRubricTitles(before, after)).toEqual(['Part 2']);
  });

  it('names a rubric whose points changed', () => {
    const before = [rubric('Part 1')];
    const after = [rubric('Part 1')];
    after[0].criteria[0].exemplary.points = '12-10';
    expect(changedRubricTitles(before, after)).toEqual(['Part 1']);
  });

  it('counts a rubric with no namesake as changed', () => {
    expect(changedRubricTitles([rubric('Part 1')], [rubric('Part 9')])).toEqual(['Part 9']);
  });
});
