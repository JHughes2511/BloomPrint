import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * The last answer a screen got, kept so the next cold open is instant.
 *
 * Opening the app used to mean a blank page until the server replied — and on
 * a connection to a database a continent away that is a second of nothing
 * before a coach sees a list that almost certainly has not changed since
 * yesterday. This holds the last payload per screen and hands it back on mount
 * while the real request is in flight.
 *
 * NOT the secure store. That is Keychain and Keystore on a phone, sized for
 * tokens, and a season dashboard is not a secret worth putting there — it is
 * localStorage in a browser and a plain file on a device.
 *
 * Nothing here is authoritative. Every read is stale by definition and every
 * screen using it also fires the live request; if the two disagree the server
 * wins, always. Cached data belongs to one account: the key carries the coach
 * id, and signing out clears the lot.
 */

const isWeb = Platform.OS === 'web';
const PREFIX = 'bp.page.';
const dir = () => `${(FileSystem as any).cacheDirectory ?? ''}bloomprint/`;

/** How long a cached page may be shown before it is withheld as too old. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Entry = { at: number; data: unknown };

const safeName = (key: string) => key.replace(/[^a-zA-Z0-9._-]/g, '_');

export async function readPage<T>(key: string): Promise<T | null> {
  try {
    let raw: string | null = null;
    if (isWeb) {
      raw = globalThis.localStorage?.getItem(PREFIX + key) ?? null;
    } else {
      const path = dir() + safeName(key) + '.json';
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return null;
      raw = await FileSystem.readAsStringAsync(path);
    }
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry;
    // A week-old page is not worth showing even for a moment — at that age the
    // flash of stale data is more confusing than the wait it saves.
    if (!entry?.at || Date.now() - entry.at > MAX_AGE_MS) return null;
    return entry.data as T;
  } catch {
    // A cache that cannot be read is a cache miss, never an error a coach sees.
    return null;
  }
}

export async function writePage(key: string, data: unknown): Promise<void> {
  try {
    const raw = JSON.stringify({ at: Date.now(), data } satisfies Entry);
    if (isWeb) {
      globalThis.localStorage?.setItem(PREFIX + key, raw);
      return;
    }
    await FileSystem.makeDirectoryAsync(dir(), { intermediates: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(dir() + safeName(key) + '.json', raw);
  } catch {
    // Out of quota, private mode, read-only disk: none of these are worth
    // failing a screen over. The page just will not be instant next time.
  }
}

/** Sign-out. One account's cached pages must never greet the next one. */
export async function clearPages(): Promise<void> {
  try {
    if (isWeb) {
      const ls = globalThis.localStorage;
      if (!ls) return;
      for (const k of Object.keys(ls)) if (k.startsWith(PREFIX)) ls.removeItem(k);
      return;
    }
    await FileSystem.deleteAsync(dir(), { idempotent: true });
  } catch {
    /* nothing to clear, or nothing we can do about it */
  }
}
