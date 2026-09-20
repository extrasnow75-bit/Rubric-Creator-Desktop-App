import { describe, expect, it } from 'vitest';
import { hasUnsavedWork } from './sessionWork';

const empty = { rubric: null, csvOutput: null, batchItems: [] as unknown[] };

describe('hasUnsavedWork', () => {
  it('is false for a session that has produced nothing', () => {
    expect(hasUnsavedWork(empty)).toBe(false);
  });

  it('is true once a rubric has been generated', () => {
    expect(hasUnsavedWork({ ...empty, rubric: { title: 'Essay' } })).toBe(true);
  });

  it('is true once a CSV exists', () => {
    expect(hasUnsavedWork({ ...empty, csvOutput: 'Criteria,Exemplary' })).toBe(true);
  });

  it('is true while a batch is in progress', () => {
    expect(hasUnsavedWork({ ...empty, batchItems: [{}, {}] })).toBe(true);
  });

  /**
   * An empty string is what a cleared CSV field holds, and Boolean('') is false — which is the
   * answer we want. Pinned because switching to `!= null` here would start prompting about
   * nothing.
   */
  it('does not count an empty CSV string as work', () => {
    expect(hasUnsavedWork({ ...empty, csvOutput: '' })).toBe(false);
  });
});
