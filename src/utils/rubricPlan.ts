import type { Deliverable } from '../services/geminiService';

/**
 * The checklist that decides which rubrics get made.
 *
 * The model proposes deliverables; this turns them into rows the user ticks, renames and prices,
 * and nothing is generated until they say so. Keeping it here rather than inside the component
 * means the rules that can go quietly wrong — what counts as a valid plan, what a row is worth
 * by default — are testable without a browser.
 *
 * Two of those rules are worth more than they look. A rubric deployed under a name that already
 * exists in the course produces a second rubric with the same name, and deploy only ever adds,
 * so the duplicate is a manual cleanup in Canvas. And a points value the user has blanked out
 * must stop the run rather than silently become zero, which is the same class of fault as the
 * `parseFloat(x) || 0` bug that put live rubrics into courses worth nothing.
 */

export type RubricPlanRow = {
  id: string;
  /**
   * `whole` is the rubric covering the entire assignment; `deliverable` is one of its parts.
   *
   * They are not peers. The whole-assignment rubric has roughly a criterion per part, while a
   * deliverable's rubric has several criteria about that part alone, so ticking everything is a
   * deliberate choice for one gradebook rubric plus formative ones — not double counting.
   */
  kind: 'whole' | 'deliverable';
  title: string;
  /** What the description says this covers. Empty on the whole-assignment row. */
  focus: string;
  /** Held as text because it is an editable box; validated on the way out. */
  points: string;
  selected: boolean;
};

/**
 * Build the checklist.
 *
 * Only the whole-assignment row starts ticked. Generating eight rubrics is a deliberate act and
 * costs eight calls, so it should be something the user chose rather than something they failed
 * to untick.
 */
export function buildPlan(opts: {
  assignmentTitle: string;
  deliverables: Deliverable[];
  defaultPoints: number;
}): RubricPlanRow[] {
  const points = String(opts.defaultPoints);
  const whole: RubricPlanRow = {
    id: 'whole',
    kind: 'whole',
    title: opts.assignmentTitle.trim() || 'Whole assignment',
    focus: '',
    points,
    selected: true,
  };
  return [
    whole,
    ...opts.deliverables.map((d, i) => ({
      id: `deliverable-${i}`,
      kind: 'deliverable' as const,
      title: d.title,
      focus: d.focus,
      points,
      selected: false,
    })),
  ];
}

/**
 * A name for the whole-assignment rubric, taken from the description.
 *
 * The first non-empty line is the title in nearly every assignment document, and it is the name
 * that will appear in the Canvas rubric list, so it matters that it reads like one. A first line
 * long enough to be a paragraph is not a title: rather than truncate it into something nobody
 * would recognise, this returns nothing and lets `buildPlan` fall back. The user can rename the
 * row either way.
 */
export function describedAssignmentTitle(description: string): string {
  for (const line of description.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed.length > 120) return '';
    return trimmed.replace(/\s+/g, ' ');
  }
  return '';
}

/** Points a row is worth, or null when the box does not hold a usable number. */
export function parsePlanPoints(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  // Anchored: "50 or so" and "1,000" are refused rather than read as 50 and 1.
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 ? value : null;
}

export const selectedRows = (rows: readonly RubricPlanRow[]): RubricPlanRow[] =>
  rows.filter((r) => r.selected);

/**
 * Everything wrong with the plan, in words the user can act on. Empty means it is ready to run.
 *
 * Returns all of the problems rather than the first, so fixing one does not reveal another.
 */
export function planProblems(rows: readonly RubricPlanRow[]): string[] {
  const chosen = selectedRows(rows);
  if (chosen.length === 0) return ['Tick at least one rubric to create.'];

  const problems: string[] = [];

  if (chosen.some((r) => r.title.trim() === '')) {
    problems.push('Every ticked rubric needs a name.');
  }

  const badPoints = chosen
    .filter((r) => parsePlanPoints(r.points) === null)
    .map((r) => r.title.trim() || 'an unnamed rubric');
  if (badPoints.length > 0) {
    problems.push(
      `Give a points total above zero for ${badPoints.join(', ')}.`,
    );
  }

  // Matched case-insensitively, since Canvas will happily hold "Part 1" and "part 1" side by
  // side and nobody reading the course will see the difference. Reported under the spelling that
  // appeared first, so the message names the row the user is most likely to recognise.
  const firstSeen = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const row of chosen) {
    const title = row.title.trim();
    if (title === '') continue;
    const key = title.toLowerCase();
    const earlier = firstSeen.get(key);
    if (earlier === undefined) firstSeen.set(key, title);
    else duplicates.add(earlier);
  }
  if (duplicates.size > 0) {
    problems.push(
      `Two rubrics are named ${[...duplicates].join(', ')}. Deploying adds rather than ` +
        'replaces, so they would both appear in the course under the same name.',
    );
  }

  return problems;
}
