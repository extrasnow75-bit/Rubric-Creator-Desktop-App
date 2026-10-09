/**
 * Find rubric titles that more than one rubric in a set is using.
 *
 * Canvas does not enforce unique rubric names. A document holding two rubrics called the same
 * thing deploys both, and the course is left with two identical entries in its Rubrics list that
 * can only be told apart by opening them — which nobody does until a colleague attaches the
 * wrong one to an assignment. Seen in a real 39-rubric document: "Discussion Board Rubric" at
 * items 1 and 12, "Discussion Rubric" at 2 and 24.
 *
 * This only reports. Duplicates are legal and sometimes deliberate — two sections of a course
 * can reasonably want the same rubric name — so the deploy is never blocked. It is a "did you
 * mean to?", in the same shape as the points warning: the app states what Canvas will end up
 * with and the person decides.
 */

/** One title held by more than one rubric, and how many hold it. */
export interface DuplicateTitle {
  /** The title as the first rubric using it spells it, which is what a person will recognise. */
  title: string;
  count: number;
  /** Positions in the set, so the UI can point at them rather than just naming the clash. */
  indexes: number[];
}

/**
 * Compared with case and surrounding spaces ignored, because "Discussion Rubric" and
 * "discussion rubric " are the same name to anyone reading the Canvas list, and a difference
 * nobody can see is not a difference worth respecting.
 */
export function duplicateTitles(titles: readonly string[]): DuplicateTitle[] {
  const seen = new Map<string, DuplicateTitle>();

  titles.forEach((raw, index) => {
    const title = (raw ?? '').trim();
    if (!title) return; // An untitled rubric has its own problem; it is not this one.

    const key = title.toLowerCase();
    const found = seen.get(key);
    if (found) {
      found.count += 1;
      found.indexes.push(index);
    } else {
      seen.set(key, { title, count: 1, indexes: [index] });
    }
  });

  // In the order the titles first appear, so the warning reads down the list the way the user does.
  return [...seen.values()].filter((entry) => entry.count > 1);
}

/** One sentence naming the clashes, or null when there are none. */
export function describeDuplicateTitles(titles: readonly string[]): string | null {
  const clashes = duplicateTitles(titles);
  if (clashes.length === 0) return null;

  const named = clashes.map((c) => `“${c.title}” (${c.count})`).join(', ');
  const subject =
    clashes.length === 1
      ? 'Two rubrics share a name'
      : `${clashes.length} names are used by more than one rubric`;

  return (
    `${subject}: ${named}. Canvas allows it, so these will deploy — but the course will hold ` +
    'entries that can only be told apart by opening them. Rename them under "Adjust this ' +
    'rubric" if that is not what you want.'
  );
}
