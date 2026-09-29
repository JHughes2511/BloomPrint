/**
 * Standard | Short: the switch above a report, and the short page itself.
 *
 * The short version is made on the server from the standard text (api/
 * short_versions.py) — automatically when the report is written, again when
 * it changes — so switching to it normally shows it at once. If it is still
 * being made, this says so and checks back.
 *
 * Two page shapes: a team PRACTICE SHEET (practice plan with times and coach,
 * the emphasis list, the play sheet, notes), and a player CHECKLIST (focus,
 * drills with amount and cue, key cues).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
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

export function ShortVersionView({ kind, refId }: { kind: ShortKind; refId: number }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const [got, setGot] = useState<any>(null);
  const timer = useRef<any>(null);

  useEffect(() => {
    let live = true;
    const load = (remake = false) => {
      (remake ? shortAPI.remake(kind, refId) : shortAPI.get(kind, refId))
        .then((r: any) => {
          if (!live) return;
          setGot(r);
          if (r.status === 'making') timer.current = setTimeout(() => load(), 2500);
        })
        .catch(() => { if (live) setGot({ status: 'failed' }); });
    };
    setGot(null);
    load();
    return () => { live = false; clearTimeout(timer.current); };
  }, [kind, refId]);

  const retry = () => {
    setGot({ status: 'making' });
    shortAPI.remake(kind, refId).then(() => {
      const poll = () => shortAPI.get(kind, refId).then((r: any) => {
        setGot(r);
        if (r.status === 'making') timer.current = setTimeout(poll, 2500);
      });
      poll();
    }).catch(() => setGot({ status: 'failed' }));
  };

  if (!got || got.status === 'making' || (got.status === 'none')) {
    return (
      <View style={s.page}>
        <View style={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}>
          <ActivityIndicator color={t.accent} />
          <Text style={s.muted}>{got?.status === 'none' ? tr('shortVersion.noText') : tr('shortVersion.making')}</Text>
        </View>
      </View>
    );
  }
  if (got.status === 'failed' || !got.data) {
    return (
      <View style={s.page}>
        <Text style={s.muted}>{tr('shortVersion.failed')}</Text>
        <TouchableOpacity onPress={retry} style={{ marginTop: 8 }}>
          <Text style={s.link}>{tr('shortVersion.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return kind === 'training' ? <PlayerSheet d={got.data} t={t} tr={tr} /> : <TeamSheet d={got.data} t={t} tr={tr} />;
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

function PlayerSheet({ d, t, tr }: { d: any; t: ThemeTokens; tr: (k: string, o?: any) => string }) {
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
            <Text style={[s.td, { flex: 1.3, fontFamily: fonts[800] }]}>{c.drill}</Text>
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
  link: { color: t.accent, fontSize: 13, fontFamily: fonts[700] },
});
