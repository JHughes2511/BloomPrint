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
import { Platform, ViewStyle } from 'react-native';

export const sheetCap = (max: number): ViewStyle =>
  Platform.OS === 'web' ? { maxWidth: max, marginHorizontal: 'auto' } : {};


/**
 * Any style that exists purely to make a wide window look right.
 *
 * Same reasoning as sheetCap: bounding a button or a tab bar is a desktop
 * concern, and on a phone those controls were already the right size. Spread
 * this instead of writing the properties inline, so native keeps exactly the
 * styles it had.
 */
export const webOnly = (style: ViewStyle): ViewStyle =>
  Platform.OS === 'web' ? style : {};
