import type { RubricData } from '../types';
import { plainText } from './rubricFingerprint';

/**
 * Finding the words a person typed into the Google Doc by hand, and checking they came through an
 * AI revision.
 *
 * The problem this exists for: someone adds a line to a rating cell in the Doc, then asks the app
 * for a change to something else. The app revises the whole rubric and writes the whole rubric
 * back, so anything the model drops or rewords is gone from the Doc as well. Nothing here uses
 * AI. The app keeps a copy of the rubrics as it last left them in the Doc (its baseline), compares
 * the Doc's current wording against that word by word, and lists what is new.
 *
 * Passages are protected, cells are not. A request like "make the tone more formal throughout"
 * may rightly rewrite a cell the person edited, and freezing it would break that request. What
 * must not happen is the person's added words vanishing without anyone saying so.
 */

export type CellField = 'description' | 'exemplary' | 'proficient' | 'developing' | 'unsatisfactory';

const FIELD_LABEL: Record<CellField, string> = {
  description: 'description',
  exemplary: 'Exemplary rating',
  proficient: 'Proficient rating',
  developing: 'Developing rating',
  unsatisfactory: 'Unsatisfactory rating',
};

const FIELDS: CellField[] = ['description', 'exemplary', 'proficient', 'developing', 'unsatisfactory'];

/** Words the person added to one cell of one rubric. */
export interface ManualEdit {
  rubricTitle: string;
  criterion: string;
  field: CellField;
  /** "Proficient rating", for sentences. */
  where: string;
  /** Each run of new words, as the person wrote it. */
  passages: string[];
  /** The cell as the app last left it in the Doc. */
  before: string;
  /** The cell as the person now has it. */
  after: string;
}

/** The part of an edit the AI is told about. */
export interface ProtectedEdit {
  criterion: string;
  where: string;
  passages: string[];
}

export interface LostPassage {
  edit: ManualEdit;
  passage: string;
}

export interface RewordedCell {
  rubricTitle: string;
  criterion: string;
  where: string;
  /** The person's version, from the Doc. */
  before: string;
  /** What the revision produced. */
  after: string;
}

function cellText(criterion: RubricData['criteria'][number], field: CellField): string {
  return field === 'description' ? criterion.description ?? '' : criterion[field]?.text ?? '';
}

const titleKey = (title: string) => plainText(title).toLowerCase();

/** A word reduced to what identifies it: no case, no punctuation hugging either end. */
function wordKey(word: string): string {
  const core = word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return core || word;
}

const words = (text: string) => plainText(text).split(' ').filter(Boolean);

/**
 * The runs of words in `after` that are not in `before`, in order.
 *
 * A longest-common-subsequence over words. What is in `after` but outside that subsequence is new;
 * adjacent new words form one passage, so "added Smith (2019), ch. 3 to the end" is one passage and
 * not six. A correction counts too: the corrected words are new, and the words they replaced are
 * simply no longer there.
 */
