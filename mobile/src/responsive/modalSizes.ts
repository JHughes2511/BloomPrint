/**
 * Two sizes of modal, because they do two different jobs.
 *
 * A dialog asks a question — rename this, pick a level, are you sure. It should
 * stay small: a confirm stretched across a monitor puts its buttons a foot from
 * its own text.
 *
 * A content surface is something you read or work inside — a report, a film
 * breakdown, a game with its stats and comments. Those were capped at dialog
 * width, which turned a full coaching report into a narrow ribbon with most of
 * the screen unused behind it. Reading a report is the job; the modal should
 * give it room.
 *
 * The prose inside a content modal still gets its own reading width — the extra
 * space goes to margins, controls and side content, not to 1100px lines.
 */

/** Confirms, pickers, renames, short forms. */
export const DIALOG_MAX_WIDTH = 560;

/** Reports, film analysis, game detail — anything you read rather than answer. */
export const CONTENT_MAX_WIDTH = 1100;

/**
 * One width for every popup that shows a report.
 *
 * These were 560, 820 and 1100 depending on which screen opened them, so the
 * same training program was three different shapes depending on where you
 * tapped it, and the line length changed with it. 820 is what Ask BloomPrint
 * already used — wide enough to stop feeling like a phone sheet on a monitor,
 * short enough that the eye still finds the start of the next line.
 *
 * Forms and pickers keep their own narrower cap: a two-field sheet stretched
 * to 820 is mostly empty.
 */
export const REPORT_MODAL_WIDTH = 820;

/** Content modals also want the vertical space; they're a workspace, not a card. */
export const CONTENT_MAX_HEIGHT = '90%' as const;


/**
 * Height for a scrollable region inside a modal.
 *
 * These were fixed pixel caps — 260, 300, 460 — chosen against a phone. On a
 * tall desktop window they hold the sheet to a third of the screen no matter
 * how much room there is, so a film breakdown reads through a letterbox with
 * the page visible above and below it.
 *
 * The phone value is kept as the floor so nothing shrinks on the devices it
 * was tuned for; desktop scales with the window instead.
 */
import { useWindowDimensions } from 'react-native';
import { BREAKPOINTS } from './useBreakpoint';

export function useSheetScrollHeight(phoneMax: number, fraction = 0.6): number {
  const { width, height } = useWindowDimensions();
  if (width < BREAKPOINTS.desktop) return phoneMax;
  return Math.max(phoneMax, Math.round(height * fraction));
}


/**
 * Width cap for a sheet, applied on web only.
 *
 * Native gets an empty object — literally the styles these sheets had before
 * any of this — because there is no such thing as a 2000px React Native
 * window, so the cap has nothing to do there and every reason not to be
 * present: `marginHorizontal: 'auto'` reads like CSS on web but in Yoga an
 * auto cross-axis margin disables stretch, so the card sizes to its content
 * and can collapse. That is a native-only failure mode, invisible in a
 * browser, which is exactly how it shipped.
 *
 * Gating on Platform rather than on a breakpoint is deliberate: a breakpoint
 * is a runtime value a phone could in principle satisfy, Platform.OS cannot.
 */
import { Dimensions, Platform, ViewStyle } from 'react-native';

export const sheetCap = (max: number): ViewStyle =>
  // width: '100%' is required, not decorative. Without it the card sizes to
  // its content in a browser instead of filling to the cap, and a sheet whose
  // body is a flex child then collapses — that is why Add Player, Edit Player
  // and the player quick-look rendered as slivers or tiny cards.
  Platform.OS === 'web' ? { width: '100%', maxWidth: max, marginHorizontal: 'auto' } : {};


/**
 * A style that exists because the browser behaves differently — at ANY width.
 *
 * Distinct from desktopOnly, and the distinction matters: that one asks "is
 * there room", this one asks "is this a browser". Workarounds for react-native-
 * web's layout belong here. Gating one of those on width means it vanishes on a
 * phone browser, which is where it was needed most — a sheet whose body is a
 * ScrollView collapses to a sliver without it, and reads as a popup that opened
 * blank.
 */
export const webOnly = (style: ViewStyle): ViewStyle =>
  Platform.OS === 'web' ? style : {};


/**
 * Any style that exists purely to make a wide window look right.
 *
 * Same reasoning as sheetCap: bounding a button or a tab bar is a desktop
 * concern, and on a phone those controls were already the right size. Spread
 * this instead of writing the properties inline, so a phone keeps exactly the
 * styles it had.
 *
 * Gated on width as well as platform, and that second half matters more than
 * it looks. A phone browser is Platform.OS === 'web' — visiting the site in
 * Safari on an iPhone is web. Gating on platform alone put the desktop layout
 * on every phone that opened the URL: the width caps, the card grids, the
 * bigger buttons. The question was never "is this a browser" but "is there
 * room", which is what useBreakpoint has always said.
 *
 * Read at call time rather than through the hook because most callers are
 * StyleSheet factories, not components. Those are rebuilt per render on the
 * screens that re-render on resize; a phone does not resize anyway.
 */
export const desktopOnly = (style: ViewStyle): ViewStyle =>
  Platform.OS === 'web' && Dimensions.get('window').width >= BREAKPOINTS.tablet
    ? style : {};
