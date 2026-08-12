import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, TextInput, Platform,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  questionnaireAPI, QuestionnaireSummary, QuestionnaireRow,
} from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer from '../responsive/PageContainer';
import { topPad } from '../responsive/screenPadding';

/**
 * What came back, for whoever holds the key.
 *
 * The link in every notification email carries `?key=` and lands here. That is
 * deliberate: the results get read on a phone, on a laptop, signed in or not,
 * and a link that only worked while logged in would work about half the times
 * it was tapped.
 *
 * A summary first and the responses underneath, because thirty responses is a
 * pile of text and no picture. The five roles answer the same seven positions,
 * so each question is shown as its options with a bar and a count — which is
 * the shape the questions were written to be read in.
 */
type Tab = 'summary' | 'responses' | 'comments' | 'emails';

export default function QuestionnaireResultsScreen() {
  const route = useRoute<any>();
  const { t, mode, toggle: toggleTheme } = useTheme();
  const s = makeStyles(t);

  // On the web the key is on the address; on a phone it is typed in once.
  const keyFromUrl: string =
    route.params?.key
    ?? (Platform.OS === 'web'
      ? (new URLSearchParams(window.location.search).get('key') ?? '')
      : '');

  const [key, setKey] = useState(keyFromUrl);
  const [typed, setTyped] = useState('');
  const [summary, setSummary] = useState<QuestionnaireSummary | null>(null);
  const [rows, setRows] = useState<QuestionnaireRow[]>([]);
  const [loading, setLoading] = useState(!!keyFromUrl);
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState<Tab>('summary');
  const [role, setRole] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (k: string) => {
    if (!k) return;
    setLoading(true);
    setDenied(false);
    try {
      const [sum, list] = await Promise.all([
        questionnaireAPI.summary(k),
        questionnaireAPI.responses(k),
      ]);
      setSummary(sum);
      setRows(list);
      setKey(k);
    } catch {
      setDenied(true);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (keyFromUrl) load(keyFromUrl); }, [keyFromUrl, load]);

  const copyCsv = async () => {
    try {
      const { csv } = await questionnaireAPI.exportCsv(key);
      if (Platform.OS === 'web') await navigator.clipboard.writeText(csv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* the button just doesn't confirm */ }
  };

  if (!summary && !loading) {
    return (
      <ScreenBackground>
        <ScrollView contentContainerStyle={{ paddingTop: topPad(28), paddingBottom: 60 }}>
          <PageContainer maxWidth={520}>
            <Text style={s.brand}>BLOOMPRINT</Text>
            <Text style={s.h1}>Questionnaire results</Text>
            <Text style={s.lede}>
              This page needs the passcode from the link in your email.
            </Text>
            <View style={[s.panel, { marginTop: 20 }]}>
              <TextInput
                style={s.input}
                value={typed}
                onChangeText={setTyped}
                placeholder="Passcode"
                placeholderTextColor={t.muted2}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                onSubmitEditing={() => load(typed.trim())}
              />
              {denied && <Text style={s.error}>That passcode isn't right.</Text>}
              <TouchableOpacity style={s.cta} onPress={() => load(typed.trim())}>
                <Text style={s.ctaText}>Open</Text>
              </TouchableOpacity>
            </View>
          </PageContainer>
        </ScrollView>
      </ScreenBackground>
    );
  }

  if (loading || !summary) {
    return (
      <ScreenBackground>
        <View style={s.center}><ActivityIndicator color={t.accent} /></View>
      </ScreenBackground>
    );
  }

  const shown = summary.roles.filter(r => !role || r.id === role);
  const listRows = role ? rows.filter(r => r.role === role) : rows;
  // One address per person, newest first — the list that becomes the invite.
  const emails = listRows.filter(r => !!r.email)
    .filter((r, i, all) => all.findIndex(x => x.email === r.email) === i);

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={{ paddingTop: topPad(28), paddingBottom: 60 }}>
        <PageContainer maxWidth={860}>
          <View style={s.brandbar}>
            <Text style={s.brand}>BLOOMPRINT</Text>
            <View style={s.tools}>
              <TouchableOpacity
                style={s.themeBtn}
                onPress={toggleTheme}
                accessibilityRole="button"
                accessibilityLabel={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                <Ionicons name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'}
                          size={16} color={t.muted} />
              </TouchableOpacity>
              <TouchableOpacity style={s.ghostSmall} onPress={() => load(key)}>
                <Ionicons name="refresh" size={14} color={t.muted} />
                <Text style={s.ghostSmallText}>Refresh</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={s.eyebrow}>Discovery questionnaire</Text>
          <Text style={s.h1}>
            {summary.total} {summary.total === 1 ? 'response' : 'responses'}
          </Text>

          {/* Who has answered. Doubles as the filter. */}
          <View style={s.roleRow}>
            <TouchableOpacity
              style={[s.roleTab, !role && s.roleTabOn]}
              onPress={() => setRole('')}
            >
              <Text style={[s.roleTabCount, !role && s.roleTabTextOn]}>{summary.total}</Text>
              <Text style={[s.roleTabName, !role && s.roleTabTextOn]}>Everyone</Text>
            </TouchableOpacity>
            {summary.roles.map(r => (
              <TouchableOpacity
                key={r.id}
                style={[s.roleTab, role === r.id && s.roleTabOn]}
                onPress={() => setRole(role === r.id ? '' : r.id)}
              >
                <Text style={[s.roleTabCount, role === r.id && s.roleTabTextOn]}>{r.count}</Text>
                <Text style={[s.roleTabName, role === r.id && s.roleTabTextOn]}>{r.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={s.tabs}>
            {(['summary', 'responses', 'comments', 'emails'] as Tab[]).map(x => (
              <TouchableOpacity key={x} style={[s.tab, tab === x && s.tabOn]} onPress={() => setTab(x)}>
                <Text style={[s.tabText, tab === x && s.tabTextOn]}>
                  {x === 'summary' ? 'Summary'
                    : x === 'responses' ? `Responses (${listRows.length})`
                    : x === 'comments' ? `Comments (${summary.comments.length})`
                    : `Emails (${emails.length})`}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.ghostSmall} onPress={copyCsv}>
              <Ionicons name={copied ? 'checkmark' : 'download-outline'} size={14} color={t.muted} />
              <Text style={s.ghostSmallText}>{copied ? 'Copied' : 'Copy CSV'}</Text>
            </TouchableOpacity>
          </View>

          {summary.total === 0 && (
            <View style={s.panel}>
              <Text style={s.lede}>Nothing has come in yet. Share the link and this fills up.</Text>
            </View>
          )}

          {tab === 'summary' && shown.map(r => (
            r.count === 0 ? null : (
              <View key={r.id} style={{ marginTop: 22 }}>
                <Text style={s.sectionTitle}>{r.name} · {r.count}</Text>
                {r.questions.map((q, qi) => {
                  // Out of the people who answered THIS question, not out of
                  // everyone in the role — a question nobody reached would
                  // otherwise make every bar look short for the wrong reason.
                  const base = Math.max(1, q.answered);
                  const top = Math.max(...q.options.map(o => o.count), 0);
                  return (
                    <View key={qi} style={s.qcard}>
                      <Text style={s.qnum}>QUESTION {qi + 1}</Text>
                      <Text style={s.qtext}>{q.text}</Text>
                      <View style={{ gap: 7, marginTop: 4 }}>
                        {q.options.map((o, oi) => {
                          const pct = Math.round((o.count / base) * 100);
                          const lead = o.count > 0 && o.count === top;
                          return (
                            <View key={oi} style={s.bar}>
                              <View style={[s.barFill, {
                                width: `${top ? Math.round((o.count / top) * 100) : 0}%`,
                                backgroundColor: lead ? t.accentSoft : t.chip,
                              }]} />
                              <Text style={[s.barText, lead && s.barTextLead]} numberOfLines={2}>{o.text}</Text>
                              <Text style={[s.barCount, lead && s.barTextLead]}>
                                {o.count}{o.count > 0 ? `  ${pct}%` : ''}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </View>
            )
          ))}

          {tab === 'responses' && (
            <View style={{ gap: 12, marginTop: 18 }}>
              {listRows.map(r => (
                <View key={r.id} style={s.qcard}>
                  <View style={s.rowHead}>
                    <Text style={s.rowName}>{r.name}</Text>
                    <Text style={s.rowMeta}>
                      {r.role_name}{r.age_range ? ` · ${r.age_range}` : ''}
                      {r.source ? ` · via ${r.source}` : ''}
                    </Text>
                    {!!r.email && <Text style={s.rowEmail}>{r.email}</Text>}
                  </View>
                  {r.answers.map((a, ai) => (
                    <View key={ai} style={{ marginTop: 8 }}>
                      <Text style={s.rowQ}>{ai + 1}. {a.question}</Text>
                      <Text style={a.answer ? s.rowA : s.rowSkipped}>
                        {Array.isArray(a.answer) ? a.answer.join(' · ') : (a.answer || 'Skipped')}
                      </Text>
                    </View>
                  ))}
                  {!!r.comment && (
                    <View style={s.commentBox}>
                      <Text style={s.rowA}>{r.comment}</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {tab === 'emails' && (
            <View style={{ gap: 12, marginTop: 18 }}>
              <View style={s.panel}>
                <Text style={s.lede}>
                  {emails.length} of {listRows.length} left an address.
                </Text>
                <TouchableOpacity
                  style={s.ghostSmall}
                  onPress={async () => {
                    const list = emails.map(e => e.email).join(', ');
                    if (Platform.OS === 'web') await navigator.clipboard.writeText(list);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  }}
                >
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={t.muted} />
                  <Text style={s.ghostSmallText}>{copied ? 'Copied' : 'Copy all addresses'}</Text>
                </TouchableOpacity>
              </View>
              {emails.map(e => (
                <View key={e.id} style={[s.qcard, { marginTop: 0 }]}>
                  <Text style={s.rowName}>{e.name}</Text>
                  <Text style={s.rowMeta}>{e.role_name}{e.age_range ? ` · ${e.age_range}` : ''}</Text>
                  <Text style={s.rowEmail}>{e.email}</Text>
                </View>
              ))}
            </View>
          )}

          {tab === 'comments' && (
            <View style={{ gap: 12, marginTop: 18 }}>
              {summary.comments.length === 0 && (
                <View style={s.panel}><Text style={s.lede}>No one has written anything yet.</Text></View>
              )}
              {summary.comments.map(cm => (
                <View key={cm.id} style={s.qcard}>
                  <Text style={s.rowMeta}>{cm.name} · {cm.role_name}</Text>
                  <Text style={[s.rowA, { marginTop: 6, fontSize: 15.5 }]}>{cm.comment}</Text>
                </View>
              ))}
            </View>
          )}
        </PageContainer>
      </ScrollView>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  brandbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  brand: { color: t.label, fontFamily: fonts[800], fontSize: 13, letterSpacing: 2.6 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  themeBtn: {
    width: 34, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: t.cta2Border,
  },
  eyebrow: { color: t.label, fontFamily: fonts[700], fontSize: 11.5, letterSpacing: 2 },
  h1: { color: t.ink, fontFamily: fonts[800], fontSize: 30, letterSpacing: -0.6, marginTop: 6 },
  lede: { color: t.inkSoft, fontFamily: fonts[400], fontSize: 15, lineHeight: 22 },
  sectionTitle: { color: t.ink, fontFamily: fonts[800], fontSize: 18, marginBottom: 10 },

  panel: {
    backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder,
    borderRadius: 18, padding: 20, gap: 12,
  },
  input: {
    backgroundColor: t.chip, borderWidth: 1, borderColor: t.line, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, color: t.ink, fontFamily: fonts[500], fontSize: 15.5,
  },
  cta: {
    backgroundColor: t.ctaBg, borderRadius: 999, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 15 },
  error: { color: t.negative, fontFamily: fonts[600], fontSize: 14 },

  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  roleTab: {
    backgroundColor: t.chip, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 1.5, borderColor: 'transparent', minWidth: 92,
  },
  roleTabOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
  roleTabCount: { color: t.ink, fontFamily: fonts[900], fontSize: 20, letterSpacing: -0.4 },
  roleTabName: { color: t.muted, fontFamily: fonts[600], fontSize: 12 },
  roleTabTextOn: { color: t.ink },

  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18, alignItems: 'center' },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: t.chip },
  tabOn: { backgroundColor: t.accent },
  tabText: { color: t.inkSoft, fontFamily: fonts[600], fontSize: 13 },
  tabTextOn: { color: '#FFFFFF' },
  ghostSmall: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: t.cta2Border, borderRadius: 999,
    paddingVertical: 7, paddingHorizontal: 13,
  },
  ghostSmallText: { color: t.muted, fontFamily: fonts[600], fontSize: 12.5 },

  qcard: {
    backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder,
    borderRadius: 16, padding: 18, marginTop: 10,
  },
  qnum: { color: t.label, fontFamily: fonts[800], fontSize: 10.5, letterSpacing: 1.6 },
  qtext: { color: t.ink, fontFamily: fonts[700], fontSize: 15.5, lineHeight: 22, marginTop: 5 },

  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 9, paddingVertical: 9, paddingHorizontal: 11,
    borderWidth: 1, borderColor: t.line, overflow: 'hidden',
  },
  // Absolute so the bar sits BEHIND the label rather than pushing it along —
  // a row whose text moves with its own value is unreadable down a column.
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  barText: { color: t.inkSoft, fontFamily: fonts[500], fontSize: 13.5, flex: 1, lineHeight: 19 },
  barCount: { color: t.muted, fontFamily: fonts[700], fontSize: 12.5, fontVariant: ['tabular-nums'] },
  barTextLead: { color: t.ink },

  rowHead: { borderBottomWidth: 1, borderBottomColor: t.divider, paddingBottom: 9 },
  rowName: { color: t.ink, fontFamily: fonts[800], fontSize: 16 },
  rowMeta: { color: t.muted, fontFamily: fonts[600], fontSize: 12.5, marginTop: 2 },
  rowEmail: { color: t.accent, fontFamily: fonts[600], fontSize: 13, marginTop: 3 },
  rowQ: { color: t.muted, fontFamily: fonts[600], fontSize: 12.5, lineHeight: 18 },
  rowA: { color: t.ink, fontFamily: fonts[500], fontSize: 14.5, lineHeight: 21, marginTop: 2 },
  rowSkipped: { color: t.muted2, fontFamily: fonts[400], fontSize: 14, fontStyle: 'italic', marginTop: 2 },
  commentBox: {
    marginTop: 12, backgroundColor: t.chip, borderRadius: 10, padding: 12,
    borderLeftWidth: 3, borderLeftColor: t.accent,
  },
});
