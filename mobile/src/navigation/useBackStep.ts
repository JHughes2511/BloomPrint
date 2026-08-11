/**
 * Back undoes a step taken INSIDE a screen.
 *
 * Team Grade is one screen holding four views and their children — a game's
 * detail, a team's scout page, a game report. Opening one of those is a step
 * the coach took, but the navigator never saw it: the route did not change, so
 * back has nothing to pop here and hands the request up to the tab navigator,
 * which switches to whatever tab was used last. That is the jump to Home — you
 * open a team in Scout, swipe back, and land somewhere you were never standing.
 *
 * The cure is the one sheets already use: while the step is open, hold a
 * browser history entry for it, so back consumes the entry and closes the step
 * instead of leaving the page. registerSheet is exactly that contract — the
 * name says sheet, the behaviour is "back closes this" — so this reuses it
 * rather than running a second, competing history counter beside it.
 *
 * Steps stack. Register the outer one first (a scout team) and the inner one
 * second (a player inside it) and back walks them in order, because the
 * manager closes the entry registered last.
 */
import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { registerSheet } from '../web/sheetHistory';

/**
 * @param active Whether the step is currently open.
 * @param onBack Undo the step. Called at most once per back press.
 */
export function useBackStep(active: boolean, onBack: () => void) {
  // The handler is reached through a ref so the step registers when it opens
  // and not once per render. onBack is written inline at every call site, so a
  // fresh identity each render would churn the history entry — and re-pushing
  // an entry for a step that never closed is how back stops working at all.
  const latest = useRef(onBack);
  latest.current = onBack;

  useEffect(() => {
    if (!active) return;
    const close = () => latest.current();

    const unregister = Platform.OS === 'web' ? registerSheet(close) : () => {};
    const hardware = Platform.OS !== 'web'
      ? BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; })
      : null;

    return () => {
      unregister();
      hardware?.remove();
    };
  }, [active]);
}
