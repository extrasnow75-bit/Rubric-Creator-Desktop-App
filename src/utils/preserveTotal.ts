/**
 * Keep a rubric worth what it was when an edit did not ask to change that.
 *
 * The case this exists for: "add a criterion for grammar and APA formatting". The AI adds the
 * row, gives it the same points as the rows beside it, and a rubric the user set at 500 arrives
 * worth 600. Nothing was wrong with the edit — the request said nothing about points, so the
 * model had no reason to take any away from anywhere — and nothing in the app noticed, so the
 * rubric deployed to Canvas twenty per cent heavier than the assignment it grades.
 *
 * The rule, stated plainly: if the request did not mention points, the total does not move.
 * Adding a criterion divides the same budget further; removing one gives its share back to the
 * rest. If the request *did* mention points, the model's arithmetic stands, because the user has
 * said something about it and second-guessing them would be worse than trusting them.
 *
 * Deterministic, and applied after the model has answered. Same shape as repairRatingBands: the
 * AI proposes the words, a plain function decides the numbers.
 */
import { RubricData } from '../types';
import {
  allocatePoints,
  canvasTotal,
  criterionKey,
  leadingPoints,
  rescaleRubric,
  withCriterionMaxes,
  withZeroCriteriaShared,
} from './rescaleRubric';

/**
 * Whether a change request says anything about points, weighting or totals.
 *
 * Deliberately generous about what counts as mentioning them. A false positive costs nothing —
 * the rubric is simply left as the model wrote it, which is today's behaviour — while a false
 * negative would silently overrule a user who *did* ask for more points. So anything that looks
 * like a point, a weight, a percentage, a mark or a score counts, and so does a bare number
 * followed by nothing in particular, since "make the first one 40" is a points request written
 * without the word.
 */
const POINT_WORDS =
  /\b(points?|pts?|(re)?weight(ed|ing|s)?|worth|totals?|scores?|scoring|marks?|grades?|percent(age)?)\b/i;

/** Ways of saying it with symbols rather than words: "25%", "50/50", "point-value". */
const POINT_NOTATION = /\d\s*%|\d+\s*\/\s*\d+|point[- ]value/i;

export function mentionsPoints(request: string): boolean {
  return POINT_WORDS.test(request) || POINT_NOTATION.test(request);
}

/**
 * A decimal the user typed themselves: "make it worth 4.5", "2.5 points each".
 *
 * Only a digit, a point and a digit counts. "APA 7" is not a decimal and neither is a full stop
 * at the end of a sentence; the one way this misfires is a version number written out in a
 * request that also mentions points ("APA 7.0 formatting, worth 10 points"), which costs nothing
 * but a rounding pass that was not needed.
 */
const NAMED_DECIMAL = /\d+\.\d/;

/** Every number in every rating of every criterion, in the order Canvas would read them. */
function everyRatingNumber(rubric: RubricData): number[] {
  const found: number[] = [];
  for (const criterion of rubric.criteria) {
    for (const rating of [
      criterion.exemplary,
      criterion.proficient,
      criterion.developing,
      criterion.unsatisfactory,
    ]) {
      for (const n of String(rating?.points ?? '').match(/\d+(?:\.\d+)?/g) ?? []) {
        found.push(Number(n));
      }
    }
  }
  return found;
}

/**
 * The same rubric in whole points.
 *
 * Asked for after a run that said "make this worth 50": the model halved a 100-point rubric and
 * handed back 2 / 10.5 / 17.5 / 10 / 10. Canvas takes decimals without complaint, so nothing
 * stopped it, but nobody writes a 10.5-point criterion on purpose and a grader reading one
 * wonders what they have missed.
 *
 * The total is held where it is and the criteria underneath it are rounded, which is the one
 * ordering that cannot surprise anyone: a user who asked for 50 points gets exactly 50. The
 * allocation does the deciding — it floors every share and hands the leftover points to whichever
 * criteria were cut hardest, with the larger criterion taking a tie — so 2 / 10.5 / 17.5 / 10 / 10
 * becomes 2 / 10 / 18 / 10 / 10 rather than drifting to 49 or 51.
 *
 * The lower bands are rounded too, not only the criterion's own value. Canvas reads the top band
 * for what the criterion is worth, but the ones below it are what a grader clicks, and a rubric
 * that reads 18 / 13 / 6.5 / 0 is no better than one that reads 10.5 at the top.
 */
export function wholePointsOnly(rubric: RubricData): RubricData {
  if (everyRatingNumber(rubric).every(Number.isInteger)) return rubric;

  const maxes = rubric.criteria.map((c) => leadingPoints(c.exemplary));
  const target = Math.round(maxes.reduce((sum, n) => sum + n, 0));
  if (target <= 0) return rubric;

  return withCriterionMaxes(rubric, allocatePoints(maxes, target));
}

/**
 * The edited rubric, rescaled back to what it was worth before, when that is the right thing.
 *
 * Returns `after` with its totals as the model wrote them when the request mentioned points, when
 * the total did not move, or when either side is worth nothing — rescaling from or to zero has no
 * meaning, and a rubric with no readable points is one this function has no business rewriting.
 *
 * Whichever way it goes, the points come out whole unless the request asked for a decimal. That
 * narrows "the model's arithmetic stands" to what it was always meant to mean: the user's total
 * stands, exactly as asked. What the model does underneath it is still the app's to tidy.
 */
export function preserveTotalAcrossEdit(
  before: RubricData,
  after: RubricData,
  request: string,
): RubricData {
  const settle = (rubric: RubricData): RubricData =>
    NAMED_DECIMAL.test(request) ? rubric : wholePointsOnly(rubric);

  if (mentionsPoints(request)) return settle(after);

  const was = canvasTotal(before);
  const now = canvasTotal(after);
  if (was <= 0 || now <= 0) return settle(after);

  const settled = was === now ? after : rescaleRubric(after, was);

  /*
    The total is only half of it.

    A real run asked for a criterion about APA formatting and then one about grammar. The model
    kept the rubric at its 100 points by rewriting the three existing criteria from 40/40/20 to
    35/35/30 and giving both new ones **nothing**. The total never moved, so the check above
    found nothing wrong and stood aside — correctly, by its own rule. Two criteria then rendered,
    converted to CSV and deployed to Canvas unable to affect a grade.

    So a second condition: no criterion may come out of an edit worth 0 unless it went in worth 0.
    withZeroCriteriaShared gives each one an even share and rescales the rest to pay for it,
    holding the total where it already is; it returns null, and nothing changes, wherever that
    cannot be done sensibly.
  */
  const keptAtZero = new Set(
    before.criteria.filter((c) => leadingPoints(c.exemplary) <= 0).map(criterionKey),
  );
  return settle(withZeroCriteriaShared(settled, canvasTotal(settled), keptAtZero) ?? settled);
}
