import { describe, expect, it } from 'vitest';
import {
  allocatePoints,
  applyPointSplit,
  canvasTotal,
  leadingPoints,
  rescaleRubric,
} from './rescaleRubric';
import type { RubricData } from '../types';

const rating = (points: string) => ({ text: 'some wording', points });

const criterion = (category: string, pts: [string, string, string, string], total: number) => ({
  category,
  description: 'what this criterion is about',
  exemplary: rating(pts[0]),
  proficient: rating(pts[1]),
  developing: rating(pts[2]),
  unsatisfactory: rating(pts[3]),
  totalPoints: total,
});

/** Five criteria of 15, the shape a 75-point generated rubric actually has. */
const singleStyle = (): RubricData => ({
  title: 'Wicked Problems Portfolio',
  totalPoints: 75,
  criteria: [
    criterion('Systems Analysis', ['15', '12', '9', '6'], 15),
    criterion('Ethical Frameworks', ['15', '12', '9', '6'], 15),
    criterion('Communication', ['15', '12', '9', '6'], 15),
    criterion('Strategy', ['15', '12', '9', '6'], 15),
    criterion('Portfolio', ['15', '12', '9', '6'], 15),
  ],
});

/** The range notation the other point style produces. */
const rangeStyle = (): RubricData => ({
  title: 'Ranged rubric',
  totalPoints: 100,
  criteria: [
    criterion('Analysis', ['50-40', '40-30', '30-20', '20-0'], 50),
    criterion('Writing', ['50-40', '40-30', '30-20', '20-0'], 50),
  ],
});

describe('leadingPoints', () => {
  it('reads a plain value', () => {
    expect(leadingPoints(rating('15'))).toBe(15);
  });

  it('reads the top of a range, which is what Canvas takes', () => {
    expect(leadingPoints(rating('25-20'))).toBe(25);
    expect(leadingPoints(rating('4 to >3 pts'))).toBe(4);
  });

  it('is zero when there is no number to read', () => {
    expect(leadingPoints(rating('see description'))).toBe(0);
  });
});

