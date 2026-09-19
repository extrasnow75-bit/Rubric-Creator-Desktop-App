/**
 * Keeping a log box pinned to its newest line, without moving anything else.
 *
 * The deployment timeline used `scrollIntoView` on a sentinel element at the end of the list.
 * That scrolls the log box — and then keeps going, because `scrollIntoView` walks up and scrolls
 * *every* scrollable ancestor so the target lands at the top of each one. The app shell is
 * `h-screen overflow-hidden`, and `overflow: hidden` stops the user scrolling an element but not
 * the browser: the title bar and ribbon were pushed off the top of the window by every log line,
 * with no scrollbar to bring them back. A 39-rubric deploy did it about eighty times, smoothly.
 *
 * Setting `scrollTop` directly cannot do that. It moves one element, and it is instant, which is
 * also what a tailing log wants — eighty queued smooth scrolls were part of why the panel was
 * hard to read.
 */

/** The bit of a scroll box this module needs. An object literal satisfies it, so tests need no DOM. */
export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * How far from the bottom still counts as "at the bottom", in CSS pixels.
 *
 * Not zero. Interface zoom is applied with `webContents.setZoomLevel`, which leaves these three
 * numbers fractional — at 110% a box sitting flat against its own end reports a remainder of
 * something like 0.4px, and an exact comparison would read that as "the user has scrolled up" and
 * stop following on the first line. A few pixels of slack also matches what people mean by it:
 * nudging the wheel one notch is not a decision to stop watching.
 */
export const BOTTOM_SLACK_PX = 24;

/**
 * Is this box scrolled to (or near) the bottom?
 *
 * This is what decides whether new content should pull the view down. Following unconditionally
 * is the other half of the original bug: scroll up to read why a rubric failed and the next line
 * drags you away from it.
 */
export function isPinnedToBottom(box: ScrollBox, slackPx: number = BOTTOM_SLACK_PX): boolean {
  const remaining = box.scrollHeight - box.scrollTop - box.clientHeight;
  // A box with nothing to scroll reports a negative remainder in some browsers; that is pinned.
  return remaining <= slackPx;
}
