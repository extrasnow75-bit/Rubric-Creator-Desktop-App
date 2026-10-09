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
  canvasTotal,
  criterionKey,
  leadingPoints,
  rescaleRubric,
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
 * The edited rubric, rescaled back to what it was worth before, when that is the right thing.
 *
 * Returns `after` untouched when the request mentioned points, when the total did not move, or
 * when either side is worth nothing — rescaling from or to zero has no meaning, and a rubric with
 * no readable points is one this function has no business rewriting.
 */
export function preserveTotalAcrossEdit(
  before: RubricData,
  after: RubricData,
  request: string,
): RubricData {
  if (mentionsPoints(request)) return after;

  const was = canvasTotal(before);
  const now = canvasTotal(after);
  if (was <= 0 || now <= 0) return after;

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
  return withZeroCriteriaShared(settled, canvasTotal(settled), keptAtZero) ?? settled;
}
