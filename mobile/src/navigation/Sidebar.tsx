/**
 * Desktop navigation: the bottom tabs plus everything a browser user expects
 * to have permanently in reach.
 *
 * React Navigation's own `tabBarPosition: 'left'` gets close, but sizes the
 * rail as a fraction of the window — measured at 360px on a 1440px screen,
 * a quarter of the display for five links — and its active state is a
 * saturated pill that fights the palette. Width and emphasis are exactly what
 * a sidebar needs to control, so this renders the navigation state directly.
 *
 * Three zones, because a flat list of nine gives account controls the same
 * weight as the main sections:
 *
 *   top     wordmark, team switcher, player search
 *   middle  the five sections, plus Ask BloomPrint
 *   bottom  notifications, light/dark, account menu
 *
 * Nav items read from the navigator's own descriptors, so adding a tab in
 * App.tsx adds it here with no further work.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Modal } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { TAB_ROOT } from './goUp';
import { StackActions, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { useTeam } from '../context/TeamContext';
import { useAuth } from '../context/AuthContext';
import { searchAPI, playerAPI } from '../api/client';
import CommandBar from '../components/CommandBar';

export const SIDEBAR_WIDTH = 248;

import { buildSearchGroups, hasMore, totalFound, SearchResults } from './searchGroups';
import { cached, remember } from './searchCache';
import { ensureIndex, matchIndex } from './searchIndex';

export default function Sidebar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { t, mode, toggle } = useTheme();
  const { t: tr } = useTranslation();
  const { coach, logout } = useAuth();
  const { teams, currentTeamId, currentTeam, setCurrentTeamId } = useTeam();
  const s = makeStyles(t);

  const [teamOpen, setTeamOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  // The term whose answer we actually have. "No matches" is a statement about a
  // finished search, so it must not be said about one still in flight — on the
  // first letter typed there is nothing to show yet, and claiming there are no
  // matches for a quarter of a second is worse than showing nothing.
  const [settled, setSettled] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  const countUnread = useCallback(() => {
    playerAPI.coachNotifications()
      .then((n: any[]) => setUnread(n.filter(x => !x.read).length))
      .catch(() => {});
  }, []);

  useFocusEffect(countUnread);

  // Fetched once, up front: a coach who opens the app and immediately searches
  // should not be the one person who waits for it.
  useEffect(() => { ensureIndex(); }, []);

  // Debounced, and every in-flight response is checked against the query that
  // is current when it lands. Without that check a slow request for "mar" can
  // resolve after a fast one for "marcus" and overwrite the newer results with
  // older ones — the classic out-of-order search bug, which looks like the box
  // ignoring what you typed.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults(null);
      setSettled(null);
      return;
    }
    // Answer NOW, from names held in memory. This is the whole difference
    // between a list that keeps up with typing and one that trails it: the
    // round trip is ~300ms on a real connection, and no amount of tuning the
    // delay before a request fixes a delay that is the request. A term already
    // answered this session is better still — it has the deep matches too.
    ensureIndex();
    const known = cached(term) ?? matchIndex(term);
    if (known) { setResults(known); setSettled(term); }

    let cancelled = false;
    // The full search runs behind that and replaces it when it lands, because
    // it knows what the index cannot: matches inside the text of a report.
    // Enough delay to coalesce the pair of events one key press can produce,
    // and no more — the out-of-order guard above is what makes it safe.
    const timer = setTimeout(() => {
      searchAPI.all(term)
        .then((r: SearchResults) => {
          remember(term, r);
          if (!cancelled) { setResults(r); setSettled(term); }
        })
        // The previous results stay on screen rather than being wiped: emptying
        // the list on every keystroke makes a list that is actually updating
        // look like one that keeps losing its mind.
        .catch(() => {});
    }, 10);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  // Staff Hub and Notifications are screens inside a tab's stack, not tabs of
  // their own, so the navigator's idea of "where am I" is the tab — and the
  // sidebar lit Home while showing the staff inbox. Reading the focused screen
  // out of the nested state is what tells those two rows apart from Home.
  const focusedTab: any = state.routes[state.index];
  const nested = focusedTab?.state;
  const screenName: string | undefined =
    nested?.routes?.[nested.index ?? nested.routes.length - 1]?.name;
  // A conversation and a team page are both reached from the staff inbox and
  // belong to it — the rail should keep marking Staff Hub, not fall back to the
  // tab the stack happens to live in.
  const STAFF_SCREENS = ['StaffInbox', 'Conversation', 'TeamDetail'];
  const staffActive = STAFF_SCREENS.includes(screenName ?? '');
  const notifsActive = screenName === 'CoachNotifications';
  // While one of those is showing, no tab is the current section.
  const inBottomZone = staffActive || notifsActive;

  // The rail mounts once and never unmounts, so its useFocusEffect fires a
  // single time: reading a notification left the badge showing until a full
  // page reload. Recount whenever the screen changes, and keep it live while
  // the coach is actually on the notifications screen clearing them.
  useEffect(() => {
    countUnread();
    if (!notifsActive) return;
    const id = setInterval(countUnread, 5000);
    return () => clearInterval(id);
  }, [screenName, focusedTab?.name, notifsActive, countUnread]);

  const go = (tab: string, screen: string, params: Record<string, unknown>) => {
    setQuery('');
    setResults(null);
    (navigation as any).navigate(tab, { screen, params });
  };

  const groups = buildSearchGroups(results, tr, go, setCurrentTeamId);

  return (
    <View style={s.rail}>
      {/* ── Top: identity, scope, find ───────────────────────────────── */}
      <Text style={s.wordmark}>BLOOMPRINT</Text>

      <Pressable style={s.switcher} onPress={() => setTeamOpen(true)}>
        <Ionicons name="people-outline" size={16} color={t.muted} />
        <Text numberOfLines={1} style={s.switcherText}>
          {currentTeam?.name ?? tr('roster.allTeams')}
        </Text>
        <Ionicons name="chevron-down" size={14} color={t.muted2} />
      </Pressable>

      <View style={s.searchWrap}>
        <Ionicons name="search" size={14} color={t.muted2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={tr('search.placeholder')}
          placeholderTextColor={t.muted2}
          style={s.searchInput}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={14} color={t.muted2} />
          </Pressable>
        )}
      </View>

      {query.trim().length >= 1 && (groups.length > 0 || settled === query.trim()) && (
        <View style={s.results}>
          {groups.length === 0 ? (
            <Text style={s.noResults}>{tr('common.noResults', { defaultValue: 'No matches' })}</Text>
          ) : (
            <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
              {groups.map(g => (
                <View key={g.key}>
                  <Text style={s.resultGroup}>{g.label}</Text>
                  {g.rows.map(row => (
                    <Pressable
                      key={row.key}
                      style={({ hovered }: any) => [s.result, hovered && s.itemHover]}
                      onPress={row.onPress}
                    >
                      <Text numberOfLines={1} style={s.resultName}>{row.title}</Text>
                      {!!row.meta && <Text numberOfLines={1} style={s.resultMeta}>{row.meta}</Text>}
                      {/* Why this matched, when the words are in the report
                          rather than its name. */}
                      {!!row.snippet && (
                        <Text numberOfLines={2} style={s.resultSnippet}>{row.snippet}</Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              ))}
              {/* Six per group keeps the dropdown a dropdown. When there is
                  more, say so — silently showing the first few reads as "that
                  is everything". */}
              {hasMore(groups) && (
                <Pressable
                  style={({ hovered }: any) => [s.seeAll, hovered && s.itemHover]}
                  onPress={() => go('RecentTab', 'SearchResults', { q: query.trim() })}
                >
                  <Text style={s.seeAllText}>
                    {tr('search.seeAll', { count: totalFound(groups) })}
                  </Text>
                  <Ionicons name="arrow-forward" size={13} color={t.accent} />
                </Pressable>
              )}
            </ScrollView>
          )}
        </View>
      )}

      {/* ── Middle: sections ─────────────────────────────────────────── */}
      <ScrollView style={s.items} contentContainerStyle={{ gap: 2 }} showsVerticalScrollIndicator={false}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          // Two ideas of focus: `tabFocused` is where the navigator is, which
          // decides whether a press has anywhere to go; `focused` is what the
          // sidebar shows as the current section.
          const tabFocused = state.index === index;
          const focused = tabFocused && !inBottomZone;
          const label =
            typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            // A tab may cancel its own press (to scroll to top, say); acting
            // anyway would override that.
            if (event.defaultPrevented) return;

            // Popping to the top is done here rather than left to the screen's
            // own tabPress listener. That listener reads state through the
            // screen it is attached to, and a tab screen does not re-render
            // when the stack nested inside it changes — so from Staff Hub > a
            // team, pressing Home could find a stale depth of zero, decline to
            // pop, and do nothing at all. The tab bar re-renders on every
            // navigation change, so the route object here is always current.
            const nested: any = (route as any).state;
            if (tabFocused) {
              if (nested?.key && (nested.index ?? 0) > 0) {
                navigation.dispatch({ ...StackActions.popToTop(), target: nested.key });
              }
              return;
            }
            // The tab's ROOT, said explicitly, rather than route.params.
            //
            // Params stick to a tab route: opening Staff Hub is a navigate to
            // HomeTab with {screen: 'StaffInbox'}, and that stays on the tab.
            // Handing those same params back on the next press sent the coach
            // to Staff Hub every time they asked for Home — the one screen the
            // Home button could not reach.
            const root = TAB_ROOT[route.name];
            navigation.navigate(route.name, root ? { screen: root } : undefined);
            if (nested?.key && (nested.index ?? 0) > 0) {
              navigation.dispatch({ ...StackActions.popToTop(), target: nested.key });
            }
          };

          const color = focused ? t.accent : t.muted2;
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              style={({ hovered }: any) => [s.item, hovered && !focused && s.itemHover, focused && s.itemActive]}
            >
              {options.tabBarIcon?.({ focused, color, size: 20 })}
              <Text numberOfLines={1} style={[s.label, { color }, focused && s.labelActive]}>
                {String(label)}
              </Text>
            </Pressable>
          );
        })}

        <Pressable
          onPress={() => setAskOpen(true)}
          style={({ hovered }: any) => [s.item, s.ask, hovered && s.itemHover]}
        >
          <Ionicons name="sparkles-outline" size={20} color={t.accent} />
          <Text numberOfLines={1} style={[s.label, { color: t.accent }]}>
            {tr('home.askBloomprint', { defaultValue: 'Ask BloomPrint' })}
          </Text>
        </Pressable>
      </ScrollView>

      {/* ── Bottom: alerts, appearance, account ──────────────────────── */}
      <View style={s.bottom}>
        <Pressable
          onPress={() => (navigation as any).navigate('HomeTab', { screen: 'StaffInbox' })}
          accessibilityRole="button"
          accessibilityState={{ selected: staffActive }}
          style={({ hovered }: any) => [s.item, hovered && !staffActive && s.itemHover, staffActive && s.itemActive]}
        >
          <Ionicons name="people-circle-outline" size={20} color={staffActive ? t.accent : t.muted2} />
          <Text numberOfLines={1} style={[s.label, { color: staffActive ? t.accent : t.muted2 }, staffActive && s.labelActive]}>
            {tr('staffHub.title')}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => (navigation as any).navigate('HomeTab', { screen: 'CoachNotifications' })}
          accessibilityRole="button"
          accessibilityState={{ selected: notifsActive }}
          style={({ hovered }: any) => [s.item, hovered && !notifsActive && s.itemHover, notifsActive && s.itemActive]}
        >
          <View>
            <Ionicons name="notifications-outline" size={20} color={notifsActive ? t.accent : t.muted2} />
            {unread > 0 && (
              <View style={s.badge}>
                <Text style={s.badgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </View>
          <Text numberOfLines={1} style={[s.label, { color: notifsActive ? t.accent : t.muted2 }, notifsActive && s.labelActive]}>
            {tr('home.notificationsLabel')}
          </Text>
        </Pressable>

        <Pressable onPress={toggle} style={({ hovered }: any) => [s.item, hovered && s.itemHover]}>
          <Ionicons name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'} size={20} color={t.muted2} />
          <Text numberOfLines={1} style={[s.label, { color: t.muted2 }]}>
            {tr('home.toggleTheme')}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setAccountOpen(true)}
          style={({ hovered }: any) => [s.account, hovered && s.itemHover]}
        >
          <View style={s.avatar}>
            <Text style={s.avatarText}>{(coach?.name ?? '?').slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={s.accountName}>{coach?.name ?? ''}</Text>
            {/* Title over program: it is the more specific of the two, and a
                coach reading their own row knows their program already. */}
            {/* Two lines: a real job title is longer than a 248px rail, and
                truncating it to "Director of Player Devel…" tells the reader
                less than a second line costs. */}
            <Text numberOfLines={2} style={s.accountSub}>
              {(coach as any)?.job_title || coach?.program_name || ''}
            </Text>
          </View>
          <Ionicons name="ellipsis-horizontal" size={16} color={t.muted2} />
        </Pressable>
      </View>

      {/* ── Team switcher ────────────────────────────────────────────── */}
      <Modal visible={teamOpen} transparent animationType="fade" onRequestClose={() => setTeamOpen(false)}>
        <Pressable style={s.overlay} onPress={() => setTeamOpen(false)}>
          <View style={s.menu}>
            <Text style={s.menuTitle}>{tr('roster.teams', { defaultValue: 'Teams' })}</Text>
            <Pressable
              style={[s.menuRow, currentTeamId == null && s.menuRowActive]}
              onPress={() => { setCurrentTeamId(null); setTeamOpen(false); }}
            >
              <Text style={s.menuText}>{tr('roster.allTeams')}</Text>
              {currentTeamId == null && <Ionicons name="checkmark" size={16} color={t.accent} />}
            </Pressable>
            {teams.map(team => (
              <Pressable
                key={team.id}
                style={[s.menuRow, currentTeamId === team.id && s.menuRowActive]}
                onPress={() => { setCurrentTeamId(team.id); setTeamOpen(false); }}
              >
                <Text numberOfLines={1} style={s.menuText}>{team.name}</Text>
                {currentTeamId === team.id && <Ionicons name="checkmark" size={16} color={t.accent} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* ── Account menu ─────────────────────────────────────────────── */}
      <Modal visible={accountOpen} transparent animationType="fade" onRequestClose={() => setAccountOpen(false)}>
        <Pressable style={s.overlay} onPress={() => setAccountOpen(false)}>
          <View style={s.menu}>
            <Text style={s.menuTitle}>{coach?.email ?? ''}</Text>
            <Pressable
              style={s.menuRow}
              onPress={() => {
                setAccountOpen(false);
                // Home already opens this modal on request — Ask BloomPrint
                // uses the same param — so reuse it rather than landing the
                // coach on Home and making them find the button.
                (navigation as any).navigate('HomeTab', {
                  screen: 'Home',
                  params: { openEditProfile: true },
                });
              }}
            >
              <Ionicons name="person-outline" size={16} color={t.muted} />
              <Text style={s.menuText}>{tr('home.editProfileLabel')}</Text>
            </Pressable>
            <Pressable style={s.menuRow} onPress={() => { setAccountOpen(false); logout(); }}>
              <Ionicons name="log-out-outline" size={16} color={t.negative} />
              <Text style={[s.menuText, { color: t.negative }]}>{tr('home.signOut')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Driven directly rather than wrapped in another modal: the component
          owns its own sheet, so nesting it meant two clicks to reach the chat. */}
      <CommandBar open={askOpen} onOpenChange={setAskOpen} hideTrigger />
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  rail: {
    width: SIDEBAR_WIDTH,
    paddingTop: 22,
    paddingHorizontal: 12,
    paddingBottom: 14,
    backgroundColor: t.isDark ? '#0C2331' : '#EFE7DA',
    borderRightWidth: 1,
    borderRightColor: t.divider,
  },
  wordmark: {
    color: t.accent, fontSize: 12, fontFamily: fonts[800],
    letterSpacing: 2, marginLeft: 14, marginBottom: 16,
  },

  switcher: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, height: 38, borderRadius: 10,
    borderWidth: 1, borderColor: t.line, backgroundColor: t.chip, marginBottom: 8,
  },
  switcherText: { flex: 1, color: t.ink, fontSize: 13, fontFamily: fonts[600] },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, height: 36, borderRadius: 10,
    backgroundColor: t.chip, borderWidth: 1, borderColor: t.line, marginBottom: 10,
  },
  searchInput: { flex: 1, color: t.ink, fontSize: 13, paddingVertical: 0 },
  results: {
    backgroundColor: t.card, borderRadius: 10, borderWidth: 1, borderColor: t.cardBorder,
    marginBottom: 10, overflow: 'hidden',
  },
  result: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.divider },
  resultGroup: {
    color: t.muted2, fontSize: 10, fontFamily: fonts[700], textTransform: 'uppercase',
    letterSpacing: 1, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4,
  },
  noResults: { color: t.muted2, fontSize: 12, padding: 12 },
  resultName: { color: t.ink, fontSize: 13, fontFamily: fonts[600] },
  resultMeta: { color: t.muted2, fontSize: 11 },
  resultSnippet: { color: t.muted, fontSize: 11, lineHeight: 15, marginTop: 3, fontStyle: 'italic' },
  seeAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  seeAllText: { color: t.accent, fontSize: 12, fontFamily: fonts[700] },

  items: { flex: 1 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    height: 44, paddingHorizontal: 14, borderRadius: 10,
  },
  // A tint, not a solid fill: the active row should read as selected rather
  // than as a button sitting on top of the navigation.
  itemActive: { backgroundColor: t.accentSoft },
  itemHover: { backgroundColor: t.chip },
  label: { fontSize: 14, fontFamily: fonts[600], flexShrink: 1 },
  labelActive: { fontFamily: fonts[700] },
  ask: { marginTop: 8, borderWidth: 1, borderColor: t.cta2Border, borderStyle: 'dashed' },

  bottom: { borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 8, gap: 2 },
  badge: {
    position: 'absolute', top: -4, right: -6, minWidth: 15, height: 15, borderRadius: 8,
    backgroundColor: t.negative, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontFamily: fonts[700] },
  account: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, marginTop: 2,
  },
  avatar: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: t.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: t.accent, fontSize: 12, fontFamily: fonts[800] },
  accountName: { color: t.ink, fontSize: 13, fontFamily: fonts[700] },
  accountSub: { color: t.muted2, fontSize: 11, lineHeight: 14 },

  overlay: { flex: 1, backgroundColor: t.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  menu: {
    minWidth: 280, maxWidth: 420, backgroundColor: t.sheet, borderRadius: 14,
    borderWidth: 1, borderColor: t.cardBorder, overflow: 'hidden',
  },
  menuTitle: {
    color: t.muted, fontSize: 11, fontFamily: fonts[700],
    textTransform: 'uppercase', letterSpacing: 1, padding: 14, paddingBottom: 8,
  },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 13, borderTopWidth: 1, borderTopColor: t.divider,
  },
  menuRowActive: { backgroundColor: t.accentSoft },
  menuText: { color: t.inkSoft, fontSize: 14, flexShrink: 1 },
  askSheet: { width: '100%', maxWidth: 640, backgroundColor: t.sheet, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: t.cardBorder },
});
