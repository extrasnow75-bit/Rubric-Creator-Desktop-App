import { describe, expect, it } from 'vitest';
import { REVEAL_MARGIN_PX, scrollTopFor } from './revealSection';

/** A 600px-tall scroll box holding 2000px of content. */
const box = (scrollTop = 0) => ({ scrollTop, scrollHeight: 2000, clientHeight: 600 });

describe('scrollTopFor', () => {
  it('puts the section just below the top edge, not flush against it', () => {
    expect(scrollTopFor(box(), 500)).toBe(500 - REVEAL_MARGIN_PX);
  });

  it('does not scroll past the end of the content', () => {
    // 2000 - 600 = 1400 is as far as this box can go, whatever the section's offset.
    expect(scrollTopFor(box(), 1900)).toBe(1400);
  });

  /**
   * A section already at the very top asks for a negative scrollTop once the margin comes off.
   * The browser would clamp that to 0 silently, which hides a caller measuring against the wrong
   * box — so it is clamped here where a test can see it.
   */
  it('never returns a negative scroll position', () => {
    expect(scrollTopFor(box(), 4)).toBe(0);
  });

  it('is a no-op for a box with nothing to scroll', () => {
    expect(scrollTopFor({ scrollTop: 0, scrollHeight: 400, clientHeight: 600 }, 300)).toBe(0);
  });

  /**
   * The caller hands in an offset within the box's *content*, so an already-scrolled box gets the
   * same answer as one at rest. Getting this wrong scrolls by the current position twice over.
   */
  it('ignores where the box is currently scrolled to', () => {
    expect(scrollTopFor(box(900), 500)).toBe(scrollTopFor(box(0), 500));
  });
});
