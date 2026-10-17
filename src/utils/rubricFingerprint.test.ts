import { describe, it, expect } from 'vitest';
import { rubricsFingerprint } from './rubricFingerprint';
import type { RubricData } from '../types';

const rating = (text: string, points: string) => ({ text, points });

const rubric = (title: string): RubricData => ({
  title,
  totalPoints: 100,
  criteria: [
    {
      category: 'Clarity',
      description: 'Is the argument clear?',
      exemplary: rating('Very clear', '100-85'),
      proficient: rating('Mostly clear', '85-70'),
      developing: rating('Somewhat unclear', '70-50'),
      unsatisfactory: rating('Unclear', '50-0'),
      totalPoints: 100,
    },
  ],
});

describe('rubricsFingerprint', () => {
  it('is the same for the same rubrics', () => {
    expect(rubricsFingerprint([rubric('Essay')])).toBe(rubricsFingerprint([rubric('Essay')]));
  });

  it('changes when a rubric is renamed', () => {
    expect(rubricsFingerprint([rubric('Essay')])).not.toBe(
      rubricsFingerprint([rubric('Essay Rubric')]),
    );
  });

  /** The case the save button exists for: points moved, not a word changed. */
  it('changes when only the points move', () => {
    const before = rubric('Essay');
    const after = rubric('Essay');
    after.criteria[0].exemplary.points = '50-43';
    expect(rubricsFingerprint([before])).not.toBe(rubricsFingerprint([after]));
  });

  it('changes when a criterion is reworded', () => {
    const after = rubric('Essay');
    after.criteria[0].exemplary.text = 'Exceptionally clear';
    expect(rubricsFingerprint([rubric('Essay')])).not.toBe(rubricsFingerprint([after]));
  });

  it('changes when a criterion is added', () => {
    const after = rubric('Essay');
    after.criteria.push({ ...after.criteria[0], category: 'Evidence' });
    expect(rubricsFingerprint([rubric('Essay')])).not.toBe(rubricsFingerprint([after]));
  });

  /** Rubrics go into the document in order, so the document differs when the order does. */
  it('changes when two rubrics swap places', () => {
    const a = rubric('Part 1');
    const b = rubric('Part 2');
    expect(rubricsFingerprint([a, b])).not.toBe(rubricsFingerprint([b, a]));
  });

  it('does not confuse a field ending with the next beginning', () => {
    const left = rubric('Essay');
    left.criteria[0].category = 'Clarity of';
    left.criteria[0].description = 'argument';
    const right = rubric('Essay');
    right.criteria[0].category = 'Clarity';
    right.criteria[0].description = 'of argument';
    expect(rubricsFingerprint([left])).not.toBe(rubricsFingerprint([right]));
  });

  it('handles an empty set', () => {
    expect(rubricsFingerprint([])).toBe(rubricsFingerprint([]));
  });
});
