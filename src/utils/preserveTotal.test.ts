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

/**
 * The second condition, from a real run on v0.9.23.
 *
 * "Add a criterion about APA formatting", then one about grammar. The model held Part 1 at its
 * 100 points by rewriting 40/40/20 into 35/35/30 and giving both new criteria nothing. Every
 * number added up; neither new criterion could move a grade.
 */
describe('a criterion worth nothing after an edit', () => {
  const partOne = rubric([40, 40, 20]);
  const withTwoDead = rubric([35, 35, 30, 0, 0]);

  it('gives the dead criteria a share and keeps the total at 100', () => {
    const settled = preserveTotalAcrossEdit(partOne, withTwoDead, 'Add criteria for APA formatting and grammar');
    const maxes = settled.criteria.map((c) => leadingPoints(c.exemplary));

    expect(canvasTotal(settled)).toBe(100);
    expect(maxes).toHaveLength(5);
    expect(Math.min(...maxes)).toBeGreaterThan(0);
  });

  it('splits it evenly rather than guessing a weight nobody argued for', () => {
    const settled = preserveTotalAcrossEdit(partOne, withTwoDead, 'Add criteria for APA formatting and grammar');
    const maxes = settled.criteria.map((c) => leadingPoints(c.exemplary));
    // 100 over five criteria is 20 each for the new ones; the other three shrink in proportion.
    expect(maxes[3]).toBe(20);
    expect(maxes[4]).toBe(20);
    expect(maxes[0]).toBeGreaterThan(maxes[2]);
  });

  it('writes a real band for the revived criterion, not a row of zeros', () => {
    const settled = preserveTotalAcrossEdit(partOne, withTwoDead, 'Add a grammar criterion');
    const revived = settled.criteria[3];
    expect(leadingPoints(revived.exemplary)).toBe(20);
    expect(leadingPoints(revived.proficient)).toBeGreaterThan(0);
    // Same notation as its siblings: a ranged rubric does not gain a single-value row.
    expect(revived.exemplary.points).toContain('-');
  });

  it('leaves a criterion alone that was already worth nothing before the edit', () => {
    const hadADeadOne = rubric([40, 40, 0]);
    const stillDead = rubric([50, 30, 0]);
    const settled = preserveTotalAcrossEdit(hadADeadOne, stillDead, 'Reword the first criterion');
    expect(leadingPoints(settled.criteria[2].exemplary)).toBe(0);
  });

  it('stands aside when the user asked about points', () => {
    const settled = preserveTotalAcrossEdit(partOne, withTwoDead, 'Add two criteria worth 0 points each');
    expect(settled).toBe(withTwoDead);
  });

  it('refuses a rubric too small to give every criterion a point', () => {
    const tiny = rubric([2, 1]);
    const tinyPlus = rubric([2, 1, 0, 0, 0]);
    const settled = preserveTotalAcrossEdit(tiny, tinyPlus, 'Add three criteria');
    expect(settled.criteria.map((c) => leadingPoints(c.exemplary))).toEqual([2, 1, 0, 0, 0]);
  });
});
