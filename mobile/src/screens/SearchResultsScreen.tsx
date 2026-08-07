import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { searchAPI } from '../api/client';
import { useTeam } from '../context/TeamContext';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer from '../responsive/PageContainer';
import { topPad } from '../responsive/screenPadding';
import { useGoUp } from '../navigation/goUp';
import { buildSearchGroups, SearchResults } from '../navigation/searchGroups';
import { cached, remember } from '../navigation/searchCache';

/**
 * Everything a search found, when six per group in the sidebar isn't enough.
 *
 * Same builder as the dropdown, so a row here is named the same and goes to the
 * same place — the only difference is how many are asked for.
 */
export default function SearchResultsScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const { setCurrentTeamId } = useTeam();
  const goUp = useGoUp('Recent');

  const [query, setQuery] = useState<string>(route.params?.q ?? '');
  const [results, setResults] = useState<SearchResults | null>(null);
  // The term we actually have an answer for — see the sidebar: "no results" is
  // a claim about a finished search, not a pending one.
  const [settled, setSettled] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (!term) { setResults(null); setSettled(null); return; }
    const hit = cached(term, 50);
    if (hit) { setResults(hit); setSettled(term); }

    let cancelled = false;
    setLoading(true);
    // Same pacing as the sidebar, and the same reason: results that arrive a
    // keystroke behind read as live; results that arrive a beat later read as
    // a page load.
    const timer = setTimeout(() => {
      searchAPI.all(term, 50)
        .then((r: SearchResults) => {
          remember(term, r, 50);
          if (!cancelled) { setResults(r); setSettled(term); }
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 10);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const go = (tab: string, screen: string, params: Record<string, unknown>) => {
    navigation.navigate(tab, { screen, params });
  };
  const groups = buildSearchGroups(results, tr, go, setCurrentTeamId);

  return (
    <ScreenBackground>
      <PageContainer maxWidth={900}>
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.header}>
            <Pressable onPress={() => goUp()} hitSlop={8}>
              <Ionicons name="chevron-back" size={24} color={t.ink} />
            </Pressable>
            <Text style={s.headerTitle}>{tr('search.title')}</Text>
          </View>

          <View style={s.searchWrap}>
            <Ionicons name="search" size={16} color={t.muted2} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={tr('search.placeholder')}
              placeholderTextColor={t.muted2}
              style={s.searchInput}
              autoFocus={!route.params?.q}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={t.muted2} />
              </Pressable>
            )}
          </View>

          {loading && !results ? (
            <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} />
          ) : groups.length === 0 ? (
            <Text style={s.empty}>
              {!query.trim() ? tr('search.typeToSearch')
                : settled === query.trim() ? tr('common.noResults') : ' '}
            </Text>
          ) : (
            groups.map(g => (
              <View key={g.key} style={{ marginTop: 20 }}>
                <Text style={s.groupLabel}>{g.label} · {g.total}</Text>
                {g.rows.map(row => (
                  <Pressable
                    key={row.key}
                    style={({ hovered }: any) => [s.row, hovered && s.rowHover]}
                    onPress={row.onPress}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={s.rowTitle}>{row.title}</Text>
                      {!!row.meta && <Text numberOfLines={1} style={s.rowMeta}>{row.meta}</Text>}
                      {!!row.snippet && (
                        <Text numberOfLines={2} style={s.rowSnippet}>{row.snippet}</Text>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={t.line} />
                  </Pressable>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      </PageContainer>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: topPad(56), paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  headerTitle: { color: t.ink, fontSize: 24, fontFamily: fonts[800], letterSpacing: -0.4 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.card,
    borderWidth: 1, borderColor: t.cardBorder, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  searchInput: { flex: 1, color: t.ink, fontSize: 15, paddingVertical: 0 },
  groupLabel: {
    color: t.label, fontSize: 11, fontFamily: fonts[700],
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.card,
    borderWidth: 1, borderColor: t.cardBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  rowHover: { borderColor: t.accent },
  rowTitle: { color: t.ink, fontSize: 14.5, fontFamily: fonts[600] },
  rowMeta: { color: t.muted2, fontSize: 12, marginTop: 2 },
  rowSnippet: { color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 4, fontStyle: 'italic' },
  empty: { color: t.muted2, fontSize: 14, textAlign: 'center', marginTop: 40 },
});
