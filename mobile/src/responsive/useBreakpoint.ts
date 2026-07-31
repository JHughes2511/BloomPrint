/**
 * One definition of "how much room do we have", used by every screen.
 *
 * The app was built for phones, where there is exactly one answer. On web the
 * same screen has to work at 400px and at 2560px, and the difference isn't
 * "bigger" — it's a different arrangement: one column of cards becomes a grid,
 * a bottom tab bar becomes a sidebar, a full-bleed form becomes a centred one.
 *
 * Driven by window width rather than Platform, so a narrow browser window gets
 * the phone layout and an iPad in landscape gets the wider one. Platform tells
 * you which OS you're on; it doesn't tell you how much space you have.
 */
import { useWindowDimensions } from 'react-native';

export const BREAKPOINTS = {
  /** Below this, single column and bottom tabs — a phone, or a narrow window. */
  tablet: 768,
  /** At or above this, sidebar navigation and multi-column content. */
  desktop: 1024,
} as const;

/**
 * Widest the content column ever gets. Past this, growing the window adds
 * margin rather than line length: a form stretched across a 27-inch monitor is
 * harder to use, not easier, and long report text becomes unreadable well
 * before the window runs out.
 */
export const CONTENT_MAX_WIDTH = 1280;

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

export function useBreakpoint() {
  const { width, height } = useWindowDimensions();
  const bp: Breakpoint =
    width >= BREAKPOINTS.desktop ? 'desktop' : width >= BREAKPOINTS.tablet ? 'tablet' : 'phone';

  return {
    width,
    height,
    breakpoint: bp,
    isPhone: bp === 'phone',
    isTablet: bp === 'tablet',
    isDesktop: bp === 'desktop',
    /** Tablet and up — where multi-column starts paying off. */
    isWide: bp !== 'phone',
    /**
     * Columns for a card grid. Kept here so Roster, Reports and Games can't
     * drift into three different ideas of what "two columns" means.
     */
    gridColumns: bp === 'desktop' ? 3 : bp === 'tablet' ? 2 : 1,
    /** Page gutter: tight on a phone, generous once there's room to spare. */
    gutter: bp === 'phone' ? 16 : bp === 'tablet' ? 24 : 32,
  };
}
