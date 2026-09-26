import { describe, expect, it } from 'vitest';
import {
  checkRubricPoints,
  hasPointsProblem,
  readBand,
  repairRatingBands,
  rubricsWithPointsProblems,
  settleStatedTotal,
} from './rubricPoints';
import { canvasTotal, rescaleRubric } from './rescaleRubric';
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

const rubric = (
  title: string,
  criteria: ReturnType<typeof criterion>[],
  totalPoints: number,
): RubricData => ({ title, criteria, totalPoints });

/*
 * The two rubrics the checks were written for, transcribed from the run that exposed the bug.
 * "Part 2" gave every criterion the whole hundred-point budget and then reported the budget as
 * the total; "Part 5" is correct apart from one overlapping band.
 */
const part2 = rubric(
  'Part 2: The Internal Compass',
  [
    criterion("Articulating the 'Why'", ['100-85', '85-70', '70-50', '50-0'], 100),
    criterion('Ethical Frameworks Application', ['100-85', '85-70', '70-50', '50-0'], 100),
    criterion('Authentic Leadership Alignment', ['100-85', '85-70', '70-50', '50-0'], 100),
  ],
  100,
);

const part5 = rubric(
  'Part 5: The 2050 Retrospective',
  [
    criterion('Future Narrative Construction', ['40-32', '32-24', '24-12', '12-0'], 40),
    criterion('Ethical Conflict Resolution', ['40-32', '32-24', '24-12', '12-0'], 40),
    criterion('Integration of Social Change Theory', ['20-16', '20-12', '12-6', '6-0'], 20),
  ],
  100,
);

describe('readBand', () => {
  it('reads a plain range', () => {
    expect(readBand('100-85')).toEqual({ top: 100, bottom: 85 });
  });

  it("reads Canvas's own notation", () => {
    expect(readBand('4 to >3 pts')).toEqual({ top: 4, bottom: 3 });
  });

  it('reads a decimal range', () => {
    expect(readBand('4-3.5 points')).toEqual({ top: 4, bottom: 3.5 });
  });

  it('returns null for a fixed rating, which has no band', () => {
    expect(readBand('15 pts')).toBeNull();
    expect(readBand('15')).toBeNull();
  });

  it('returns null for a reversed pair rather than guessing which bound was meant', () => {
    expect(readBand('40-50')).toBeNull();
  });

  it('returns null for text with no numbers', () => {
    expect(readBand('')).toBeNull();
    expect(readBand('see description')).toBeNull();
  });
});

describe('repairRatingBands', () => {
  it('lines up the overlap that shipped in Part 5', () => {
    const { rubric: fixed, fixes } = repairRatingBands(part5);

    expect(fixed.criteria[2].proficient.points).toBe('16-12');
    expect(fixes).toEqual([
      {
        criterion: 'Integration of Social Change Theory',
        level: 'Proficient',
        from: '20-12',
        to: '16-12',
      },
    ]);
  });

  it('leaves the two correct criteria in that rubric untouched', () => {
    const { rubric: fixed } = repairRatingBands(part5);

    expect(fixed.criteria[0]).toEqual(part5.criteria[0]);
    expect(fixed.criteria[1]).toEqual(part5.criteria[1]);
  });

  it('reports no fixes for a rubric that already chains', () => {
    const { rubric: fixed, fixes } = repairRatingBands(part2);

    expect(fixes).toEqual([]);
    expect(fixed.criteria).toEqual(part2.criteria);
  });

  it('closes a gap as well as an overlap', () => {
    const gapped = rubric('gapped', [criterion('c', ['40-32', '30-24', '24-12', '12-0'], 40)], 40);
    const { rubric: fixed } = repairRatingBands(gapped);

    expect(fixed.criteria[0].proficient.points).toBe('32-24');
  });

  it('keeps the wording around the numbers', () => {
    const wordy = rubric(
      'wordy',
      [criterion('c', ['4 to >3 pts', '4 to >2 pts', '2 to >1 pts', '1 to >0 pts'], 4)],
      4,
    );
    const { rubric: fixed } = repairRatingBands(wordy);

    expect(fixed.criteria[0].proficient.points).toBe('3 to >2 pts');
  });

  it('leaves fixed-style ratings completely alone', () => {
    const fixedStyle = rubric(
      'fixed',
      [criterion('c', ['15 pts', '10 pts', '5 pts', '0 pts'], 15)],
      15,
    );
    const { rubric: out, fixes } = repairRatingBands(fixedStyle);

    expect(fixes).toEqual([]);
    expect(out.criteria).toEqual(fixedStyle.criteria);
  });

  it('refuses a correction that would invert a band', () => {
    // Proficient's floor (18) sits above Exemplary's (16), so there is no top bound that works.
    const impossible = rubric(
      'impossible',
      [criterion('c', ['20-16', '20-18', '18-6', '6-0'], 20)],
      20,
    );
    const { rubric: out, fixes } = repairRatingBands(impossible);

    expect(fixes).toEqual([]);
    expect(out.criteria[0].proficient.points).toBe('20-18');
  });

  it('brings the lowest band down to zero', () => {
    const short = rubric('short', [criterion('c', ['40-32', '32-24', '24-12', '12-5'], 40)], 40);
    const { rubric: out, fixes } = repairRatingBands(short);

    expect(out.criteria[0].unsatisfactory.points).toBe('12-0');
    expect(fixes).toHaveLength(1);
    expect(fixes[0].level).toBe('Unsatisfactory');
  });

  it('never moves a top bound that Canvas reads', () => {
    const { rubric: out } = repairRatingBands(part5);

    for (const [i, c] of out.criteria.entries()) {
      expect(c.exemplary.points).toBe(part5.criteria[i].exemplary.points);
    }
  });

  it('does not mutate the rubric it is given', () => {
    repairRatingBands(part5);
    expect(part5.criteria[2].proficient.points).toBe('20-12');
  });
});

