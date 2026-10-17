/**
 * How long a run took, in the words a person would use.
 *
 * Written for the last line of the deployment log, which is read once and not studied: "8 rubrics
 * successfully uploaded in 3 seconds". That figure is often surprisingly small — the CSV
 * conversion is local string work and each deploy is a single small POST — so it is worth stating
 * plainly rather than leaving the reader to subtract two timestamps.
 *
 * Whole seconds below a minute, because a tenth of a second is noise at this scale. "Under a
 * second" rather than "0 seconds" for a run that really was instant, since zero reads as a
 * measurement that failed. Minutes and seconds above that, with the seconds dropped when they are
 * zero so a two-minute run does not read "2 minutes 0 seconds".
 */
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'an unknown time';

  const total = Math.round(seconds);
  if (total === 0) return 'under a second';
  if (total < 60) return `${total} ${total === 1 ? 'second' : 'seconds'}`;

  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  const minutePart = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  if (rest === 0) return minutePart;
  return `${minutePart} ${rest} ${rest === 1 ? 'second' : 'seconds'}`;
}
