/**
 * Browser history for sheets, kept in one place.
 *
 * A sheet is a Modal, which the browser knows nothing about, so back would leave
 * the page instead of closing what's on top. The cure is one history entry per
 * open sheet: back consumes an entry and closes the topmost sheet.
 *
 * Doing that per-sheet is what broke. Each sheet pushed on open and called
 * history.back() on close, and history.back() is ASYNCHRONOUS — it schedules a
 * traversal. Opening one sheet from another (Edit Profile → System & Philosophy)
 * closes and opens in the same tick, so a queued back and a fresh push crossed:
 * the traversal then ran from the new entry, walked past both sheets, and landed
 * on whatever screen the coach had been on before — Staff Hub, typically.
 *
 * So the count is reconciled once per tick instead. Two sheets swapping keeps
 * the depth at one and touches history not at all, which is also what the coach
 * means by it: the sheet on screen changed, so back should still close a sheet.
 */

type Entry = { id: number; close: () => void };

let nextId = 1;
let open: Entry[] = [];
let pushed = 0;          // entries we put on the stack
let ignorePops = 0;      // pops caused by our own history.back()
let scheduled = false;
let listening = false;

const isWeb = () => typeof window !== 'undefined' && typeof window.history !== 'undefined';

function onPopState() {
  if (ignorePops > 0) { ignorePops--; return; }
  if (!pushed) return;               // not ours — a real navigation
  pushed--;
  const top = open[open.length - 1];
  // Closing runs the sheet's own handler, which unregisters it here; the
  // reconcile that follows then sees the depths already agree.
  top?.close();
}

function reconcile() {
  scheduled = false;
  if (!isWeb()) return;
  while (pushed < open.length) {
    window.history.pushState({ bloomprintSheet: true }, '');
    pushed++;
  }
  while (pushed > open.length) {
    pushed--;
    ignorePops++;
    window.history.back();
  }
}

function schedule() {
  if (scheduled || !isWeb()) return;
  scheduled = true;
  // A microtask: after React has finished committing this render's effects, so
  // a close and an open in the same commit are seen together.
  Promise.resolve().then(reconcile);
}

/** Register an open sheet. Returns the unregister for the effect's cleanup. */
export function registerSheet(close: () => void): () => void {
  if (!isWeb()) return () => {};
  if (!listening) {
    window.addEventListener('popstate', onPopState);
    listening = true;
  }
  const entry: Entry = { id: nextId++, close };
  open.push(entry);
  schedule();
  return () => {
    open = open.filter(e => e.id !== entry.id);
    schedule();
  };
}

/** Test seam: forget everything (no history calls). */
export function __resetSheetHistory() {
  open = [];
  pushed = 0;
  ignorePops = 0;
  scheduled = false;
}

/** Test seam: what the manager believes right now. */
export function __sheetHistoryState() {
  return { open: open.length, pushed, ignorePops };
}
