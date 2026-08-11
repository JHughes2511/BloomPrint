import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';

/**
 * The screen above this one.
 *
 * A screen's back arrow means "up a level", not "wherever I happened to be
 * before". goBack() only does that while the screen sits ON something: open a
 * packet from the Team Eval list and the stack is [Team Eval, Packet], so
 * goBack() lands on Team Eval and all is well.
 *
 * It stops being true the moment a screen is reached some other way. A link, a
 * refresh, or a jump from another tab can leave a stack holding that one
 * screen — and then goBack() has nothing to pop and does nothing at all, or
 * falls out of the tab entirely and lands on Home. Either way the coach is not
 * where they expected: the way back to the Team Eval list is through a screen
 * they were never on.
 *
 * So when there is nothing to pop, this climbs to the top of the tab the screen
 * belongs to — the page you would have had to be on to get here.
 */

/** The screen at the top of each tab. */
export const TAB_ROOT: Record<string, string> = {
  HomeTab: 'Home',
  TeamTab: 'Team',
  TeamEvalTab: 'TeamEval',
  RosterTab: 'Roster',
  RecentTab: 'Recent',
  // Player app
  PlayerHomeTab: 'PlayerHome',
  InboxTab: 'PlayerInbox',
  TrainingTab: 'PlayerTraining',
  PlayerNotifsTab: 'PlayerNotifications',
};

/**
 * @param fallback Root screen to climb to, when this screen's tab cannot be
 *   read from navigation state (or a screen wants a different parent).
 */
export function useGoUp(fallback?: string) {
  const navigation = useNavigation<any>();

  return useCallback(() => {
    // Deliberately NOT canGoBack(): that answers "can ANY navigator go back",
    // parents included, so on a screen sitting alone in its stack it says yes
    // and goBack() hands the request up to the tab navigator — which switches
    // to whatever tab was used last. That is the jump to Home this exists to
    // stop. Only this stack's own depth decides whether there is a screen
    // underneath to return to.
    const state = navigation.getState?.();
    const canPopHere = state?.type === 'stack' && (state?.index ?? 0) > 0;
    if (canPopHere) {
      navigation.goBack();
      return;
    }
    // Nothing underneath. Find which tab this screen is in and go to its top.
    let root = fallback;
    if (!root) {
      const tab = navigation.getParent?.();
      const state = tab?.getState?.();
      const name = state?.routes?.[state?.index ?? 0]?.name;
      root = name ? TAB_ROOT[name] : undefined;
    }
    if (root) navigation.navigate(root as never);
  }, [navigation, fallback]);
}
