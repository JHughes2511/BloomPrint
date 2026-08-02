import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Platform, useColorScheme } from 'react-native';
import * as SecureStore from '../storage/secureStore';
import { ThemeTokens, light, dark } from './tokens';

type Mode = 'light' | 'dark';

type ThemeContextValue = {
  mode: Mode;
  t: ThemeTokens;
  setMode: (m: Mode) => void;
  toggle: () => void;
  /** true until the persisted preference has loaded (system value used meanwhile). */
  ready: boolean;
};

const STORAGE_KEY = 'theme_mode';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme(); // 'light' | 'dark' | null
  const [mode, setModeState] = useState<Mode>(system === 'light' ? 'light' : 'dark');
  const [ready, setReady] = useState(false);

  // Paint the page itself, not just the app inside it.
  //
  // Every screen draws its own gradient, but the document underneath stays the
  // browser default — white. Overscroll a phone browser and that white appears
  // above or below the app, and it is doubly obvious in dark mode. The keyboard
  // accessory bar sits against it too.
  //
  // The first colour of the canvas gradient is the right one to use: it is what
  // the top of every screen already is, so the seam is invisible.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    // The gradient's colours are typed as ColorValue (React Native allows
    // more than strings); CSS only takes a string, so state that here.
    const bg = String((mode === 'light' ? light : dark).canvas.colors[0]);
    document.documentElement.style.backgroundColor = bg;
    document.body.style.backgroundColor = bg;
    // Tells the browser to tint its own overscroll and, on iOS, the status bar
    // area — otherwise the page is dark and the chrome around it is not.
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', bg);
  }, [mode]);

  // Load persisted choice once; fall back to the system setting on first launch.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(STORAGE_KEY);
        if (active && (stored === 'light' || stored === 'dark')) {
          setModeState(stored);
        } else if (active) {
          setModeState(system === 'light' ? 'light' : 'dark');
        }
      } catch {
        // ignore — keep current
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => { active = false; };
    // run once on mount; system is only the first-launch default
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    SecureStore.setItemAsync(STORAGE_KEY, m).catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    setModeState(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const value: ThemeContextValue = {
    mode,
    t: mode === 'light' ? light : dark,
    setMode,
    toggle,
    ready,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
