/**
 * Which screen started which job.
 *
 * A long job outlives the screen that began it: a film analysis started in the
 * packet builder finishes whether the coach is still sitting there or has gone
 * to the roster. The banner exists for the second case and must not fire in
 * the first — a screen watching its own progress bar does not need telling.
 *
 * So the route in view when a job starts is recorded against it, and the
 * banner asks whether the coach is still standing there. Kept in a module
 * rather than in React state because the writer is the API client, which has
 * no component around it, and because the answer has to survive the screen
 * unmounting — that unmount IS the case the banner is for.
 */

let current = '';
const startedOn = new Map<number, string>();

/** Called by the navigator whenever the visible screen changes. */
export function setCurrentRoute(name: string) {
  current = name || '';
}

export function currentRoute(): string {
  return current;
}

/** Record that a job was started from wherever the coach is standing now. */
export function noteJobStarted(jobId: number) {
  if (!jobId) return;
  startedOn.set(jobId, current);
  // A coach can leave hundreds of jobs behind in a long session and none of
  // this matters once a job has been announced. Keep the map small rather than
  // let it grow for the lifetime of the tab.
  if (startedOn.size > 200) {
    for (const key of startedOn.keys()) {
      startedOn.delete(key);
      if (startedOn.size <= 100) break;
    }
  }
}

/**
 * Is the coach still on the screen that started this job?
 *
 * Unknown jobs answer no: a job this session never saw start — one from an
 * earlier session, or from another device — is by definition not something the
 * coach is watching.
 */
export function watchingJob(jobId: number): boolean {
  const owner = startedOn.get(jobId);
  return !!owner && owner === current;
}
