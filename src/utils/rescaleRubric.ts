import type { RubricData, RubricCriterion, RubricRating } from '../types';

/**
 * Change a rubric's total points without asking the AI to write it again.
 *
 * "Make this worth 75 instead of 100" is a proportional change, not a creative one — every
 * criterion keeps its wording, its weighting relative to the others, and its four rating levels.
 * Sending it back to Gemini would cost a request per rubric, take ten seconds each, and return
 * prose nobody asked to have rewritten. This does it locally and predictably.
 *
 * **What Canvas actually reads.** The CSV is built from the four rating point *strings* only
 * (see utils/rubricCsv.ts) — `criterion.totalPoints` never reaches Canvas at all, and
 * `rubric.totalPoints` only shows on screen and in the Google Doc. So the rating strings are what
 * has to be right; the two number fields are kept in step so the display does not contradict
 * them.
 *
 * **Why the strings are scaled rather than parsed into numbers.** A rating's points can be a
 * plain "15", a range "25-20", or Canvas's own "4 to >3 pts", and which one it is depends on the
 * point style chosen when the rubric was generated. Scaling each number where it sits keeps the
 * notation intact instead of forcing every rubric into one shape.
 */

/** Every run of digits, with an optional decimal part. */
const NUMBER = /\d+(?:\.\d+)?/;
const NUMBERS = /\d+(?:\.\d+)?/g;

/** The first number in a rating, which is the value Canvas takes as that rating's points. */
export function leadingPoints(rating: RubricRating): number {
  const match = rating.points.match(NUMBER);
  return match ? Number(match[0]) : 0;
}

/** Multiply every number in a string, keeping whatever text sits around them. */
function scaleNumbers(text: string, factor: number): string {
  return text.replace(NUMBERS, (n) => String(Math.max(0, Math.round(Number(n) * factor))));
}

/** Replace only the first number, used to land a criterion exactly on its allotted total. */
function setLeadingNumber(text: string, value: number): string {
  return NUMBER.test(text) ? text.replace(NUMBER, String(value)) : text;
}

/**
 * Split `newTotal` across criteria in proportion to what they are worth now.
 *
 * Largest remainder: floor every share, then hand the leftover points out one at a time to
 * whichever criteria were cut by the most. Rounding each share independently would not do —
 * five criteria of 15 rescaled to 75 would each round to 11 and total 55, losing a fifth of the
 * rubric with nothing on screen to say why.
 *
 * Criteria worth nothing stay worth nothing rather than being given a share they never had.
 */
export function allocatePoints(current: number[], newTotal: number): number[] {
  const oldTotal = current.reduce((sum, n) => sum + n, 0);
  if (oldTotal <= 0) return current.map(() => 0);

  const exact = current.map((n) => (n * newTotal) / oldTotal);
  const floored = exact.map(Math.floor);
  let remaining = newTotal - floored.reduce((sum, n) => sum + n, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value), had: current[index] }))
    .filter((entry) => entry.had > 0)
    .sort((a, b) => b.fraction - a.fraction || b.had - a.had);

  const result = [...floored];
  for (let i = 0; remaining > 0 && order.length > 0; i++, remaining--) {
    result[order[i % order.length].index] += 1;
  }
  return result;
}

/** The rubric's real total: what the top rating of each criterion is worth, added up. */
export function canvasTotal(rubric: RubricData): number {
  return rubric.criteria.reduce((sum, c) => sum + leadingPoints(c.exemplary), 0);
}

const RATING_KEYS = ['exemplary', 'proficient', 'developing', 'unsatisfactory'] as const;

/**
 * The same rubric, worth `newTotal`.
 *
 * Returns the rubric unchanged when there is nothing sensible to scale — a total of zero has no
 * proportions to preserve, and a rubric already worth `newTotal` needs no work. The caller should
 * say so rather than reporting a change that did not happen.
 */
export function rescaleRubric(rubric: RubricData, newTotal: number): RubricData {
  const oldTotal = canvasTotal(rubric);
  if (oldTotal <= 0 || newTotal < 0 || newTotal === oldTotal) return rubric;

  const currentMaxes = rubric.criteria.map((c) => leadingPoints(c.exemplary));
  return withCriterionMaxes(rubric, allocatePoints(currentMaxes, newTotal));
}

/**
 * Give each criterion an exact new maximum, keeping every word and every proportion inside it.
 *
 * Split out of `rescaleRubric` so that two different questions can share one answer. Rescaling
 * works out the new maximums proportionally — "the same rubric, worth 75 instead of 100". A
 * weighted split is handed its maximums from somewhere else entirely, because the proportions
 * that were there are the thing being replaced: when a mis-drafted rubric gives every criterion
 * the full budget, rescaling it can only ever produce an even split, since even is all the
 * information that survived.
 *
 * Both then need the identical, fiddly part — scale each rating string by its criterion's own
 * factor, land the top rating on the allotted number exactly, and leave the notation alone.
 */
export function withCriterionMaxes(rubric: RubricData, newMaxes: number[]): RubricData {
  const currentMaxes = rubric.criteria.map((c) => leadingPoints(c.exemplary));
  const newTotal = newMaxes.reduce((sum, n) => sum + n, 0);

  const criteria: RubricCriterion[] = rubric.criteria.map((criterion, i) => {
    const oldMax = currentMaxes[i];
    const newMax = newMaxes[i];
    if (oldMax <= 0) return criterion;

    const factor = newMax / oldMax;
    const scaled: Partial<RubricCriterion> = {};
    for (const key of RATING_KEYS) {
      scaled[key] = { ...criterion[key], points: scaleNumbers(criterion[key].points, factor) };
    }
    // The top rating carries the criterion's whole value to Canvas, so it lands on the allotted
    // number exactly rather than on whatever rounding produced. The lower ratings keep their
    // proportions; a point either way there does not change what the criterion is worth.
    scaled.exemplary = {
      ...scaled.exemplary!,
      points: setLeadingNumber(scaled.exemplary!.points, newMax),
    };

    return { ...criterion, ...scaled, totalPoints: newMax } as RubricCriterion;
  });

  return { ...rubric, criteria, totalPoints: newTotal };
}

/**
 * Apply a weighting worked out elsewhere — one number per criterion, in order.
 *
 * The shares are checked here rather than trusted, because the only caller gets them from the
 * AI: wrong length, a negative, a non-number or a set that sums to nothing all mean the answer
 * is unusable, and the rubric comes back untouched so the caller can say so. Shares that are
 * individually fine but do not add up to `total` are not rejected — they are re-apportioned with
 * the same largest-remainder allocation rescaling uses, so a model that returns 50/30/30 for a
 * hundred points still lands on a hundred with its weighting intact.
 */
export function applyPointSplit(
  rubric: RubricData,
  shares: number[],
  total: number,
): RubricData | null {
  if (shares.length !== rubric.criteria.length || shares.length === 0) return null;
  if (!shares.every((n) => Number.isFinite(n) && n >= 0)) return null;
  if (shares.reduce((sum, n) => sum + n, 0) <= 0) return null;
  if (!Number.isFinite(total) || total <= 0) return null;

  const rounded = shares.map((n) => Math.round(n));
  const exact =
    rounded.reduce((sum, n) => sum + n, 0) === total ? rounded : allocatePoints(rounded, total);

  return withCriterionMaxes(rubric, exact);
}
