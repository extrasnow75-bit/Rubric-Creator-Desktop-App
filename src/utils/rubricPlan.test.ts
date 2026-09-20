import { describe, expect, it } from 'vitest';
import { buildPlan, parsePlanPoints, planProblems, selectedRows } from './rubricPlan';
import type { RubricPlanRow } from './rubricPlan';

const d = (title: string, focus = '') => ({ title, focus });

const row = (over: Partial<RubricPlanRow> = {}): RubricPlanRow => ({
  id: 'r',
  kind: 'deliverable',
  title: 'Part 1',
  focus: '',
  points: '100',
  selected: true,
  ...over,
});

describe('buildPlan', () => {
  it('puts the whole assignment first and ticks only that', () => {
    const plan = buildPlan({
      assignmentTitle: 'Wicked Problems',
      deliverables: [d('Part 1: Systems Analysis'), d('Part 2: The Internal Compass')],
      defaultPoints: 100,
    });
    expect(plan.map((r) => r.title)).toEqual([
      'Wicked Problems',
      'Part 1: Systems Analysis',
      'Part 2: The Internal Compass',
    ]);
    expect(plan.map((r) => r.selected)).toEqual([true, false, false]);
  });

  it('gives every row the points the user asked for', () => {
    const plan = buildPlan({ assignmentTitle: 'X', deliverables: [d('A'), d('B')], defaultPoints: 50 });
    expect(plan.every((r) => r.points === '50')).toBe(true);
  });

  it('offers the whole-assignment row even when nothing was found', () => {
    const plan = buildPlan({ assignmentTitle: 'Essay', deliverables: [], defaultPoints: 100 });
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe('whole');
  });

  it('falls back to a usable name when the description had no title', () => {
    const plan = buildPlan({ assignmentTitle: '   ', deliverables: [], defaultPoints: 100 });
    expect(plan[0].title).toBe('Whole assignment');
  });
});

describe('parsePlanPoints', () => {
  it('reads plain numbers', () => {
    expect(parsePlanPoints('100')).toBe(100);
    expect(parsePlanPoints(' 12.5 ')).toBe(12.5);
  });

  /**
   * The lesson from parseRatingPoints: a permissive reader that finds a number inside junk is
   * how a rubric ends up quietly worth the wrong amount. Anything not purely a number is refused
   * so the user is told, rather than guessed at.
   */
  it('refuses anything that is not purely a number', () => {
    for (const bad of ['', '   ', 'abc', '50 or so', '1,000', '>90', '-5', '0']) {
      expect(parsePlanPoints(bad), bad).toBeNull();
    }
  });
});

describe('planProblems', () => {
  it('is empty for a workable plan', () => {
    expect(planProblems([row(), row({ id: 'b', title: 'Part 2' })])).toEqual([]);
  });

  it('asks for at least one tick', () => {
    expect(planProblems([row({ selected: false })])).toEqual(['Tick at least one rubric to create.']);
  });

  it('ignores problems in rows that are not ticked', () => {
    expect(planProblems([row(), row({ id: 'b', title: '', points: '', selected: false })])).toEqual([]);
  });

  it('names the rubrics whose points cannot be read', () => {
    const problems = planProblems([row({ title: 'Part 1', points: '' })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Part 1');
  });

  it('catches a blank name', () => {
    expect(planProblems([row({ title: '  ' })])).toContain('Every ticked rubric needs a name.');
  });

  /**
   * Deploying only ever adds, so two rubrics sharing a name become two identically named rubrics
   * in the course and the cleanup is manual. Worth stopping before the run, not after.
   */
  it('catches two ticked rubrics with the same name', () => {
    const problems = planProblems([row({ title: 'Part 1' }), row({ id: 'b', title: 'part 1 ' })]);
    expect(problems.some((p) => p.includes('Part 1'))).toBe(true);
  });

  it('reports every problem at once rather than one at a time', () => {
    expect(planProblems([row({ title: '', points: 'x' })]).length).toBe(2);
  });
});

describe('selectedRows', () => {
  it('keeps only what is ticked', () => {
    expect(selectedRows([row(), row({ id: 'b', selected: false })]).map((r) => r.id)).toEqual(['r']);
  });
});
