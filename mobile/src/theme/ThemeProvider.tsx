import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useColorScheme } from 'react-native';
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
