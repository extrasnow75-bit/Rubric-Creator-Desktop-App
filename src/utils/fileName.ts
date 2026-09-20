/**
 * One way of turning a rubric title into a filename.
 *
 * There were three. Part 2 stripped the characters Windows and macOS actually refuse and kept
 * everything else; the deploy panel and the CSV repair panel replaced every character outside
 * `[a-z0-9]`, which also flattens spaces, hyphens and apostrophes. So the same rubric arrived as
 * `Module 1_ Discussion.csv` from one screen and `Module_1__Discussion.csv` from another, and a
 * zip of twenty-six of them was markedly harder to read from the second.
 *
 * Part 2's is the one kept. Stripping only what the filesystem rejects leaves a name someone can
 * read at a glance, which is the whole job here — these files are named after the rubric so that
 * the person who opens the zip a week later knows which is which.
 */

/** Characters Windows rejects in a filename. macOS and Linux object to fewer, but not to these. */
const ILLEGAL = /[/\\?%*:|"<>]/g;

/**
 * A rubric title, safe to use as a filename, without the extension.
 *
 * Control characters go too — they are legal on Linux and a menace everywhere else. Trailing
 * dots and spaces are trimmed because Windows silently drops them, which turns "Part 1." and
 * "Part 1" into the same file and loses one of them from a zip.
 *
 * Falls back to `fallback` when nothing usable survives, rather than producing a bare ".csv"
 * that some archive tools treat as a hidden file and others refuse outright.
 */
export function safeFileName(title: string, fallback = 'rubric'): string {
  const cleaned = String(title ?? '')
    .replace(ILLEGAL, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[. ]+$/, '')
    .trim();
  return cleaned || fallback;
}
