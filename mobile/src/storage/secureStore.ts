/**
 * Key/value storage that works on phones and in a browser.
 *
 * expo-secure-store has no web implementation — importing it into a web build
 * throws at call time, which would break sign-in, theme and language on day one
 * of the browser version. This module keeps the same three function names, so
 * the rest of the app changes only its import line.
 *
 * On iOS and Android this IS expo-secure-store: Keychain and Keystore, hardware
 * backed, unchanged from before.
 *
 * On web it is localStorage, and that is a real downgrade worth being explicit
 * about: anything in localStorage is readable by any script running on the page,
 * so an XSS bug becomes a stolen session. The web-standard fix is an httpOnly
 * cookie the page can't read, which needs the API to set and clear it — backend
 * work, not a client shim. Until then a browser session is as safe as the app's
 * script supply chain.
 *
 * There is no security cliff for existing users: nothing about the native apps
 * changes here.
 */
import { Platform } from 'react-native';

// Static imports so Metro can tree-shake the unused branch per platform, and so
// a missing native module can never surface as a runtime require() error.
import * as SecureStore from 'expo-secure-store';

const isWeb = Platform.OS === 'web';

/** localStorage is absent in SSR and blocked outright in some privacy modes. */
function webStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Safari with cookies disabled throws on access rather than returning null.
    return null;
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return webStorage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      webStorage()?.setItem(key, value);
    } catch {
      // Quota exceeded or storage disabled. The caller's flow should continue —
      // the user stays signed in for this tab, just not the next one.
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (isWeb) {
    try {
      webStorage()?.removeItem(key);
    } catch {
      // Nothing to do: failing to clear must never block a sign-out.
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
