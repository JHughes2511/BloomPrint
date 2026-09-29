/**
 * Standard | Short: the switch above a report, and the short page itself.
 *
 * The short version is made on the server from the standard text (api/
 * short_versions.py) the first time someone opens Short, then kept. Every
 * field can be edited in place, and a written correction comes back in the
 * same format. If the coach has changed it and the standard report changes
 * afterwards, their version stays and a note offers to remake it.
 *
 * Two page shapes: a team PRACTICE SHEET (practice plan with times and coach,
 * the emphasis list, the play sheet, notes), and a player CHECKLIST (focus,
 * drills with amount and cue, key cues).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { shortAPI } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { useTranslation } from 'react-i18next';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

export type ShortKind = 'training' | 'team_report' | 'packet_training';

/** The segmented control. */
export function VersionSwitch({ value, onChange, style }: { value: 'standard' | 'short'; onChange: (v: 'standard' | 'short') => void; style?: any }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  return (
    <View style={[s.switch, style]} accessibilityRole="tablist">
      {(['standard', 'short'] as const).map(v => (
        <TouchableOpacity key={v} style={[s.switchBtn, value === v && s.switchOn]} onPress={() => onChange(v)}
                          accessibilityRole="tab" accessibilityState={{ selected: value === v }}>
          <Text style={[s.switchText, value === v && s.switchTextOn]}>{tr(`shortVersion.${v}`)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/**
 * A report with its Standard | Short switch. `children` is the standard
 * report as the screen already draws it.
 */
export function WithShortVersion({ kind, refId, children, switchStyle }: {
  kind: ShortKind; refId: number | null | undefined; children: React.ReactNode; switchStyle?: any;
}) {
  const [mode, setMode] = useState<'standard' | 'short'>('standard');
  if (!refId) return <>{children}</>;
  return (
    <View>
      <VersionSwitch value={mode} onChange={setMode} style={switchStyle} />
      {mode === 'standard' ? children : <ShortVersionView kind={kind} refId={refId} />}
    </View>
  );
}

/** Checkboxes on a player's checklist rows: done, and what a tap does. */
export type ShortTicks = { isDone: (row: any) => boolean; toggle: (row: any) => void };

export function ShortVersionView({ kind, refId, fetcher, readOnly, ticks }: {
  kind: ShortKind; refId: number;
  fetcher?: () => Promise<any>;   // the player app reads through its own endpoint
  readOnly?: boolean;             // no Edit / Correct / Remake (the player's view)
  ticks?: ShortTicks;
}) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const [got, setGot] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);          // editing: the page as typed
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState('');
  const [saving, setSaving] = useState(false);
  const timer = useRef<any>(null);
  const live = useRef(true);

  const follow = (r: any) => {
    if (!live.current) return;
    setGot(r);
    clearTimeout(timer.current);
    if (r.status === 'making') {
      timer.current = setTimeout(() => (fetcher ? fetcher() : shortAPI.get(kind, refId)).then(follow).catch(() => {}), 2500);
    }
  };
  useEffect(() => {
    live.current = true;
    setGot(null); setDraft(null); setCorrecting(false);
    (fetcher ? fetcher() : shortAPI.get(kind, refId)).then(follow).catch(() => { if (live.current) setGot({ status: 'failed' }); });
    return () => { live.current = false; clearTimeout(timer.current); };
  }, [kind, refId]);

  const remake = () => {
    setGot((g: any) => ({ ...(g ?? {}), status: 'making' }));
    shortAPI.remake(kind, refId).then(follow).catch(() => setGot({ status: 'failed' }));
  };
  const confirmRemake = () => Alert.alert(tr('shortVersion.remakeTitle'), tr('shortVersion.remakeMsg'), [
    { text: tr('common.cancel'), style: 'cancel' },
    { text: tr('shortVersion.remake'), onPress: remake },
  ]);
  const save = async () => {
    setSaving(true);
    try {
      follow(await shortAPI.save(kind, refId, draft));
      setDraft(null);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('common.somethingWentWrong'));
    } finally {
      setSaving(false);
    }
  };
  const applyCorrection = async () => {
    if (!correction.trim()) return;
    setSaving(true);
    try {
      follow(await shortAPI.correct(kind, refId, correction.trim()));
      setCorrection(''); setCorrecting(false);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('common.somethingWentWrong'));
    } finally {
      setSaving(false);
    }
  };

  if (!got || got.status === 'making' || got.status === 'none') {
    return (
      <View style={s.page}>
        <View style={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}>
          <ActivityIndicator color={t.accent} />
          <Text style={s.muted}>{got?.status === 'none' ? tr('shortVersion.noText') : tr('shortVersion.making')}</Text>
        </View>
      </View>
    );
  }
  if (!got.data) {
    return (
      <View style={s.page}>
        <Text style={s.muted}>{tr('shortVersion.failed')}</Text>
        {!readOnly && (
          <TouchableOpacity onPress={remake} style={{ marginTop: 8 }}>
            <Text style={s.link}>{tr('shortVersion.retry')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (draft) {
    return (
      <View style={s.page}>
        {kind === 'training' ? <PlayerEdit d={draft} set={setDraft} t={t} tr={tr} /> : <TeamEdit d={draft} set={setDraft} t={t} tr={tr} />}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          <TouchableOpacity style={[s.btn, { flex: 1, borderWidth: 1, borderColor: t.line }]} onPress={() => setDraft(null)}>
            <Text style={{ color: t.muted, fontFamily: fonts[700] }}>{tr('common.cancel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.btn, { flex: 1, backgroundColor: t.ctaBg }]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={t.ctaText} size="small" />
              : <Text style={{ color: t.ctaText, fontFamily: fonts[800] }}>{tr('common.save')}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (readOnly) {
    return kind === 'training' ? <PlayerSheet d={got.data} t={t} tr={tr} ticks={ticks} /> : <TeamSheet d={got.data} t={t} tr={tr} />;
  }

  return (
    <View>
      {/* Edit every field, or say what is wrong and get it back in this format. */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <TouchableOpacity style={s.tool} onPress={() => setDraft(JSON.parse(JSON.stringify(got.data)))}>
          <Ionicons name="create-outline" size={14} color={t.inkSoft} />
          <Text style={s.toolText}>{tr('shortVersion.edit')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tool, correcting && { borderColor: t.accent }]} onPress={() => setCorrecting(c => !c)}>
          <Ionicons name="chatbox-ellipses-outline" size={14} color={t.inkSoft} />
          <Text style={s.toolText}>{tr('shortVersion.correct')}</Text>
        </TouchableOpacity>
      </View>
      {got.stale && got.edited && (
        <View style={s.stale}>
          <Text style={{ color: t.inkSoft, fontSize: 12.5, flex: 1 }}>{tr('shortVersion.staleNote')}</Text>
          <TouchableOpacity onPress={confirmRemake}><Text style={s.link}>{tr('shortVersion.remake')}</Text></TouchableOpacity>
        </View>
      )}
      {!!got.error && <Text style={[s.muted, { marginBottom: 8 }]}>{tr('shortVersion.correctFailed')}</Text>}
      {correcting && (
        <View style={s.correctBox}>
          <TextInput style={[s.input, { minHeight: 64 }]} multiline textAlignVertical="top" value={correction}
                     onChangeText={setCorrection} placeholder={tr('shortVersion.correctPlaceholder')} placeholderTextColor={t.muted2} />
          <TouchableOpacity style={[s.btn, { backgroundColor: t.ctaBg, marginTop: 8 }, (!correction.trim() || saving) && { opacity: 0.5 }]}
                            onPress={applyCorrection} disabled={!correction.trim() || saving}>
            {saving ? <ActivityIndicator color={t.ctaText} size="small" />
              : <Text style={{ color: t.ctaText, fontFamily: fonts[800] }}>{tr('shortVersion.applyCorrection')}</Text>}
          </TouchableOpacity>
        </View>
      )}
      {kind === 'training' ? <PlayerSheet d={got.data} t={t} tr={tr} /> : <TeamSheet d={got.data} t={t} tr={tr} />}
    </View>
  );
}

// ── Editing: every field of the page ────────────────────────────────────────

/** A list of one-line texts: edit, remove, add. */
function Lines({ items, onChange, placeholder, t, tr }: { items: string[]; onChange: (v: string[]) => void; placeholder?: string;
  t: ThemeTokens; tr: (k: string, o?: any) => string }) {
  const s = makeStyles(t);
  return (
    <View style={{ gap: 6 }}>
      {items.map((x, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <TextInput style={[s.input, { flex: 1 }]} value={x} placeholder={placeholder} placeholderTextColor={t.muted2}
                     onChangeText={v => onChange(items.map((y, j) => (j === i ? v : y)))} />
          <TouchableOpacity onPress={() => onChange(items.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel={tr('shortVersion.remove')}>
            <Ionicons name="close-circle-outline" size={18} color={t.muted} />
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity onPress={() => onChange([...items, ''])}><Text style={s.link}>+ {tr('shortVersion.addLine')}</Text></TouchableOpacity>
    </View>
  );
}

function Field({ label, children, t }: { label: string; children: React.ReactNode; t: ThemeTokens }) {
  const s = makeStyles(t);
  return <View style={{ marginTop: 14 }}><Text style={s.section}>{label}</Text>{children}</View>;
}

function TeamEdit({ d, set, t, tr }: { d: any; set: (v: any) => void; t: ThemeTokens; tr: (k: string, o?: any) => string }) {
  const s = makeStyles(t);
  const up = (patch: any) => set({ ...d, ...patch });
  const setSession = (i: number, patch: any) => up({ sessions: d.sessions.map((x: any, j: number) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <View>
      <TextInput style={[s.input, s.titleInput]} value={d.title ?? ''} placeholder={tr('shortVersion.titlePlaceholder')}
                 placeholderTextColor={t.muted2} onChangeText={v => up({ title: v })} />
      {(d.sessions ?? []).map((sess: any, i: number) => (
        <View key={i} style={{ marginTop: 14, gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <TextInput style={[s.input, { flex: 1, fontFamily: fonts[800] }]} value={sess.label ?? ''}
                       placeholder={tr('shortVersion.practiceLabel')} placeholderTextColor={t.muted2}
                       onChangeText={v => setSession(i, { label: v })} />
            <TouchableOpacity onPress={() => up({ sessions: d.sessions.filter((_: any, j: number) => j !== i) })} hitSlop={8}
                              accessibilityLabel={tr('shortVersion.remove')}>
              <Ionicons name="trash-outline" size={16} color={t.muted} />
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Text style={[s.fieldHead, { flex: 1 }]}>{tr('shortVersion.drills')}</Text>
            <Text style={[s.fieldHead, { width: 64 }]}>{tr('shortVersion.minutes')}</Text>
            <Text style={[s.fieldHead, { width: 72 }]}>{tr('shortVersion.coach')}</Text>
            <View style={{ width: 18 }} />
          </View>
          {sess.drills.map((x: any, j: number) => {
            const setDrill = (patch: any) => setSession(i, { drills: sess.drills.map((y: any, k: number) => (k === j ? { ...y, ...patch } : y)) });
            return (
              <View key={j} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <TextInput style={[s.input, { flex: 1 }]} value={x.drill} onChangeText={v => setDrill({ drill: v })} />
                <TextInput style={[s.input, { width: 64, textAlign: 'center' }]} keyboardType="number-pad"
                           value={x.minutes != null ? String(x.minutes) : ''}
                           onChangeText={v => { const n = parseInt(v.replace(/[^0-9]/g, ''), 10); setDrill({ minutes: Number.isFinite(n) ? n : null }); }} />
                <TextInput style={[s.input, { width: 72, textAlign: 'center' }]} value={x.coach ?? ''} autoCapitalize="characters"
                           onChangeText={v => setDrill({ coach: v || null })} />
                <TouchableOpacity onPress={() => setSession(i, { drills: sess.drills.filter((_: any, k: number) => k !== j) })} hitSlop={8}
                                  accessibilityLabel={tr('shortVersion.remove')}>
                  <Ionicons name="close-circle-outline" size={18} color={t.muted} />
                </TouchableOpacity>
              </View>
            );
          })}
          <TouchableOpacity onPress={() => setSession(i, { drills: [...sess.drills, { drill: '', minutes: null, coach: null }] })}>
            <Text style={s.link}>+ {tr('shortVersion.addDrill')}</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity style={{ marginTop: 10 }}
                        onPress={() => up({ sessions: [...(d.sessions ?? []), { label: '', drills: [{ drill: '', minutes: null, coach: null }] }] })}>
        <Text style={s.link}>+ {tr('shortVersion.addPractice')}</Text>
      </TouchableOpacity>
      <Field label={tr('shortVersion.emphasis')} t={t}>
        <Lines items={d.emphasis ?? []} onChange={v => up({ emphasis: v })} t={t} tr={tr} />
      </Field>
      <Field label={tr('shortVersion.plays')} t={t}>
        <View style={s.playGrid}>
          {PLAY_GROUPS.map(g => (
            <View key={g} style={[s.playCol, { padding: 8, gap: 6 }]}>
              <Text style={[s.fieldHead, { textAlign: 'center' }]}>{tr(`shortVersion.groups.${g}`)}</Text>
              <Lines items={d.plays?.[g] ?? []} onChange={v => up({ plays: { ...(d.plays ?? {}), [g]: v } })} t={t} tr={tr} />
            </View>
          ))}
        </View>
      </Field>
      <Field label={tr('shortVersion.notes')} t={t}>
        <Lines items={d.notes ?? []} onChange={v => up({ notes: v })} t={t} tr={tr} />
      </Field>
    </View>
  );
}

function PlayerEdit({ d, set, t, tr }: { d: any; set: (v: any) => void; t: ThemeTokens; tr: (k: string, o?: any) => string }) {
  const s = makeStyles(t);
  const up = (patch: any) => set({ ...d, ...patch });
  const setRow = (i: number, patch: any) => up({ checklist: d.checklist.map((x: any, j: number) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <View>
      <TextInput style={[s.input, s.titleInput]} value={d.title ?? ''} placeholder={tr('shortVersion.titlePlaceholder')}
                 placeholderTextColor={t.muted2} onChangeText={v => up({ title: v })} />
      <Field label={tr('shortVersion.focus')} t={t}>
        <Lines items={d.focus ?? []} onChange={v => up({ focus: v })} t={t} tr={tr} />
      </Field>
      <Field label={tr('shortVersion.checklist')} t={t}>
        <View style={{ gap: 6 }}>
          {(d.checklist ?? []).map((x: any, i: number) => (
            <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextInput style={[s.input, { flexGrow: 2, flexBasis: 160 }]} value={x.drill} placeholder={tr('shortVersion.drill')}
                         placeholderTextColor={t.muted2} onChangeText={v => setRow(i, { drill: v })} />
              <TextInput style={[s.input, { flexGrow: 1, flexBasis: 90 }]} value={x.amount ?? ''} placeholder={tr('shortVersion.amount')}
                         placeholderTextColor={t.muted2} onChangeText={v => setRow(i, { amount: v || null })} />
              <TextInput style={[s.input, { flexGrow: 2, flexBasis: 160 }]} value={x.cue ?? ''} placeholder={tr('shortVersion.cue')}
                         placeholderTextColor={t.muted2} onChangeText={v => setRow(i, { cue: v || null })} />
              <TouchableOpacity onPress={() => up({ checklist: d.checklist.filter((_: any, j: number) => j !== i) })} hitSlop={8}
                                accessibilityLabel={tr('shortVersion.remove')}>
                <Ionicons name="close-circle-outline" size={18} color={t.muted} />
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity onPress={() => up({ checklist: [...(d.checklist ?? []), { drill: '', amount: null, cue: null }] })}>
            <Text style={s.link}>+ {tr('shortVersion.addDrill')}</Text>
          </TouchableOpacity>
        </View>
      </Field>
      <Field label={tr('shortVersion.keyCues')} t={t}>
        <Lines items={d.cues ?? []} onChange={v => up({ cues: v })} t={t} tr={tr} />
      </Field>
    </View>
  );
}

const PLAY_GROUPS = ['trans', 'half_court', 'sob', 'bob', 'zone', 'free_throw', 'cob'];

function TeamSheet({ d, t, tr }: { d: any; t: ThemeTokens; tr: (k: string, o?: any) => string }) {
  const s = makeStyles(t);
  const groups = PLAY_GROUPS.filter(g => (d.plays?.[g] ?? []).length);
  return (
    <View style={s.page}>
      {!!d.title && <Text style={s.title}>{d.title}</Text>}
      {(d.sessions ?? []).map((sess: any, i: number) => {
        const total = sess.drills.reduce((a: number, x: any) => a + (x.minutes ?? 0), 0);
        const allTimed = sess.drills.every((x: any) => x.minutes != null);
        return (
          <View key={i} style={{ marginTop: i ? 18 : 10 }}>
            {!!sess.label && <Text style={s.section}>{sess.label}</Text>}
            <View style={s.table}>
              <View style={[s.tr, s.thRow]}>
                <Text style={[s.th, { flex: 1 }]}>{tr('shortVersion.drills')}</Text>
                <Text style={[s.th, s.timeCol]}>{tr('shortVersion.time')}</Text>
                <Text style={[s.th, s.coachCol]}>{tr('shortVersion.coach')}</Text>
              </View>
              {sess.drills.map((x: any, j: number) => (
                <View key={j} style={[s.tr, j % 2 === 0 && s.zebra]}>
                  <Text style={[s.td, { flex: 1, fontFamily: fonts[800] }]}>{x.drill}</Text>
                  <Text style={[s.td, s.timeCol]}>{x.minutes != null ? tr('shortVersion.min', { n: x.minutes }) : '—'}</Text>
                  <Text style={[s.td, s.coachCol]}>{x.coach ?? ''}</Text>
                </View>
              ))}
              {total > 0 && (
                <View style={s.tr}>
                  <Text style={[s.td, { flex: 1, color: t.muted }]}>{allTimed ? tr('shortVersion.total') : tr('shortVersion.totalTimed')}</Text>
                  <Text style={[s.td, s.timeCol, { fontFamily: fonts[800] }]}>{tr('shortVersion.min', { n: total })}</Text>
                  <Text style={[s.td, s.coachCol]} />
                </View>
              )}
            </View>
          </View>
        );
      })}
      {(d.emphasis ?? []).length > 0 && (
        <View style={{ marginTop: 18 }}>
          <Text style={s.section}>{tr('shortVersion.emphasis')}</Text>
          {d.emphasis.map((e: string, i: number) => (
            <Text key={i} style={s.emph}>{e}</Text>
          ))}
        </View>
      )}
      {groups.length > 0 && (
        <View style={{ marginTop: 18 }}>
          <Text style={s.section}>{tr('shortVersion.plays')}</Text>
          <View style={s.playGrid}>
            {groups.map(g => (
              <View key={g} style={s.playCol}>
                <Text style={s.playHead}>{tr(`shortVersion.groups.${g}`)}</Text>
                {d.plays[g].map((p: string, i: number) => <Text key={i} style={s.play}>{p}</Text>)}
              </View>
            ))}
          </View>
        </View>
      )}
      {(d.notes ?? []).length > 0 && (
        <View style={{ marginTop: 18 }}>
          <Text style={s.section}>{tr('shortVersion.notes')}</Text>
          {d.notes.map((n: string, i: number) => <Text key={i} style={s.note}>• {n}</Text>)}
        </View>
      )}
    </View>
  );
}

function PlayerSheet({ d, t, tr, ticks }: { d: any; t: ThemeTokens; tr: (k: string, o?: any) => string; ticks?: ShortTicks }) {
  const s = makeStyles(t);
  return (
    <View style={s.page}>
      {!!d.title && <Text style={s.title}>{d.title}</Text>}
      {(d.focus ?? []).length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {d.focus.map((f: string, i: number) => <View key={i} style={s.focus}><Text style={s.focusText}>{f}</Text></View>)}
        </View>
      )}
      <View style={[s.table, { marginTop: 14 }]}>
        <View style={[s.tr, s.thRow]}>
          <Text style={[s.th, { flex: 1.3 }]}>{tr('shortVersion.drill')}</Text>
          <Text style={[s.th, { width: 96 }]}>{tr('shortVersion.amount')}</Text>
          <Text style={[s.th, { flex: 1 }]}>{tr('shortVersion.cue')}</Text>
        </View>
        {(d.checklist ?? []).map((c: any, i: number) => (
          <View key={i} style={[s.tr, i % 2 === 0 && s.zebra]}>
            {ticks && (
              <TouchableOpacity onPress={() => ticks.toggle(c)} hitSlop={8} accessibilityRole="checkbox"
                                accessibilityState={{ checked: ticks.isDone(c) }} accessibilityLabel={c.drill}>
                <Ionicons name={ticks.isDone(c) ? 'checkbox' : 'square-outline'} size={20} color={ticks.isDone(c) ? t.positive : t.muted2} />
              </TouchableOpacity>
            )}
            <Text style={[s.td, { flex: 1.3, fontFamily: fonts[800] },
                          ticks?.isDone(c) && { textDecorationLine: 'line-through', color: t.muted }]}>{c.drill}</Text>
            <Text style={[s.td, { width: 96 }]}>{c.amount ?? '—'}</Text>
            <Text style={[s.td, { flex: 1, color: t.inkSoft }]}>{c.cue ?? ''}</Text>
          </View>
        ))}
      </View>
      {(d.cues ?? []).length > 0 && (
        <View style={{ marginTop: 16 }}>
          <Text style={s.section}>{tr('shortVersion.keyCues')}</Text>
          {d.cues.map((c: string, i: number) => <Text key={i} style={s.emph}>{c}</Text>)}
        </View>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => ({
  switch: { flexDirection: 'row' as const, alignSelf: 'flex-start' as const, borderWidth: 1, borderColor: t.line,
            borderRadius: 999, padding: 3, marginBottom: 12, backgroundColor: t.card },
  switchBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999 },
  switchOn: { backgroundColor: t.ctaBg },
  switchText: { color: t.inkSoft, fontSize: 13, fontFamily: fonts[700] },
  switchTextOn: { color: t.ctaText },
  page: { backgroundColor: t.card, borderRadius: 14, borderWidth: 1, borderColor: t.cardBorder, padding: 16 } as const,
  title: { color: t.ink, fontSize: 18, fontFamily: fonts[900], letterSpacing: 0.5 },
  section: { color: t.label, fontSize: 11.5, fontFamily: fonts[800], letterSpacing: 2, textTransform: 'uppercase' as const, marginBottom: 6 },
  table: { borderWidth: 1, borderColor: t.line, borderRadius: 8, overflow: 'hidden' as const },
  tr: { flexDirection: 'row' as const, alignItems: 'center' as const, borderBottomWidth: 1, borderBottomColor: t.divider,
        paddingVertical: 8, paddingHorizontal: 10, gap: 8 },
  thRow: { backgroundColor: t.negative },
  th: { color: '#FFFFFF', fontSize: 11.5, fontFamily: fonts[800], letterSpacing: 1, textTransform: 'uppercase' as const },
  zebra: { backgroundColor: t.chip },
  td: { color: t.ink, fontSize: 13.5 },
  timeCol: { width: 72, textAlign: 'center' as const },
  coachCol: { width: 70, textAlign: 'center' as const },
  emph: { color: t.ink, fontSize: 14, fontFamily: fonts[700], paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: t.divider },
  playGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  playCol: { flexBasis: 140, flexGrow: 1, borderWidth: 1, borderColor: t.line, borderRadius: 8, overflow: 'hidden' as const },
  playHead: { backgroundColor: t.chip, color: t.ink, fontSize: 11.5, fontFamily: fonts[800], textAlign: 'center' as const,
              paddingVertical: 6, textTransform: 'uppercase' as const },
  play: { color: t.ink, fontSize: 13, fontFamily: fonts[700], textAlign: 'center' as const, paddingVertical: 5,
          borderTopWidth: 1, borderTopColor: t.divider },
  note: { color: t.inkSoft, fontSize: 13, marginBottom: 3 },
  focus: { borderWidth: 1, borderColor: t.accent, backgroundColor: t.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  focusText: { color: t.accent, fontSize: 12.5, fontFamily: fonts[800] },
  muted: { color: t.muted, fontSize: 13 },
  tool: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, borderWidth: 1, borderColor: t.line,
          borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: t.card },
  toolText: { color: t.inkSoft, fontSize: 12.5, fontFamily: fonts[700] },
  stale: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, backgroundColor: t.chip,
           borderRadius: 10, padding: 10, marginBottom: 10 },
  correctBox: { marginBottom: 10 },
  input: { backgroundColor: t.chip, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: t.ink, fontSize: 13.5 },
  titleInput: { fontSize: 16, fontFamily: fonts[800] },
  fieldHead: { color: t.muted, fontSize: 10.5, fontFamily: fonts[800], letterSpacing: 1, textTransform: 'uppercase' as const },
  btn: { borderRadius: 12, paddingVertical: 11, alignItems: 'center' as const, justifyContent: 'center' as const },
  link: { color: t.accent, fontSize: 13, fontFamily: fonts[700] },
});
