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
