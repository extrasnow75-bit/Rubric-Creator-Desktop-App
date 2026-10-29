import type { RubricData } from '../types';

/**
 * A rubric document saved from this app as a web page (.html), brought back in after the person
 * has edited it.
 *
 * Everything here is plain code: the app wrote the file, so it can read the rubrics straight back
 * out of it, with no AI, exactly as written. The reading itself happens in the main process
 * (rubric:parseHtml), which is also what reads a Google Doc.
 */

export const isHtmlFileName = (name: string): boolean => /\.html?$/i.test(name.trim());

/** A file's base64 contents as text. The file is read as UTF-8, which is how the app wrote it. */
export function textFromBase64(data: string): string {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Ranges or single scores, judged from the points a rubric already carries. A rating written as
 * "26-21" is a range; "26" is a single score.
 */
export function scoringMethodOf(rubric: RubricData): 'ranges' | 'fixed' {
  const hasRange = rubric.criteria.some((criterion) =>
    [criterion.exemplary, criterion.proficient, criterion.developing, criterion.unsatisfactory].some(
      (rating) => String(rating?.points ?? '').includes('-'),
    ),
  );
  return hasRange ? 'ranges' : 'fixed';
}
