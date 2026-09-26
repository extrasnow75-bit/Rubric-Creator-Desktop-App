import type { RubricData, RubricCriterion } from '../types';
import { canvasTotal, leadingPoints } from './rescaleRubric';

/**
 * Deterministic checks on a rubric's numbers.
 *
 * The AI writes three numbers per criterion that have to agree with each other, and one more for
 * the rubric as a whole. It is reliably right about each one on its own and unreliably right
 * about whether they add up — in one observed eight-part run, four rubrics divided their budget
 * correctly and two gave *every* criterion the full budget, then reported the budget as the
 * total. Nothing in the app noticed, because the document builder prints whatever it is handed
 * and the schema can only require that these fields are numbers, not that they are consistent.
 *
 * So the arithmetic is done here instead of asked for. Two separate problems, handled
 * differently:
 *
 * **Totals** (`pointsFindings`) — a warning, never an automatic fix. Whether three criteria in a
 * hundred-point rubric should be 34/33/33 or 50/30/20 is a weighting decision, and silently
 * picking one would be making it on the user's behalf. The Adjust panel already rescales.
 *
 * **Bands** (`repairRatingBands`) — repaired in place, because there is exactly one correct
 * answer. See the note on that function.
 *
 * ── What Canvas actually reads ──
 *
 * Only the four rating point strings reach Canvas (see utils/rubricCsv.ts), and it takes the
 * highest number in each. `criterion.totalPoints` never travels at all and `rubric.totalPoints`
 * is display only, so the rating strings are the truth and the two number fields are claims
 * about them. Every check here compares a claim against the strings.
 */

/** Every run of digits, with an optional decimal part. */
const NUMBER = /\d+(?:\.\d+)?/;
const NUMBERS = /\d+(?:\.\d+)?/g;

const RATING_KEYS = ['exemplary', 'proficient', 'developing', 'unsatisfactory'] as const;
const RATING_LABELS = ['Exemplary', 'Proficient', 'Developing', 'Unsatisfactory'] as const;

/** The score range one rating covers: `"100-85"` is 100 down to 85. */
export interface RatingBand {
  top: number;
  bottom: number;
}

/**
 * Read a rating's two bounds, or null when it has no band to read.
 *
 * A rating written in the fixed style holds one number ("15 pts") and has no range at all. A
 * reversed pair ("40-50") is returned as null rather than silently normalised — it means the
 * rating was not written the way the rest of the pipeline assumes, and guessing which bound was
 * meant is exactly the kind of judgement this module exists to avoid.
 */
export function readBand(points: string): RatingBand | null {
  const found = String(points ?? '').match(NUMBERS);
  if (!found || found.length < 2) return null;

  const top = Number(found[0]);
  const bottom = Number(found[1]);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom > top) return null;

  return { top, bottom };
}

/** The first number in a rating, which is the value Canvas takes as that rating's points. */
function readTop(points: string): number | null {
  const found = String(points ?? '').match(NUMBER);
  return found ? Number(found[0]) : null;
}

/** Replace the first number in a rating, keeping whatever text sits around it. */
function setTop(points: string, value: number): string {
  return points.replace(NUMBER, String(value));
}

/** Replace the second number in a rating, keeping the first. */
function setBottom(points: string, value: number): string {
  let seen = 0;
  return points.replace(NUMBERS, (n) => (++seen === 2 ? String(value) : n));
}

/** One rewritten rating, for reporting what changed. */
export interface BandFix {
  criterion: string;
  level: string;
  from: string;
  to: string;
}

/**
 * Chain each criterion's four bands so they hand off cleanly, and report what moved.
 *
 * Reading down a criterion, each rating should start where the one above it stopped:
 * `40-32, 32-24, 24-12, 12-0`. Every score from 0 to 40 then falls in exactly one band. When a
 * rating starts somewhere else the bands overlap or leave a gap — in one observed rubric,
 * Exemplary ran `20-16` and Proficient ran `20-12`, so a score of 18 was both at once.
 *
 * That matters beyond the document, because Canvas stores only the top of each band as that
 * tier's point value: the overlap above deploys as four tiers worth 20, 20, 12 and 6, two of
 * them indistinguishable to a grader, while the criterion's total stays 20 so nothing downstream
 * looks wrong.
 *
 * The repair is mechanical — a rating's top bound has one correct value, the bound above it — so
 * it happens without asking. Two cases are left alone instead:
 *
 *   - **Fixed-style ratings**, which hold a single number and have no band to chain.
 *   - **Corrections that would invert a band**, where the bound above sits at or below this
 *     rating's own floor. Those are reported by `pointsFindings` rather than guessed at.
 *
 * Only the top bound moves. A rating's floor is its author's, except on the lowest rating, whose
 * floor must reach 0 or the bottom of the scale has no band — a cosmetic fix, since that number
 * never reaches Canvas.
 *
 * Apply this only where the AI *wrote* the points. The screenshot and document paths transcribe
 * a rubric that already exists, and rewriting someone's own numbers to match a house rule is not
 * a repair.
 */