describe('allocatePoints', () => {
  /**
   * The case that makes largest-remainder necessary. Rounding each share on its own gives five
   * 11s totalling 55 — a fifth of the rubric gone, with nothing on screen to explain it.
   */
  it('lands exactly on the new total when the split is not clean', () => {
    const out = allocatePoints([15, 15, 15, 15, 15], 55);
    expect(out.reduce((a, b) => a + b, 0)).toBe(55);
    expect(out.every((n) => n === 11 || n === 12)).toBe(true);
  });

  it('keeps proportions when they divide cleanly', () => {
    expect(allocatePoints([50, 50], 100)).toEqual([50, 50]);
    expect(allocatePoints([30, 10], 80)).toEqual([60, 20]);
  });

  it('gives nothing to a criterion that was worth nothing', () => {
    expect(allocatePoints([10, 0, 10], 40)).toEqual([20, 0, 20]);
  });

  it('returns all zeros when there is nothing to scale from', () => {
    expect(allocatePoints([0, 0], 50)).toEqual([0, 0]);
  });

  it('handles a total smaller than the number of criteria', () => {
    const out = allocatePoints([15, 15, 15, 15, 15], 3);
    expect(out.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('rescaleRubric', () => {
  it('scales plain points and keeps the total exact', () => {
    const out = rescaleRubric(singleStyle(), 100);
    expect(canvasTotal(out)).toBe(100);
    expect(out.totalPoints).toBe(100);
    expect(out.criteria[0].exemplary.points).toBe('20');
    expect(out.criteria[0].proficient.points).toBe('16');
    expect(out.criteria[0].developing.points).toBe('12');
    expect(out.criteria[0].unsatisfactory.points).toBe('8');
  });

  it('scales both ends of a range and leaves the notation alone', () => {
    const out = rescaleRubric(rangeStyle(), 50);
    expect(out.criteria[0].exemplary.points).toBe('25-20');
    expect(out.criteria[0].unsatisfactory.points).toBe('10-0');
    expect(canvasTotal(out)).toBe(50);
  });

  it("preserves Canvas's own notation", () => {
    const rubric: RubricData = {
      title: 'Canvas notation',
      totalPoints: 8,
      criteria: [criterion('One', ['8 to >6 pts', '6 to >4 pts', '4 to >2 pts', '2 to >0 pts'], 8)],
    };
    const out = rescaleRubric(rubric, 4);
    expect(out.criteria[0].exemplary.points).toBe('4 to >3 pts');
    expect(out.criteria[0].unsatisfactory.points).toBe('1 to >0 pts');
  });

  /** The remainder has to land somewhere, and the top rating is what Canvas scores against. */
  it('makes the top ratings add up to the new total even when it divides badly', () => {
    const out = rescaleRubric(singleStyle(), 55);
    expect(canvasTotal(out)).toBe(55);
    expect(out.totalPoints).toBe(55);
    expect(out.criteria.map((c) => c.totalPoints).reduce((a, b) => a + b, 0)).toBe(55);
  });

  it('keeps the wording and the criteria untouched', () => {
    const before = singleStyle();
    const out = rescaleRubric(before, 30);
    expect(out.criteria.map((c) => c.category)).toEqual(before.criteria.map((c) => c.category));
    expect(out.criteria[0].exemplary.text).toBe(before.criteria[0].exemplary.text);
    expect(out.title).toBe(before.title);
  });

  it('does nothing when the total is unchanged', () => {
    const before = singleStyle();
    expect(rescaleRubric(before, 75)).toBe(before);
  });

  /** No proportions to preserve, so the caller is told nothing happened rather than shown zeros. */
  it('refuses a rubric with no points to scale from', () => {
    const empty: RubricData = {
      title: 'No points',
      totalPoints: 0,
      criteria: [criterion('One', ['see notes', 'see notes', 'see notes', 'see notes'], 0)],
    };
    expect(rescaleRubric(empty, 50)).toBe(empty);
  });

  it('refuses a negative total', () => {
    const before = singleStyle();
    expect(rescaleRubric(before, -10)).toBe(before);
  });

  it('survives a criterion worth nothing alongside real ones', () => {
    const rubric: RubricData = {
      title: 'Mixed',
      totalPoints: 20,
      criteria: [
        criterion('Real', ['20', '15', '10', '5'], 20),
        criterion('Unscored', ['see notes', 'see notes', 'see notes', 'see notes'], 0),
      ],
    };
    const out = rescaleRubric(rubric, 40);
    expect(out.criteria[0].exemplary.points).toBe('40');
    expect(out.criteria[1].exemplary.points).toBe('see notes');
    expect(canvasTotal(out)).toBe(40);
  });
});

describe('applyPointSplit', () => {
  /* The state this exists for: every criterion given the whole hundred-point budget. */
  const mis = (): RubricData => ({
    title: 'Part 2: The Internal Compass',
    totalPoints: 100,
    criteria: [
      criterion("Articulating the 'Why'", ['100-85', '85-70', '70-50', '50-0'], 100),
      criterion('Ethical Frameworks Application', ['100-85', '85-70', '70-50', '50-0'], 100),
      criterion('Authentic Leadership Alignment', ['100-85', '85-70', '70-50', '50-0'], 100),
    ],
  });

  it('applies a weighting that rescaling could never have produced', () => {
    const out = applyPointSplit(mis(), [50, 25, 25], 100)!;

    expect(out.criteria.map((c) => leadingPoints(c.exemplary))).toEqual([50, 25, 25]);
    expect(canvasTotal(out)).toBe(100);
    expect(out.totalPoints).toBe(100);
  });

  it('keeps every word, changing only the numbers', () => {
    const before = mis();
    const out = applyPointSplit(before, [50, 25, 25], 100)!;

    expect(out.criteria.map((c) => c.exemplary.text)).toEqual(
      before.criteria.map((c) => c.exemplary.text),
    );
    expect(out.criteria.map((c) => c.category)).toEqual(before.criteria.map((c) => c.category));
  });

  it('re-apportions shares that do not add up, rather than refusing them', () => {
    // A model returning 50/30/30 has a usable weighting and bad arithmetic. Keep the first.
    const out = applyPointSplit(mis(), [50, 30, 30], 100)!;

    expect(canvasTotal(out)).toBe(100);
    expect(leadingPoints(out.criteria[0].exemplary)).toBeGreaterThan(
      leadingPoints(out.criteria[1].exemplary),
    );
  });

  it('rounds fractional shares and still lands on the total exactly', () => {
    const out = applyPointSplit(mis(), [33.4, 33.3, 33.3], 100)!;

    expect(canvasTotal(out)).toBe(100);
  });

  it('refuses a reply of the wrong length', () => {
    expect(applyPointSplit(mis(), [50, 50], 100)).toBeNull();
    expect(applyPointSplit(mis(), [40, 20, 20, 20], 100)).toBeNull();
  });

  it('refuses negatives, non-numbers and an all-zero split', () => {
    expect(applyPointSplit(mis(), [-10, 60, 50], 100)).toBeNull();
    expect(applyPointSplit(mis(), [NaN, 50, 50], 100)).toBeNull();
    expect(applyPointSplit(mis(), [0, 0, 0], 100)).toBeNull();
  });

  it('refuses a total that is not a positive number', () => {
    expect(applyPointSplit(mis(), [50, 25, 25], 0)).toBeNull();
    expect(applyPointSplit(mis(), [50, 25, 25], NaN)).toBeNull();
  });

  it('does not mutate the rubric it is given', () => {
    const before = mis();
    applyPointSplit(before, [50, 25, 25], 100);

    expect(before.criteria.map((c) => c.exemplary.points)).toEqual(['100-85', '100-85', '100-85']);
  });
});