export function addedPassages(before: string, after: string): string[] {
  const a = words(before);
  const b = words(after);
  if (b.length === 0) return [];

  const ka = a.map(wordKey);
  const kb = b.map(wordKey);
  /* Most cells are untouched, and the table below costs n x m for nothing when they are. */
  if (ka.length === kb.length && ka.every((k, i) => k === kb[i])) return [];
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = ka[i] === kb[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const inCommon = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) {
      inCommon[j] = true;
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  const passages: string[] = [];
  let run: string[] = [];
  for (let k = 0; k < m; k++) {
    if (inCommon[k]) {
      if (run.length) passages.push(run.join(' '));
      run = [];
    } else {
      run.push(b[k]);
    }
  }
  if (run.length) passages.push(run.join(' '));
  return passages;
}

/**
 * What the person added to the Doc since the app last wrote or read it.
 *
 * Rubrics are matched by title and criteria by name, the way the app matches a rubric to its place
 * in a Doc. A rubric the baseline does not have is reported in `noBaseline`, because there is
 * nothing to compare it with and guessing is how someone's wording gets overwritten.
 */
export function findManualEdits(
  baseline: readonly RubricData[],
  doc: readonly RubricData[],
): { edits: ManualEdit[]; noBaseline: string[] } {
  const earlier = new Map(baseline.map((r) => [titleKey(r.title), r]));
  const edits: ManualEdit[] = [];
  const noBaseline: string[] = [];

  for (const current of doc) {
    const was = earlier.get(titleKey(current.title));
    if (!was) {
      noBaseline.push(current.title);
      continue;
    }

    /* Criteria by name; a repeated name pairs up in order of appearance. */
    const unused = new Map<string, RubricData['criteria']>();
    for (const c of was.criteria) {
      const key = titleKey(c.category);
      unused.set(key, [...(unused.get(key) ?? []), c]);
    }

    for (const criterion of current.criteria) {
      const match = unused.get(titleKey(criterion.category))?.shift();
      for (const field of FIELDS) {
        const after = cellText(criterion, field);
        const before = match ? cellText(match, field) : '';
        const passages = addedPassages(before, after);
        if (passages.length === 0) continue;
        edits.push({
          rubricTitle: current.title,
          criterion: criterion.category,
          field,
          where: FIELD_LABEL[field],
          passages,
          before,
          after,
        });
      }
    }
  }
  return { edits, noBaseline };
}

/** The edits that belong to one rubric. */
export function editsForRubric(edits: readonly ManualEdit[], rubricTitle: string): ManualEdit[] {
  return edits.filter((e) => titleKey(e.rubricTitle) === titleKey(rubricTitle));
}

/** The edits for one rubric, in the form the AI is given. */
export function protectedEditsFor(edits: readonly ManualEdit[], rubricTitle: string): ProtectedEdit[] {
  return editsForRubric(edits, rubricTitle).map((e) => ({
    criterion: e.criterion,
    where: e.where,
    passages: e.passages,
  }));
}

function everyWordIn(rubric: RubricData): string {
  return plainText(
    rubric.criteria
      .map((c) => FIELDS.map((f) => cellText(c, f)).join(' ') + ' ' + (c.category ?? ''))
      .join(' '),
  ).toLowerCase();
}

/**
 * After a revision: which of the person's added passages are still in the rubric, and which cells
 * they edited now read differently.
 *
 * A passage counts as kept when its words appear anywhere in the revised rubric, not only in the
 * original cell — the model moving a sentence to a better cell has not lost it. Whitespace and
 * punctuation style are ignored, as everywhere else in the comparison.
 */
export function checkEditsSurvived(
  edits: readonly ManualEdit[],
  revised: RubricData,
): { lost: LostPassage[]; reworded: RewordedCell[] } {
  const haystack = everyWordIn(revised);
  const lost: LostPassage[] = [];
  const reworded: RewordedCell[] = [];
  const seenCells = new Set<string>();

  for (const edit of edits) {
    for (const passage of edit.passages) {
      if (!haystack.includes(plainText(passage).toLowerCase())) lost.push({ edit, passage });
    }

    const now = revised.criteria.find((c) => titleKey(c.category) === titleKey(edit.criterion));
    if (!now) continue;
    const text = cellText(now, edit.field);
    const cell = `${titleKey(edit.criterion)}|${edit.field}`;
    if (plainText(text) !== plainText(edit.after) && !seenCells.has(cell)) {
      seenCells.add(cell);
      reworded.push({
        rubricTitle: edit.rubricTitle,
        criterion: edit.criterion,
        where: edit.where,
        before: edit.after,
        after: text,
      });
    }
  }
  return { lost, reworded };
}

/** Put the person's version of a cell back into a rubric. Returns a new rubric. */
export function restoreCell(rubric: RubricData, edit: ManualEdit): RubricData {
  return {
    ...rubric,
    criteria: rubric.criteria.map((c) => {
      if (titleKey(c.category) !== titleKey(edit.criterion)) return c;
      return edit.field === 'description'
        ? { ...c, description: edit.after }
        : { ...c, [edit.field]: { ...c[edit.field], text: edit.after } };
    }),
  };
}
