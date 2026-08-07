import * as SecureStore from '../storage/secureStore';

const KEY = 'pending_join_code';

/**
 * An invite code held across signup.
 *
 * Creating an account swaps the whole navigator — the signed-out stack goes
 * away and the coach or player app takes its place — so a screen cannot simply
 * navigate onward to finish joining. The code is parked here instead, and the
 * home screen of whichever app appears picks it up and completes the join.
 *
 * Persisted rather than kept in memory, so a signup that involves a page
 * reload (Google, or a browser round trip) does not silently lose the team the
 * person was invited to.
 */
export async function setPendingJoin(code: string): Promise<void> {
  try { await SecureStore.setItemAsync(KEY, code); } catch {}
}

/** Read and clear — a join is finished once, not on every visit home. */
export async function takePendingJoin(): Promise<string | null> {
  try {
    const code = await SecureStore.getItemAsync(KEY);
    if (code) await SecureStore.deleteItemAsync(KEY);
    return code || null;
  } catch {
    return null;
  }
}
