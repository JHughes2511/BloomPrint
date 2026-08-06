import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * How many pixels at the bottom of the window the on-screen keyboard is covering.
 *
 * On a phone browser this is the only reliable answer. React Native's
 * KeyboardAvoidingView listens for Keyboard events that react-native-web never
 * emits, so a sheet anchored to the bottom of the screen sits underneath the
 * keyboard with the field you are typing into hidden behind it. Mobile Safari
 * in particular does not shrink the layout viewport when the keyboard opens —
 * it only shrinks the VISUAL viewport, which is exactly what this measures.
 *
 * Returns 0 off the web, and 0 in a browser with no visualViewport, so callers
 * can add it unconditionally.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const vv = (window as any).visualViewport;
    if (!vv) return;
    const update = () => {
      // offsetTop counts the part scrolled out of view above; without it a page
      // pushed up by the focus lands here as phantom keyboard height.
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setInset(covered > 40 ? Math.round(covered) : 0);   // ignore browser chrome
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
