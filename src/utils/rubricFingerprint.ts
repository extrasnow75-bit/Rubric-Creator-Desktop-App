import { RubricData } from '../types';

/**
 * A short signature of exactly what a set of rubrics would put into a document.
 *
 * It exists to answer one question: is there anything to save? Pressing "Save changes to the
 * Google Doc" when nothing has changed is not harmless — it writes an identical revision, moves
 * the timestamp in the document's name, and replaces anything typed into that document by hand,
 * all for no gain. Recording this when the document is written lets the button switch itself off
 * until the rubrics genuinely differ.
 *
 * Deliberately not "has the user typed in the change box". That rule misses a rename and a points
 * change, which never touch the box and are real changes the document should get; and it goes
 * false at exactly the wrong moment, since applying a change clears the box while leaving the
 * document a version behind.
 *
 * Covers what the document shows: each rubric's title, and for every criterion its name, its
 * description and all four ratings' wording and points. Not `totalPoints`, which is derived from
 * the ratings and would only add a second way to say the same thing.
 */
function signatureOf(rubrics: readonly RubricData[]): string {
  return rubrics
    .map((rubric) =>
      [
        rubric.title ?? '',
        ...rubric.criteria.map((criterion) =>
          [
            criterion.category ?? '',
            criterion.description ?? '',
            criterion.exemplary?.text ?? '',
            criterion.exemplary?.points ?? '',
            criterion.proficient?.text ?? '',
            criterion.proficient?.points ?? '',
            criterion.developing?.text ?? '',
            criterion.developing?.points ?? '',
            criterion.unsatisfactory?.text ?? '',
            criterion.unsatisfactory?.points ?? '',
          ].join('\u001f'),
        ),
      ].join('\u001e'),
    )
    .join('\u001d');
}

/**
 * FNV-1a, with the length carried alongside it.
 *
 * A 32-bit hash of a long document is not collision-proof, and the length makes an accidental
 * match far less likely without pretending to be a checksum. What a collision would cost is worth
 * stating plainly: the save button would stay switched off when it should be on, so a save would
 * have to be made through "Create a new one instead". That is an annoyance rather than lost work,
 * which is why a cheap hash is the right size of tool here.
 */
export function rubricsFingerprint(rubrics: readonly RubricData[]): string {
  const text = signatureOf(rubrics);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}
