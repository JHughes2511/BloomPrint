import { useCallback, useRef, useState } from 'react';

/**
 * Show what a screen had while it fetches what it has now.
 *
 * Screens reload every time they come into focus, and every reload raised the
 * blocking spinner — so stepping back from a game to the list, or switching a
 * tab and back, blanked a page that was about to redraw the same thing. On a
 * database a network away that is a second of white for no new information.
 *
 * The rule this encodes: a spinner is for having nothing to show. Once a screen
 * has data it keeps it on screen and says, quietly, that it is checking.
 *
 *   const { firstLoad, refreshing, run } = useStaleWhileRefreshing();
 *   const load = useCallback(() => run(async () => setRows(await api.list())), [run]);
 *   ...
 *   {firstLoad ? <Spinner/> : <Rows data={rows} refreshing={refreshing} />}
 */
export function useStaleWhileRefreshing() {
  // Whether anything has ever arrived — NOT whether a request is in flight.
  const loaded = useRef(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const run = useCallback(async (work: () => Promise<void>) => {
    if (loaded.current) setRefreshing(true);
    try {
      await work();
      loaded.current = true;
    } finally {
      setFirstLoad(false);
      setRefreshing(false);
    }
  }, []);

  return { firstLoad, refreshing, run };
}
