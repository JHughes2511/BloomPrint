/**
 * One game's play calling, on the Team Grade "Play Calling" tab: the report,
 * the numbers behind it, and every possession — laid out like the Game Report
 * page (context and Generate first, then the report), with the game's data a
 * tap away.
 *
 * Points are shown only where every score in that line had them recorded;
 * otherwise a line is scored / not scored, and the report is told the same.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { playCallingAPI } from '../api/client';
import { renderReport } from '../utils/renderReport';
import { jobProgressLabel } from './GeneratingBasketball';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

type Side = 'our' | 'opponent';

interface Props {
  game: any;
  sideNames: { our: string; opponent: string };
  qLabel: (q: number) => string;
  statLabel: (k: string) => string;
  onBack: () => void;
  onGameData: () => void;
  onImport: () => void;
  refreshKey: number;                  // bumped after an import
  t: ThemeTokens;
  tr: (k: string, o?: any) => string;
}

export default function PlayCallingPage({ game, sideNames, qLabel, statLabel, onBack, onGameData, onImport, refreshKey, t, tr }: Props) {
  const s = makeStyles(t);
  const [data, setData] = useState<any | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [showSide, setShowSide] = useState<Side | 'both'>('both');

  const load = useCallback(() => {
    playCallingAPI.game(game.id).then(setData).catch(() => setData({ possessions: [], summary: {}, orb: {} }));
    playCallingAPI.report(game.id).then((r: any) => {
      setReport(r.report_text ?? null);
      setContext(prev => prev || r.context || '');
    }).catch(() => {});
  }, [game.id]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const generate = async () => {
    setBusy(true);
    setProgress('');
    try {
      const r = await playCallingAPI.generateReport(game.id, context, setProgress);
      setReport(r.report_text ?? null);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? e?.message ?? tr('common.somethingWentWrong'));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const possessions: any[] = data?.possessions ?? [];
  const summary = data?.summary ?? {};
  const sides = (['our', 'opponent'] as Side[]).filter(sd => summary[sd]);
  const typeLabel = (k: string) => tr(`playCalling.types.${k}`, { defaultValue: k });
  const qName = (k: any) => qLabel(Number(k));

  const Table = ({ title, rows, label }: { title: string; rows: any[]; label: (k: any) => string }) => {
    if (!rows?.length) return null;
    const pts = rows.some(r => r.points != null);
    return (
      <View style={{ marginTop: 12 }}>
        <Text style={s.tableTitle}>{title}</Text>
        <View style={[s.tr, s.th]}>
          <Text style={[s.thText, { flex: 1 }]} />
          <Text style={[s.thText, s.num]}>{tr('playCalling.page.colTrips')}</Text>
          <Text style={[s.thText, s.num]}>{tr('playCalling.page.colScored')}</Text>
          <Text style={[s.thText, s.num]}>%</Text>
          {pts && <Text style={[s.thText, s.num]}>{tr('playCalling.page.colPts')}</Text>}
          {pts && <Text style={[s.thText, s.num]}>{tr('playCalling.page.colPpp')}</Text>}
        </View>
        {rows.map((r: any) => (
          <View key={String(r.key)} style={s.tr}>
            <Text style={[s.td, { flex: 1 }]} numberOfLines={1}>{label(r.key)}</Text>
            <Text style={[s.td, s.num]}>{r.n}</Text>
            <Text style={[s.td, s.num]}>{r.scored}</Text>
            <Text style={[s.td, s.num, { color: r.pct >= 50 ? t.positive : r.pct < 35 ? t.negative : t.inkSoft }]}>{r.pct}</Text>
            {pts && <Text style={[s.td, s.num]}>{r.points ?? '—'}</Text>}
            {pts && <Text style={[s.td, s.num]}>{r.ppp ?? '—'}</Text>}
          </View>
        ))}
      </View>
    );
  };

  const shownPossessions = possessions.filter(p => showSide === 'both' || p.side === showSide);
  const quarters = Array.from(new Set(shownPossessions.map(p => p.quarter))).sort((a, b) => a - b);
  const eventLine = (p: any) => {
    const evs = (p.events ?? []).filter((e: any) => e.is_opponent === (p.side === 'opponent'));
    if (evs.length) return evs.map((e: any) => `${e.player_name} ${statLabel(e.stat_name)}${e.points ? ` (+${e.points})` : ''}`).join(' · ');
    if (p.result === 'score') return `${tr('playCalling.page.scoredWord')}${p.points != null ? ` (+${p.points})` : ''}${p.player_name ? ` · ${p.player_name}` : ''}`;
    if (p.result === 'no_score') return `${tr('playCalling.page.noScoreWord')}${p.ended ? ` · ${tr(`playCalling.endings.${p.ended}`, { defaultValue: p.ended })}` : ''}`;
    return tr('playCalling.open');
  };
  const orb = data?.orb ?? {};

  return (
    <View>
      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }} onPress={onBack}>
        <Ionicons name="arrow-back" size={18} color={t.muted} />
        <Text style={{ color: t.muted, fontSize: 14 }}>{tr('teamGrade.allGames')}</Text>
      </TouchableOpacity>
      <Text style={s.title}>{sideNames.our} vs {sideNames.opponent}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Text style={{ color: t.muted2, fontSize: 13, flex: 1 }}>
          {game.date ? new Date(game.date).toLocaleDateString() : ''}
          {game.our_score != null ? `  ·  ${game.our_score}-${game.opponent_score}` : ''}
        </Text>
        <TouchableOpacity style={s.pill} onPress={onImport}>
          <Ionicons name="clipboard-outline" size={14} color={t.muted} />
          <Text style={s.pillText}>{tr('playCalling.import.button')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.pill} onPress={onGameData} accessibilityLabel={tr('teamGrade.viewFullGameData')}>
          <Ionicons name="stats-chart-outline" size={14} color={t.muted} />
          <Text style={s.pillText}>{tr('teamGrade.gameData')}</Text>
        </TouchableOpacity>
      </View>

      {!data ? <ActivityIndicator color={t.accent} style={{ marginTop: 24 }} /> : possessions.length === 0 ? (
        <View style={s.card}><Text style={s.empty}>{tr('playCalling.page.noData')}</Text></View>
      ) : (
        <>
          {/* Context, then write the report */}
          <View style={s.card}>
            <Text style={s.cardLabel}>{tr('playCalling.page.context')}</Text>
            <TextInput
              style={s.input}
              multiline
              value={context}
              onChangeText={setContext}
              placeholder={tr('playCalling.page.contextPlaceholder')}
              placeholderTextColor={t.muted2}
            />
            <TouchableOpacity style={[s.cta, busy && { opacity: 0.7 }]} disabled={busy} onPress={generate}>
              {busy ? <><ActivityIndicator color={t.ctaText} /><Text style={s.ctaText}>{jobProgressLabel(progress, tr) || tr('playCalling.page.writing')}</Text></>
                    : <><Ionicons name="sparkles-outline" size={16} color={t.ctaText} />
                        <Text style={s.ctaText}>{report ? tr('playCalling.page.regenerate') : tr('playCalling.page.generate')}</Text></>}
            </TouchableOpacity>
          </View>

          {report ? (
            <View style={s.card}>
              <Text style={s.cardLabel}>{tr('playCalling.page.reportTitle')}</Text>
              <View style={{ marginTop: 8 }}>{renderReport(report, { heading: t.ink, body: t.inkSoft })}</View>
            </View>
          ) : null}

          {/* The numbers */}
          <View style={s.card}>
            <Text style={s.cardLabel}>{tr('playCalling.page.numbers')}</Text>
            {sides.map(sd => {
              const x = summary[sd];
              const o = orb?.[sd] ?? {};
              const orbTotal = Object.values(o).reduce((a: number, v: any) => a + Number(v || 0), 0);
              return (
                <View key={sd} style={{ marginTop: 12 }}>
                  <Text style={s.sideTitle}>{tr('playCalling.page.overall', { team: sideNames[sd] })}</Text>
                  <Text style={s.overall}>
                    {x.overall.points != null
                      ? tr('playCalling.quick', { scored: x.overall.scored, n: x.overall.n, points: x.overall.points })
                      : tr('playCalling.quickScored', { scored: x.overall.scored, n: x.overall.n })}
                    {`  ·  ${x.overall.pct}%`}
                    {orbTotal ? `  ·  ${tr('playCalling.orb')} ${orbTotal}` : ''}
                  </Text>
                  <Table title={tr('playCalling.page.byPlay')} rows={x.by_play} label={k => String(k)} />
                  <Table title={tr('playCalling.page.byType')} rows={x.by_type} label={k => typeLabel(String(k))} />
                  <Table title={tr('playCalling.page.byDefense')} rows={x.by_defense}
                         label={k => (k === 'Not noted' ? tr('playCalling.page.notNoted') : String(k))} />
                  <Table title={tr('playCalling.page.byPlayDefense')} rows={x.by_play_defense} label={k => String(k)} />
                  <Table title={tr('playCalling.page.byQuarter')} rows={x.by_quarter} label={qName} />
                  {Object.keys(x.no_score_endings ?? {}).length > 0 && (
                    <Text style={[s.overall, { marginTop: 10 }]}>
                      {tr('playCalling.page.endings')}: {Object.entries(x.no_score_endings).map(([k, v]: any) =>
                        `${tr(`playCalling.endings.${k}`, { defaultValue: k })} ${v}`).join(', ')}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>

          {/* Every possession */}
          <View style={s.card}>
            <Text style={s.cardLabel}>{tr('playCalling.page.possessions')}</Text>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {(['both', 'our', 'opponent'] as const).map(k => (
                <TouchableOpacity key={k} style={[s.chip, showSide === k && s.chipOn]} onPress={() => setShowSide(k)}>
                  <Text style={[s.chipText, showSide === k && s.chipTextOn]}>
                    {k === 'both' ? tr('playCalling.page.both') : sideNames[k]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {quarters.map(q => (
              <View key={q} style={{ marginTop: 12 }}>
                <Text style={s.tableTitle}>{qLabel(q)}</Text>
                {shownPossessions.filter(p => p.quarter === q).map(p => (
                  <View key={p.id} style={s.possession}>
                    <View style={[s.dot, { backgroundColor: p.result === 'score' ? t.positive : p.result === 'no_score' ? t.negative : t.line }]} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.possTitle} numberOfLines={1}>
                        {sideNames[p.side as Side]} · {p.play}{p.defense ? ` ${tr('playCalling.vs')} ${p.defense}` : ''}
                      </Text>
                      <Text style={s.possDetail} numberOfLines={2}>{eventLine(p)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => ({
  title: { color: t.ink, fontSize: 22, fontFamily: fonts[900], marginBottom: 2 },
  pill: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: 10, paddingVertical: 6,
          borderRadius: 999, borderWidth: 1, borderColor: t.line, backgroundColor: t.chip },
  pillText: { color: t.muted, fontSize: 12, fontFamily: fonts[700] },
  card: { backgroundColor: t.card, borderRadius: 18, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: t.cardBorder },
  cardLabel: { color: t.label, fontSize: 11, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase' as const },
  empty: { color: t.muted2, fontSize: 13 },
  input: { marginTop: 8, minHeight: 70, borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 10, color: t.ink,
           backgroundColor: t.sheet, fontSize: 14, textAlignVertical: 'top' as const },
  cta: { marginTop: 10, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
         backgroundColor: t.ctaBg, borderRadius: 12, paddingVertical: 12 },
  ctaText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 14 },
  sideTitle: { color: t.ink, fontSize: 15, fontFamily: fonts[800] },
  overall: { color: t.inkSoft, fontSize: 13, fontFamily: fonts[600], marginTop: 2 },
  tableTitle: { color: t.muted, fontSize: 11, fontFamily: fonts[800], letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 4 },
  tr: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: t.divider },
  th: { borderBottomColor: t.line },
  thText: { color: t.muted2, fontSize: 10.5, fontFamily: fonts[700] },
  td: { color: t.inkSoft, fontSize: 13 },
  num: { width: 58, textAlign: 'right' as const },
  chip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  chipText: { color: t.inkSoft, fontSize: 12.5, fontFamily: fonts[700] },
  chipTextOn: { color: t.ctaText },
  possession: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 7,
                borderBottomWidth: 1, borderBottomColor: t.divider },
  dot: { width: 8, height: 8, borderRadius: 4 },
  possTitle: { color: t.ink, fontSize: 13, fontFamily: fonts[700] },
  possDetail: { color: t.muted, fontSize: 12, marginTop: 1 },
});
