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
import { useFocusEffect } from '@react-navigation/native';
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

type SearchRow = { id: number; title: string; meta: string; onPress: () => void };
type SearchResults = {
  players?: { id: number; name: string; position?: string; team_name?: string }[];
  reports?: { id: number; title: string; output_type?: string; player_name?: string }[];
  games?: { id: number; title?: string; opponent_name?: string }[];
  teams?: { id: number; name: string; competition_level?: string }[];
};

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
  const [unread, setUnread] = useState(0);

  useFocusEffect(
    useCallback(() => {
      playerAPI.coachNotifications()
        .then((n: any[]) => setUnread(n.filter(x => !x.read).length))
        .catch(() => {});
    }, []),
  );

  // Debounced, and every in-flight response is checked against the query that
  // is current when it lands. Without that check a slow request for "mar" can
  // resolve after a fast one for "marcus" and overwrite the newer results with
  // older ones — the classic out-of-order search bug, which looks like the box
  // ignoring what you typed.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchAPI.all(term)
        .then((r: SearchResults) => { if (!cancelled) setResults(r); })
        .catch(() => { if (!cancelled) setResults(null); });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const go = (tab: string, screen: string, params: Record<string, unknown>) => {
    setQuery('');
    setResults(null);
    (navigation as any).navigate(tab, { screen, params });
  };

  const groups: { key: string; label: string; rows: SearchRow[] }[] = results
    ? [
        {
          key: 'players',
          label: tr('common.tabs.roster'),
          rows: (results.players ?? []).map(p => ({
            id: p.id,
            title: p.name,
            meta: [p.position, p.team_name].filter(Boolean).join(' · '),
            onPress: () => go('RosterTab', 'PlayerProfile', { playerId: p.id }),
          })),
        },
        {
          key: 'reports',
          label: tr('home.reportTypesHeader'),
          rows: (results.reports ?? []).map(r => ({
            id: r.id,
            title: r.title,
            meta: [r.player_name, r.output_type].filter(Boolean).join(' · '),
            onPress: () => go('RecentTab', 'EvalReport', { evalId: r.id }),
          })),
        },
        {
          key: 'games',
          label: tr('common.tabs.teamEval'),
          rows: (results.games ?? []).map(g => ({
            id: g.id,
            title: g.title || g.opponent_name || '—',
            meta: g.opponent_name ?? '',
            onPress: () => go('TeamTab', 'GameReportBuilder', { reportId: g.id }),
          })),
        },
        {
          key: 'teams',
          label: tr('roster.teams', { defaultValue: 'Teams' }),
          rows: (results.teams ?? []).map(tm => ({
            id: tm.id,
            title: tm.name,
            meta: tm.competition_level ?? '',
            // Selecting a team from search sets the app-wide scope, which is
            // what picking a team means everywhere else.
            onPress: () => { setCurrentTeamId(tm.id); go('RosterTab', 'Roster', {}); },
          })),
        },
      ].filter(g => g.rows.length > 0)
    : [];

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
          placeholder={tr('roster.searchPlaceholder', { defaultValue: 'Search players' })}
          placeholderTextColor={t.muted2}
          style={s.searchInput}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={14} color={t.muted2} />
          </Pressable>
        )}
      </View>

      {query.trim().length >= 2 && (
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
                      key={`${g.key}-${row.id}`}
                      style={({ hovered }: any) => [s.result, hovered && s.itemHover]}
                      onPress={row.onPress}
                    >
                      <Text numberOfLines={1} style={s.resultName}>{row.title}</Text>
                      {!!row.meta && <Text numberOfLines={1} style={s.resultMeta}>{row.meta}</Text>}
                    </Pressable>
                  ))}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* ── Middle: sections ─────────────────────────────────────────── */}
      <ScrollView style={s.items} contentContainerStyle={{ gap: 2 }} showsVerticalScrollIndicator={false}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const label =
            typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            // A tab may cancel its own press (to scroll to top, say); navigating
            // anyway would override that.
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
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
          onPress={() => (navigation as any).navigate('HomeTab', { screen: 'CoachNotifications' })}
          style={({ hovered }: any) => [s.item, hovered && s.itemHover]}
        >
          <View>
            <Ionicons name="notifications-outline" size={20} color={t.muted2} />
            {unread > 0 && (
              <View style={s.badge}>
                <Text style={s.badgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </View>
          <Text numberOfLines={1} style={[s.label, { color: t.muted2 }]}>
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
            <Text numberOfLines={1} style={s.accountSub}>{coach?.program_name ?? ''}</Text>
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
                (navigation as any).navigate('HomeTab', { screen: 'Home' });
              }}
            >
              <Ionicons name="person-outline" size={16} color={t.muted} />
              <Text style={s.menuText}>{tr('home.editProfileLabel')}</Text>
            </Pressable>
            <Pressable
              style={s.menuRow}
              onPress={() => {
                setAccountOpen(false);
                (navigation as any).navigate('HomeTab', { screen: 'StaffInbox' });
              }}
            >
              <Ionicons name="mail-outline" size={16} color={t.muted} />
              <Text style={s.menuText}>{tr('home.staffInboxLabel')}</Text>
            </Pressable>
            <Pressable style={s.menuRow} onPress={() => { setAccountOpen(false); logout(); }}>
              <Ionicons name="log-out-outline" size={16} color={t.negative} />
              <Text style={[s.menuText, { color: t.negative }]}>{tr('home.signOut')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Ask BloomPrint reuses the same component as Home rather than a second
          implementation that would drift from it. */}
      <Modal visible={askOpen} transparent animationType="fade" onRequestClose={() => setAskOpen(false)}>
        <Pressable style={s.overlay} onPress={() => setAskOpen(false)}>
          <Pressable style={s.askSheet} onPress={e => e.stopPropagation()}>
            <CommandBar />
          </Pressable>
        </Pressable>
      </Modal>
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
  accountSub: { color: t.muted2, fontSize: 11 },

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