describe('checkRubricPoints', () => {
  it('reports the rubric whose criteria add up to three times what was asked for', () => {
    const report = checkRubricPoints(part2);

    expect(report.actual).toBe(300);
    expect(report.intended).toBe(100);
    expect(report.criteriaCount).toBe(3);
    expect(report.totalsDisagree).toBe(true);
    expect(hasPointsProblem(report)).toBe(true);
  });

  /* The signature the notice names out loud, because it is checkable against the screen. */
  it('recognises every criterion having been given the whole total', () => {
    expect(checkRubricPoints(part2).everyCriterionHasWholeTotal).toBe(true);
  });

  it('does not claim that signature when the criteria merely fail to add up', () => {
    const lopsided = rubric(
      'lopsided',
      [
        criterion('a', ['60-50', '50-30', '30-15', '15-0'], 60),
        criterion('b', ['60-50', '50-30', '30-15', '15-0'], 60),
      ],
      100,
    );
    const report = checkRubricPoints(lopsided);

    expect(report.totalsDisagree).toBe(true);
    expect(report.actual).toBe(120);
    expect(report.everyCriterionHasWholeTotal).toBe(false);
  });

  it('never claims it for a single-criterion rubric, where it means nothing', () => {
    const only = rubric('only', [criterion('a', ['100-85', '85-70', '70-50', '50-0'], 100)], 50);

    expect(checkRubricPoints(only).everyCriterionHasWholeTotal).toBe(false);
  });

  it('finds nothing wrong with a rubric whose numbers agree', () => {
    const ok = rubric(
      'Part 3: Mapping the Engine',
      [
        criterion('Causal Loop Diagram Construction', ['40-32', '32-20', '20-10', '10-0'], 40),
        criterion('Solution Design and Leverage Points', ['30-24', '24-15', '15-8', '8-0'], 30),
        criterion('Integration of Ethical Frameworks', ['30-24', '24-15', '15-8', '8-0'], 30),
      ],
      100,
    );

    expect(hasPointsProblem(checkRubricPoints(ok))).toBe(false);
  });

  it('stays quiet about a band that repairRatingBands will fix', () => {
    expect(checkRubricPoints(part5).bandProblems).toEqual([]);
  });

  it('reports a band that cannot be lined up mechanically', () => {
    const impossible = rubric(
      'impossible',
      [criterion('Some criterion', ['20-16', '20-18', '18-6', '6-0'], 20)],
      20,
    );
    const report = checkRubricPoints(impossible);

    expect(report.bandProblems).toHaveLength(1);
    expect(report.bandProblems[0]).toContain('Some criterion');
    expect(report.bandProblems[0]).toContain('Proficient');
    expect(hasPointsProblem(report)).toBe(true);
  });

  it('stops reporting once the ratings have been rescaled to the total that was asked for', () => {
    const rescaled = rescaleRubric(part2, 100);

    expect(canvasTotal(rescaled)).toBe(100);
    expect(hasPointsProblem(checkRubricPoints(rescaled))).toBe(false);
  });

  it('is quiet about an empty rubric rather than reporting a zero mismatch', () => {
    const report = checkRubricPoints(rubric('empty', [], 100));

    expect(report.totalsDisagree).toBe(false);
    expect(hasPointsProblem(report)).toBe(false);
  });
});

describe('rubricsWithPointsProblems', () => {
  it('picks out only the rubrics that need looking at, with their figures', () => {
    const flagged = rubricsWithPointsProblems([part5, part2]);

    expect(flagged).toHaveLength(1);
    expect(flagged[0].rubric.title).toBe('Part 2: The Internal Compass');
    expect(flagged[0].report.actual).toBe(300);
    expect(flagged[0].report.intended).toBe(100);
  });

  it('handles an empty list', () => {
    expect(rubricsWithPointsProblems([])).toEqual([]);
  });
});

describe('settleStatedTotal', () => {
  it('clears the report by accepting what the criteria add up to', () => {
    const settled = settleStatedTotal(part2);

    expect(settled.totalPoints).toBe(300);
    expect(hasPointsProblem(checkRubricPoints(settled))).toBe(false);
  });

  it('moves no rating, so Canvas receives exactly what it would have before', () => {
    const settled = settleStatedTotal(part2);

    expect(settled.criteria.map((c) => c.exemplary.points)).toEqual(
      part2.criteria.map((c) => c.exemplary.points),
    );
    expect(canvasTotal(settled)).toBe(canvasTotal(part2));
  });

  it('brings each criterion in line with its own top rating', () => {
    const drifted = rubric('drifted', [criterion('c', ['40-32', '32-24', '24-12', '12-0'], 99)], 99);

    expect(settleStatedTotal(drifted).criteria[0].totalPoints).toBe(40);
  });

  it('is what rescaleRubric cannot do on its own', () => {
    // Asked for the total it already has, rescaleRubric returns the rubric untouched and the
    // contradiction survives. This is the regression that test exists to pin.
    expect(rescaleRubric(part2, 300).totalPoints).toBe(100);
    expect(settleStatedTotal(part2).totalPoints).toBe(300);
  });

  it('leaves an already-consistent rubric alone', () => {
    expect(settleStatedTotal(part5).totalPoints).toBe(100);
  });
});
