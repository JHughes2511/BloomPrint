/**
 * The gap above a screen's title, and the way a chip row reaches the edge.
 *
 * Both exist because a phone app and a phone browser have different jobs to do
 * with the same pixels.
 */
import { Platform, ViewStyle } from 'react-native';

/** What a browser leaves above a title. Enough to breathe, not a band. */
const WEB_TOP_PAD = 24;

/**
 * Top padding for a screen header.
 *
 * Screens reserve 48–60pt up there for the status bar and notch, which a native
 * app has to do itself — nothing else will keep the title out from under the
 * clock. A browser already sits below its own chrome, so the same reservation
 * is just an empty band, and it is the first thing on the screen, so everything
 * below starts lower for no reason.
 *
 * Pass the value the screen uses on a phone; it is returned untouched there.
 */
export const topPad = (nativeValue: number): number =>
  Platform.OS === 'web' ? WEB_TOP_PAD : nativeValue;

/**
 * A horizontal chip scroller that runs to the edge of the screen.
 *
 * A row of chips is only readable as scrollable if a chip is visibly cut by the
 * screen edge. Put the padding on the scroller's own view and it stops short,
 * so the last chip is clipped by a margin instead — which reads as broken
 * layout rather than as more content, and hides options behind a gesture
 * nobody has a reason to try.
 *
 * The fix is where the padding lives, not how much: none on the view, all of it
 * on the content inside, so the chips still line up with the title but can
 * overflow past both edges. Recent's filter row has always done this; these
 * helpers are that arrangement named, so the rest of the app can match it.
 *
 * Spread `bleedRow` on the ScrollView's `style` and `bleedContent` on its
 * `contentContainerStyle`.
 */
/**
 * Cancel the parent's horizontal padding so the scroller spans the screen.
 *
 * Pass the padding the container actually uses. Guessing 16 where the screen
 * uses 20 leaves a 4px lip that looks like a rendering bug rather than a
 * choice, so each caller states its own.
 */
export const bleedRow = (parentPad: number): ViewStyle => ({
  marginHorizontal: -parentPad,
});

/**
 * The padding that moved off the view and onto the content.
 *
 * Trailing padding matters as much as leading: without it the last chip ends
 * flush against the glass with nothing after it, and a row that is scrolled to
 * its end looks identical to one that was cut off.
 *
 * `gap` defaults to 0 because most chip styles here already space themselves
 * with marginRight. Adding 8 on top of that doubles the spacing to 16 — which
 * is what happened when these rows were first bled, and it is invisible in the
 * diff because the two halves live in different files. Pass a gap only for
 * chips that carry no margin of their own.
 */
export const bleedContent = (gutter: number, gap = 0): ViewStyle => ({
  flexDirection: 'row',
  alignItems: 'center',
  gap,
  paddingLeft: gutter,
  paddingRight: gutter,
});