export function repairRatingBands(rubric: RubricData): { rubric: RubricData; fixes: BandFix[] } {
  const fixes: BandFix[] = [];

  const criteria = (rubric.criteria ?? []).map((criterion) => {
    const bands = RATING_KEYS.map((key) => readBand(criterion[key]?.points ?? ''));
    if (bands.some((band) => band === null)) return criterion;

    const next: RubricCriterion = { ...criterion };
    const record = (i: number, to: string) => {
      fixes.push({
        criterion: criterion.category,
        level: RATING_LABELS[i],
        from: next[RATING_KEYS[i]].points,
        to,
      });
      next[RATING_KEYS[i]] = { ...next[RATING_KEYS[i]], points: to };
    };

    for (let i = 1; i < RATING_KEYS.length; i++) {
      const band = bands[i] as RatingBand;
      const ceiling = (bands[i - 1] as RatingBand).bottom;
      // Leave an inverting correction to the warning path — see the note above.
      if (band.top !== ceiling && ceiling > band.bottom) {
        record(i, setTop(next[RATING_KEYS[i]].points, ceiling));
      }
    }

    const lowest = bands[bands.length - 1] as RatingBand;
    if (lowest.bottom !== 0) {
      const i = RATING_KEYS.length - 1;
      record(i, setBottom(next[RATING_KEYS[i]].points, 0));
    }

    return next;
  });

  return { rubric: { ...rubric, criteria }, fixes };
}

/**
 * Everything the checks found about one rubric's numbers.
 *
 * Numbers rather than sentences, because the wording belongs to the component that shows it and
 * the same report drives three different places: the notice on the rubric, the line on the deploy
 * card, and the buttons that offer a way out. An earlier version returned finished strings and
 * the deploy card ended up with the vaguest of them — "will not be worth what it says" — which
 * named no figure a reader could check against anything on screen.
 */
export interface PointsReport {
  /** What the ratings add up to. This is what Canvas will create. */
  actual: number;
  /** What the rubric was drafted to be worth, which is the total that was asked for. */
  intended: number;
  criteriaCount: number;
  /** The drafted total and the real one disagree. */
  totalsDisagree: boolean;
  /**
   * Every criterion carries the whole intended total rather than a share of it.
   *
   * Worth singling out because it is the failure that keeps happening, and because it is the one
   * where saying the cause out loud makes the notice checkable in seconds: three criteria, 100
   * points each, on a rubric asked to be worth 100. It also determines what help can be offered
   * — a rubric in this state has no surviving weighting to rescale, so an even split is the best
   * arithmetic alone can do.
   */
  everyCriterionHasWholeTotal: boolean;
  /** Band overlaps that could not be lined up mechanically, described one per entry. */
  bandProblems: string[];
}

/** Whether anything in the report needs a person to look at it. */
export function hasPointsProblem(report: PointsReport): boolean {
  return report.totalsDisagree || report.bandProblems.length > 0;
}

/**
 * Check one rubric's numbers against each other.
 *
 * The totals check compares the rubric against itself, rather than against the total that was
 * requested. Requested totals go stale the moment someone rescales, which would leave a permanent
 * warning on a rubric that had just been corrected; a rubric that contradicts *itself* is wrong
 * however it got here, including after an import or a change request.
 */
export function checkRubricPoints(rubric: RubricData): PointsReport {
  const criteria = rubric?.criteria ?? [];
  const actual = criteria.length === 0 ? 0 : canvasTotal(rubric);
  const statedRaw = Number(rubric?.totalPoints);
  const intended = Number.isFinite(statedRaw) ? statedRaw : actual;

  const bandProblems: string[] = [];
  for (const criterion of criteria) {
    const bands = RATING_KEYS.map((key) => readBand(criterion[key]?.points ?? ''));
    if (bands.some((band) => band === null)) continue;

    for (let i = 1; i < RATING_KEYS.length; i++) {
      const band = bands[i] as RatingBand;
      const ceiling = (bands[i - 1] as RatingBand).bottom;
      if (band.top !== ceiling && ceiling <= band.bottom) {
        bandProblems.push(
          `"${criterion.category}": ${RATING_LABELS[i]} runs ${criterion[RATING_KEYS[i]].points} ` +
            `but ${RATING_LABELS[i - 1]} ends at ${ceiling}. These cannot be lined up without ` +
            `inverting a range, so the points need editing by hand.`,
        );
      }
    }
  }

  const totalsDisagree = criteria.length > 0 && intended !== actual;

  return {
    actual,
    intended,
    criteriaCount: criteria.length,
    totalsDisagree,
    everyCriterionHasWholeTotal:
      totalsDisagree &&
      criteria.length > 1 &&
      criteria.every((c) => leadingPoints(c.exemplary) === intended),
    bandProblems,
  };
}

/**
 * Rubrics needing a look, each with its report, for a summary before deploying several at once.
 *
 * The report comes back with the rubric because the summary states each one's figures. Naming
 * them without their numbers is what sent someone to open a Google Doc looking for a problem
 * that, by then, only existed relative to a total the document no longer mentioned.
 */
export function rubricsWithPointsProblems(
  rubrics: RubricData[],
): Array<{ rubric: RubricData; report: PointsReport }> {
  return (rubrics ?? [])
    .map((rubric) => ({ rubric, report: checkRubricPoints(rubric) }))
    .filter(({ report }) => hasPointsProblem(report));
}

/**
 * Accept the criteria as they stand: make the claimed totals match what the ratings say.
 *
 * The other way out of a totals mismatch is the Adjust panel, which rescales the ratings to hit
 * the claimed total. This is the opposite choice — the weighting is right and only the bookkeeping
 * is wrong — and it moves no rating string, so nothing about what Canvas receives changes.
 *
 * It exists as its own function because `rescaleRubric` cannot express it: asked to rescale a
 * rubric to the total it is already worth, it correctly returns the rubric untouched, leaving the
 * claimed total contradicting the ratings and the warning permanently on screen.
 */
export function settleStatedTotal(rubric: RubricData): RubricData {
  const criteria = (rubric.criteria ?? []).map((criterion) => {
    const top = readTop(criterion.exemplary?.points ?? '');
    return top === null || top === criterion.totalPoints
      ? criterion
      : { ...criterion, totalPoints: top };
  });

  return { ...rubric, criteria, totalPoints: canvasTotal(rubric) };
}
