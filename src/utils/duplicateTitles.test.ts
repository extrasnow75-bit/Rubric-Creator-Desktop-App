import { describe, expect, it } from 'vitest';
import { describeDuplicateTitles, duplicateTitles } from './duplicateTitles';

/** The real document that prompted this: 39 rubrics, two names used twice. */
const realDocument = [
  'Discussion Board Rubric',
  'Discussion Rubric',
  'Bird Count Rubric',
  'Individual Presentation Rubric',
  'Video Presentation Rubric',
  'Video Discussion Rubric',
  'Journal',
  'Project Rubric - Final Dashboard',
  'Peer Review Rubric - giving credit for completing the reviews',
  'Perusall Annotations',
  'Case Study Rubric',
  'Discussion Board Rubric',
  'Reflection Rubric',
];

describe('duplicateTitles', () => {
  it('finds the clash in the real document and says where it is', () => {
    const found = duplicateTitles(realDocument);
    expect(found).toHaveLength(1);
    expect(found[0].title).toBe('Discussion Board Rubric');
    expect(found[0].count).toBe(2);
    expect(found[0].indexes).toEqual([0, 11]);
  });

  it('is empty when every title is its own', () => {
    expect(duplicateTitles(['One', 'Two', 'Three'])).toEqual([]);
  });

  it('ignores case and surrounding spaces, which nobody can see in a Canvas list', () => {
    const found = duplicateTitles(['Discussion Rubric', ' discussion rubric ']);
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(2);
    // Reported as the first one spells it, which is what the user will recognise.
    expect(found[0].title).toBe('Discussion Rubric');
  });

  it('counts three of a kind as one clash, not two', () => {
    const found = duplicateTitles(['A', 'A', 'A', 'B']);
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(3);
  });

  it('leaves blank titles alone — an untitled rubric is a different problem', () => {
    expect(duplicateTitles(['', '  ', 'Real'])).toEqual([]);
  });
});

describe('describeDuplicateTitles', () => {
  it('says nothing when there is nothing to say', () => {
    expect(describeDuplicateTitles(['One', 'Two'])).toBeNull();
  });

  it('names the title and never tells the user they cannot deploy', () => {
    const said = describeDuplicateTitles(realDocument)!;
    expect(said).toContain('Discussion Board Rubric');
    expect(said).toContain('2 rubrics share a name');
    expect(said).toMatch(/these will deploy/);
    expect(said).not.toMatch(/cannot|must|blocked/i);
  });

  it('switches to a count once more than one name clashes', () => {
    const said = describeDuplicateTitles(['A', 'A', 'B', 'B'])!;
    expect(said).toContain('2 names are used by more than one rubric');
  });

  it('counts the rubrics, not the names', () => {
    // Three of a kind is one clash; saying "Two rubrics" of it contradicts the figure beside it.
    const said = describeDuplicateTitles(['Discussion Rubric', 'Discussion Rubric', 'Discussion Rubric'])!;
    expect(said).toContain('3 rubrics share a name');
    expect(said).not.toContain('Two rubrics');
  });
});
