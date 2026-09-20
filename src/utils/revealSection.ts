/**
 * Bring a newly revealed section into view, and move focus to it.
 *
 * The problem this solves: choosing a Phase 1 option renders the next step *below the fold*, so
 * from the user's seat nothing happens — the button looks broken and they click it again. The
 * content was there the whole time, just off-screen.
 *
 * Scrolling alone only fixes it for people looking at the screen. A screen-reader user gets no
 * announcement at all, because focus stays on the button they just pressed; they are left in the
 * same "nothing happened" state permanently. So this moves focus into the new section as well,
 * which announces it.
 *
 * The target needs `tabIndex={-1}` to be focusable without joining the tab order.
 *
 * ---
 *
 * This used to call `el.scrollIntoView({ block: 'start' })`, and that is the one thing it must
 * not do. `scrollIntoView` does not scroll *a* box — it walks up the tree and scrolls **every**
 * scrollable ancestor until the target sits at the top of each one, the document included.
 * `overflow: hidden` does not stop it: hidden means the *user* cannot scroll a box, not that the
 * browser cannot. The app shell is `h-screen overflow-hidden`, so any ancestor scroll it
 * performed pushed the blue title bar and the ribbon off the top of the window and left white
 * space below, with no scrollbar anywhere to bring them back.
 *
 * `followScroll.ts` records the same fault in the deployment timeline, found first and fixed
 * there by assigning `scrollTop`. This is the same fix applied to the other caller: pick the one
 * box that should move, move that box, and touch nothing above it.
 */

/** The bit of a scroll box this module needs. An object literal satisfies it, so tests need no DOM. */
export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * A few pixels of air above the revealed section.
 *
 * Landing it flush against the top edge reads as clipped — a card whose border touches the edge
 * of the scroll area looks like it continues above.
 */
export const REVEAL_MARGIN_PX = 12;

/**
 * The scrollTop that puts `elementTop` just inside the top of the box.
 *
 * `elementTop` is the element's distance from the top of the box's *content*, which is what the
 * caller computes from the two bounding rectangles plus the current scrollTop.
 *
 * Clamped at both ends. Past the end the browser would clamp anyway, but a negative value is
 * worth stopping here: scrolling to -12 is silently treated as 0, which hides the fact that the
 * caller measured against the wrong box.
 */
export function scrollTopFor(
  box: ScrollBox,
  elementTop: number,
  marginPx: number = REVEAL_MARGIN_PX,
): number {
  const furthest = Math.max(0, box.scrollHeight - box.clientHeight);
  return Math.min(furthest, Math.max(0, elementTop - marginPx));
}

/**
 * The nearest ancestor that actually scrolls, or null if nothing above this element does.
 *
 * Both halves of the test matter. A box has to be *able* to scroll (`auto` or `scroll`) and have
 * something to scroll — `<main>` is `overflow-y-auto` at all times, so on a short screenful it
 * would otherwise be picked and scrolled to no effect while the section stayed off-screen.
 *
 * Returning null rather than falling back to the document is deliberate. Scrolling the document
 * is the bug this module exists to avoid; if no box below it scrolls, the right answer is to move
 * nothing.
 */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

export function revealSection(el: HTMLElement | null): void {
  if (!el) return;

  // `matchMedia` is missing in some test environments; treat its absence as "no preference".
  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const box = scrollParentOf(el);
  if (box) {
    // The element's offset within the box's content: how far its top sits below the box's top
    // edge on screen, plus however far the box is already scrolled.
    const elementTop = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTo({
      top: scrollTopFor(box, elementTop),
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }

  // preventScroll is what keeps the promise the rest of this module makes. Focusing an offscreen
  // element scrolls it into view by the same ancestor-walking route as scrollIntoView, so without
  // this the fix above would be undone one line later.
  el.focus({ preventScroll: true });
}

/**
 * The delay before revealing.
 *
 * The section mounts in the same commit that triggers this, but its height is not final until
 * the browser has laid it out — scrolling too early lands at the wrong offset. One frame is
 * usually enough; this matches the 100ms the Analyze section already used.
 */
export const REVEAL_DELAY_MS = 100;
