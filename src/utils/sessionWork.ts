/**
 * Does the session hold anything that only exists in memory?
 *
 * This decides whether Start Over asks first. The distinction is not "has the user done
 * something" but "would clearing destroy something they cannot get back": a generated rubric, a
 * converted CSV, or a batch of them, none of which exist anywhere until they are saved to Drive
 * or to disk. Files the user picked off their own computer are not counted — clearing the
 * session does not delete them, and a confirm for those would be the kind of prompt people learn
 * to click through without reading.
 */
export function hasUnsavedWork(session: {
  rubric: unknown | null;
  csvOutput: string | null;
  batchItems: readonly unknown[];
}): boolean {
  return Boolean(session.rubric) || Boolean(session.csvOutput) || session.batchItems.length > 0;
}
