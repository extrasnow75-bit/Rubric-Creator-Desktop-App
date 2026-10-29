import { describe, it, expect } from 'vitest';
import {
  addedPassages,
  findManualEdits,
  checkEditsSurvived,
  protectedEditsFor,
  restoreCell,
} from './manualEdits';
import type { RubricData } from '../types';

function rubric(
  title: string,
  proficient = 'Mostly clear and organised.',
  other = 'Another criterion text.',
): RubricData {
  const rating = (text: string, points: string) => ({ text, points });
  const criterion = (category: string, prof: string) => ({
    category,
    description: `About ${category}.`,
    exemplary: rating('Excellent work.', '10-9'),
    proficient: rating(prof, '9-7'),
    developing: rating('Some gaps.', '7-4'),
    unsatisfactory: rating('Major gaps.', '4-0'),
    totalPoints: 10,
  });
  return {
    title,
    totalPoints: 20,
    criteria: [criterion('Clarity', proficient), criterion('Evidence', other)],
  } as RubricData;
}

describe('addedPassages', () => {
  it('finds words added to the end', () => {
    expect(addedPassages('Mostly clear.', 'Mostly clear. MANUAL EDIT #1')).toEqual(['MANUAL EDIT #1']);
  });

  it('finds a reference added in the middle as one passage', () => {
    expect(
      addedPassages('Uses sources well.', 'Uses sources well (see Smith (2019), ch. 3) and widely.'),
    ).toEqual(['(see Smith (2019), ch. 3) and widely.']);
  });

  it('counts corrected words as added', () => {
    expect(addedPassages('Cites three sources.', 'Cites four sources.')).toEqual(['four']);
  });

  it('ignores formatting Google changes by itself', () => {
    expect(addedPassages("It's  clear – mostly.", 'It’s clear - mostly.')).toEqual([]);
  });

  it('finds nothing when text was only removed', () => {
    expect(addedPassages('A long sentence here.', 'A sentence.')).toEqual([]);
  });
});

describe('findManualEdits', () => {
  it('lists the cell and the passage', () => {
    const baseline = [rubric('Part 1')];
    const doc = [rubric('Part 1', 'Mostly clear and organised. MANUAL EDIT #1')];
    const { edits, noBaseline } = findManualEdits(baseline, doc);
    expect(noBaseline).toEqual([]);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      criterion: 'Clarity',
      where: 'Proficient rating',
      passages: ['MANUAL EDIT #1'],
    });
  });

  it('reports a rubric the baseline does not have instead of guessing', () => {
    const { edits, noBaseline } = findManualEdits([rubric('Part 1')], [rubric('Part 9')]);
    expect(edits).toEqual([]);
    expect(noBaseline).toEqual(['Part 9']);
  });

  it('finds nothing in an untouched document', () => {
    expect(findManualEdits([rubric('Part 1')], [rubric('Part 1')]).edits).toEqual([]);
  });

  it('treats a criterion the person added as wholly theirs', () => {
    const doc = rubric('Part 1');
    doc.criteria.push({ ...doc.criteria[0], category: 'Originality' });
    const { edits } = findManualEdits([rubric('Part 1')], [doc]);
    expect(edits.some((e) => e.criterion === 'Originality')).toBe(true);
  });
});

describe('checkEditsSurvived', () => {
  const baseline = [rubric('Part 1')];
  const doc = [rubric('Part 1', 'Mostly clear and organised. MANUAL EDIT #1')];
  const { edits } = findManualEdits(baseline, doc);

  it('reports nothing lost when the passage is still there', () => {
    const revised = rubric('Part 1', 'Mostly clear and organised. MANUAL EDIT #1', 'Changed elsewhere.');
    const result = checkEditsSurvived(edits, revised);
    expect(result.lost).toEqual([]);
    expect(result.reworded).toEqual([]);
  });

  it('keeps a passage that survived inside reworded text, and shows the cell before and after', () => {
    const revised = rubric('Part 1', 'Largely clear and well organised. MANUAL EDIT #1');
    const result = checkEditsSurvived(edits, revised);
    expect(result.lost).toEqual([]);
    expect(result.reworded).toHaveLength(1);
    expect(result.reworded[0].before).toContain('Mostly clear');
    expect(result.reworded[0].after).toContain('Largely clear');
  });

  it('reports a passage the revision dropped', () => {
    const revised = rubric('Part 1', 'Mostly clear and organised.');
    const { lost } = checkEditsSurvived(edits, revised);
    expect(lost).toHaveLength(1);
    expect(lost[0].passage).toBe('MANUAL EDIT #1');
  });

  it('does not call a passage lost because the model moved it to another cell', () => {
    const revised = rubric('Part 1', 'Mostly clear and organised.', 'Evidence is sound. MANUAL EDIT #1');
    expect(checkEditsSurvived(edits, revised).lost).toEqual([]);
  });

  it('keeps a reference that survives a whole-rubric tone change', () => {
    const base = [rubric('Part 1', 'Uses sources well.')];
    const withRef = [rubric('Part 1', 'Uses sources well, see Smith (2019), ch. 3.')];
    const found = findManualEdits(base, withRef).edits;
    const formal = rubric('Part 1', 'Employs sources effectively, see Smith (2019), ch. 3.');
    const result = checkEditsSurvived(found, formal);
    expect(result.lost).toEqual([]);
    expect(result.reworded).toHaveLength(1);
  });
});

describe('protectedEditsFor and restoreCell', () => {
  const { edits } = findManualEdits(
    [rubric('Part 1')],
    [rubric('Part 1', 'Mostly clear and organised. MANUAL EDIT #1')],
  );

  it('selects only the edits for the rubric being revised', () => {
    expect(protectedEditsFor(edits, 'Part 1')).toHaveLength(1);
    expect(protectedEditsFor(edits, 'Part 2')).toEqual([]);
  });

  it('puts the version the person wrote back and leaves the rest alone', () => {
    const revised = rubric('Part 1', 'Different wording.', 'Untouched.');
    const restored = restoreCell(revised, edits[0]);
    expect(restored.criteria[0].proficient.text).toBe('Mostly clear and organised. MANUAL EDIT #1');
    expect(restored.criteria[1].proficient.text).toBe('Untouched.');
  });
});
