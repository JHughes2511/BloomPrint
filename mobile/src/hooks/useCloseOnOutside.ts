import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * Close an open dropdown when the pointer goes down anywhere else.
 *
 * Every dropdown in the app opened on a tap and would only close on another tap
 * of the same control — clicking away left it hanging over the page, so the way
 * out of a menu was to find the thing you had just opened. That is not how a
 * menu behaves anywhere else, and on a form with several of them you could end
 * up with two open at once.
 *
 * Attach the returned ref to the element that wraps BOTH the trigger and the
 * menu; a press inside it is left alone, so choosing an option still works and
 * a text field inside the menu keeps focus.
 *
 * Web only by construction: React Native has no document to listen to, and on a
 * phone a tap outside already falls through to whatever is underneath.
 */
export function useCloseOnOutside(open: boolean, close: () => void) {
  const ref = useRef<any>(null);
  // Kept in a ref so the listener does not have to be town down and rebuilt
  // every time the parent re-renders with a new closure.
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (Platform.OS !== 'web' || !open) return;
    const onDown = (e: any) => {
      const node = ref.current as any;
      // react-native-web gives back the DOM node for a View ref.
      if (node && typeof node.contains === 'function' && !node.contains(e.target)) {
        closeRef.current();
      }
    };
    // 'click', not 'pointerdown'. Closing on the press half of a click removes
    // this menu from the layout while the pointer is still down, so everything
    // below it jumps up and the release lands on whatever slid into that
    // position — clicking straight from an open menu onto another control hit
    // the wrong thing, or nothing. Waiting for the full click lets the intended
    // target act first.
    //
    // Capture phase, so a menu row that closes itself has not yet unmounted:
    // e.target detached from the DOM would make contains() answer false for a
    // click that WAS inside.
    document.addEventListener('click', onDown, true);
    return () => document.removeEventListener('click', onDown, true);
  }, [open]);

  return ref;
}
