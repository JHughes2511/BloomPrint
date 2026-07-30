/**
 * Tells the difference between "the server rejected this token" and "the
 * request never got an answer", and lets the auth contexts react to the former.
 *
 * These are not the same event and must not be treated the same. A 401 means
 * the stored token is genuinely dead and keeping it only produces a broken
 * session. A network failure — backend asleep, Wi-Fi dropped, request timed
 * out — says nothing about the token, and discarding it there signs the coach
 * out of a perfectly good session for reasons outside their control.
 */

/** True only when the server actually answered and rejected the credentials. */
export function isAuthRejection(err: any): boolean {
  const status = err?.response?.status;
  return status === 401 || status === 403;
}

type Listener = () => void;

const coachListeners = new Set<Listener>();
const playerListeners = new Set<Listener>();

function subscribe(set: Set<Listener>, fn: Listener) {
  set.add(fn);
  return () => { set.delete(fn); };
}

/** Register a handler for "the coach's token was rejected". Returns an unsubscribe. */
export const onCoachUnauthorized = (fn: Listener) => subscribe(coachListeners, fn);
/** Register a handler for "the player's token was rejected". Returns an unsubscribe. */
export const onPlayerUnauthorized = (fn: Listener) => subscribe(playerListeners, fn);

function emit(set: Set<Listener>) {
  // Copy first: a listener that unsubscribes itself must not disturb this pass.
  for (const fn of Array.from(set)) {
    try { fn(); } catch { /* one bad listener must not block the rest */ }
  }
}

export const emitCoachUnauthorized = () => emit(coachListeners);
export const emitPlayerUnauthorized = () => emit(playerListeners);
