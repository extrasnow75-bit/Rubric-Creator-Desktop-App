/**
 * Does the session hold anything that only exists in memory?
 *
 * This used to decide whether Start Over asked first. It no longer does — the ribbon reflows on
 * a zoom change and can put the button under a cursor that is aiming at something else, so the
 * dialog is now raised every time. What this decides is which sentence that dialog shows, which
 * still needs the same distinction: not "has the user done something" but "would clearing
 * destroy something they cannot get back" — a generated rubric, a converted CSV, or a batch of
 * them, none of which exist anywhere until they are saved to Drive or to disk. Files the user
 * picked off their own computer are not counted; clearing the session does not delete them.
 */
export function hasUnsavedWork(session: {
  rubric: unknown | null;
  csvOutput: string | null;
  batchItems: readonly unknown[];
}): boolean {
  return Boolean(session.rubric) || Boolean(session.csvOutput) || session.batchItems.length > 0;
}
