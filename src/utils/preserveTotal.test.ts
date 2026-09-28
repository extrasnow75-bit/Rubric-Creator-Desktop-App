import { describe, it, expect } from 'vitest';
import { mentionsPoints, preserveTotalAcrossEdit } from './preserveTotal';
import { canvasTotal, leadingPoints } from './rescaleRubric';
import type { RubricData } from '../types';

const rating = (points: string) => ({ text: 'some wording', points });

/** A criterion worth `max`, written in the range notation a generated rubric actually uses. */
const criterion = (category: string, max: number) => ({
  category,
  description: 'what this criterion is about',
  exemplary: rating(`${max}-${Math.round(max * 0.85)}`),
  proficient: rating(`${Math.round(max * 0.85)}-${Math.round(max * 0.7)}`),
  developing: rating(`${Math.round(max * 0.7)}-${Math.round(max * 0.5)}`),
  unsatisfactory: rating(`${Math.round(max * 0.5)}-0`),
  totalPoints: max,
});

const rubric = (maxes: number[]): RubricData => ({
  title: 'Wicked Problems and Ethical Solutions Through Social Change Theory',
  totalPoints: maxes.reduce((a, b) => a + b, 0),
  criteria: maxes.map((m, i) => criterion(`Criterion ${i + 1}`, m)),
});

/**
 * The real case. Five criteria at 100 in a rubric the user set to 500; the request asks for a
 * grammar criterion and says nothing about points; the model returns six at 100, and 600 points
 * reach Canvas for an assignment worth 500.
 */
const before = rubric([100, 100, 100, 100, 100]);
const after = rubric([100, 100, 100, 100, 100, 100]);

describe('mentionsPoints', () => {
  it('is false for a request that is only about wording', () => {
    expect(mentionsPoints('Add a criterion for grammar and APA 7 formatting')).toBe(false);
    expect(mentionsPoints('Make the descriptions shorter and less repetitive')).toBe(false);
    expect(mentionsPoints('Remove the peer feedback criterion')).toBe(false);
  });

  it('is true wherever the user has said something about the numbers', () => {
    for (const said of [
      'Add a grammar criterion worth 50 points',
      'Make the first criterion 40 pts',
      'Reweight these so research counts for more',
      'The total should be 200',
      'Make it 25% of the grade',
      'Give writing a higher score',
      'Split it 50/50',
    ]) {
      expect(mentionsPoints(said), said).toBe(true);
    }
  });
});

describe('preserveTotalAcrossEdit', () => {
  it('holds the rubric at 500 when a criterion is added without mentioning points', () => {
    const settled = preserveTotalAcrossEdit(before, after, 'Add a criterion for grammar and APA 7 formatting');
    expect(canvasTotal(settled)).toBe(500);
    expect(settled.criteria).toHaveLength(6);
  });

  it('divides the budget across the new set rather than dropping the new row', () => {
    const settled = preserveTotalAcrossEdit(before, after, 'Add a grammar criterion');
    const maxes = settled.criteria.map((c) => leadingPoints(c.exemplary));
    expect(maxes).toHaveLength(6);
    // 500 over six criteria cannot divide evenly; largest-remainder puts the extra points on the
    // earlier rows rather than rounding the total away.
    expect(maxes.reduce((a, b) => a + b, 0)).toBe(500);
    expect(Math.min(...maxes)).toBeGreaterThan(0);
  });

  it('gives a removed criterion\'s share back to the rest', () => {
    const smaller = rubric([100, 100, 100, 100]);
    const settled = preserveTotalAcrossEdit(before, smaller, 'Remove the ethical frameworks criterion');
    expect(canvasTotal(settled)).toBe(500);
    expect(settled.criteria).toHaveLength(4);
  });

  it('stands aside when the user asked about points', () => {
    const settled = preserveTotalAcrossEdit(before, after, 'Add a grammar criterion worth 100 points');
    expect(canvasTotal(settled)).toBe(600);
    expect(settled).toBe(after);
  });

  it('leaves an edit that did not move the total completely alone', () => {
    const reworded = rubric([100, 100, 100, 100, 100]);
    const settled = preserveTotalAcrossEdit(before, reworded, 'Make the wording plainer');
    expect(settled).toBe(reworded);
  });

  it('refuses to rescale from or to a rubric with no readable points', () => {
    const unreadable: RubricData = { ...before, criteria: [] };
    expect(preserveTotalAcrossEdit(unreadable, after, 'Add a criterion')).toBe(after);
    expect(preserveTotalAcrossEdit(before, unreadable, 'Add a criterion')).toBe(unreadable);
  });
});
