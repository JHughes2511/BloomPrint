/**
 * Play calling, live: what was called, against what, and whether it scored.
 *
 * Sits under the live tracker's Line-up and End Game. The quarter a possession
 * is filed under is the tracker's own — the Q row at the top of the page — and
 * never this panel's: the panel's own quarter row only chooses which quarter to
 * LOOK at, so a coach reading back through Q1 in the third quarter cannot file
 * a Q3 possession under Q1.
 *
 * A possession opens when its play is tapped and closes when the next one is
 * called. + and − ask who and how; the stats they imply are linked if already
 * logged in Stats, so a basket is counted once (see api/play_calling.py).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Sheet from './Sheet';
import { playCallingAPI } from '../api/client';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { sheetCap } from '../responsive/modalSizes';

type Side = 'our' | 'opponent';
type Person = { name: string; jersey?: string | null };

interface Props {
  game: any;
  liveQuarter: number;                     // the tracker's quarter: where new possessions go
  qLabel: (q: number) => string;
  sideNames: { our: string; opponent: string };
  players: { our: Person[]; opponent: Person[] };
  refreshKey: number;                      // bumped when anyone's stats change
  onScores: (our: number | null, opp: number | null) => void;
  t: ThemeTokens;
  tr: (k: string, o?: any) => string;
}

const SCORE_HOWS: { ended: string; ft?: [number, number] }[] = [
  { ended: 'made2' }, { ended: 'made3' }, { ended: 'and1_2' }, { ended: 'and1_3' },
  { ended: 'ft', ft: [2, 2] }, { ended: 'ft', ft: [1, 2] }, { ended: 'ft', ft: [1, 1] },
  { ended: 'ft', ft: [3, 3] }, { ended: 'ft', ft: [2, 3] }, { ended: 'ft', ft: [1, 3] },
];
const MISS_HOWS: { ended: string | null; ft?: [number, number] }[] = [
  { ended: 'miss2' }, { ended: 'miss3' }, { ended: 'turnover' }, { ended: 'ft_miss', ft: [0, 2] }, { ended: null },
];

export default function PlayCallingPanel({ game, liveQuarter, qLabel, sideNames, players, refreshKey, onScores, t, tr }: Props) {
  const s = makeStyles(t);
  const [data, setData] = useState<any | null>(null);
  const [side, setSide] = useState<Side>('our');
  const [defense, setDefense] = useState<Record<Side, string | null>>({ our: null, opponent: null });
  const [newPlay, setNewPlay] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewQ, setViewQ] = useState<number | 'all' | null>(null);   // null: follow the live quarter
  const [finishing, setFinishing] = useState<{ call: any; result: 'score' | 'no_score'; player: string | null } | null>(null);

  const load = useCallback(() => {
    playCallingAPI.game(game.id).then(setData).catch(() => {});
  }, [game.id]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const possessions: any[] = data?.possessions ?? [];
  const current = possessions.length ? possessions[possessions.length - 1] : null;
  const open = current && current.result == null ? current : null;
  const shownQ = viewQ ?? liveQuarter;
  const shown = shownQ === 'all' ? possessions : possessions.filter(p => p.quarter === shownQ);
  const quarters = useMemo(() => {
    const qs = new Set<number>(possessions.map(p => p.quarter));
    for (let q = 1; q <= Math.max(4, liveQuarter); q++) qs.add(q);
    return Array.from(qs).sort((a, b) => a - b);
  }, [possessions, liveQuarter]);

  const typeLabel = (k: string) => tr(`playCalling.types.${k}`, { defaultValue: k });
  const howLabel = (ended: string | null, ft?: [number, number] | null) =>
    ended === 'ft' || ended === 'ft_miss'
      ? tr('playCalling.hows.ft', { made: ft?.[0] ?? 0, att: ft?.[1] ?? 2 })
      : ended ? tr(`playCalling.hows.${ended}`) : tr('playCalling.hows.none');

  const callPlay = async (name: string) => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await playCallingAPI.add(game.id, { side, quarter: liveQuarter, play: name.trim(), defense: defense[side] });
      setNewPlay('');
      setViewQ(null);
      load();
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  };

  const pickDefense = async (d: string) => {
    const next = defense[side] === d ? null : d;
    setDefense(prev => ({ ...prev, [side]: next }));
    // Changing the defense while a trip is open corrects that trip too.
    if (open && open.side === side) {
      await playCallingAPI.edit(open.id, { defense: next ?? '' }).catch(() => {});
      load();
    }
  };

  const finish = async (ended: string | null, ft?: [number, number] | null) => {
    if (!finishing) return;
    const { call, result, player } = finishing;
    setFinishing(null);
    try {
      const r = await playCallingAPI.finish(call.id, {
        result, player_name: player, ended, ft_made: ft ? ft[0] : null, ft_att: ft ? ft[1] : null,
      });
      onScores(r.our_score ?? null, r.opponent_score ?? null);
      load();
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('common.somethingWentWrong'));
    }
  };

  const orb = async (sd: Side, delta: number) => {
    try {
      const o = await playCallingAPI.orb(game.id, sd, liveQuarter, delta);
      setData((prev: any) => prev && ({ ...prev, orb: o }));
    } catch { /* next load shows it */ }
  };

  const removeCall = (call: any) => Alert.alert(tr('playCalling.deleteTitle'), '', [
    { text: tr('common.cancel'), style: 'cancel' },
    { text: tr('common.delete'), style: 'destructive', onPress: async () => {
      await playCallingAPI.remove(call.id).catch(() => {});
      load();
    } },
  ]);

  const catalog: any[] = data?.catalog?.[side] ?? [];
  const defenses: string[] = data?.catalog?.defenses ?? [];
  const orbCount = (sd: Side) => Number(data?.orb?.[sd]?.[String(liveQuarter)] ?? 0);
  const shownScored = shown.filter(p => p.result === 'score').length;
  const shownDone = shown.filter(p => p.result).length;
  const shownPts = shown.reduce((a, p) => a + (p.points ?? 0), 0);

  const resultText = (p: any) => {
    if (p.result == null) return tr('playCalling.open');
    if (p.result === 'score') {
      const how = p.ended ? howLabel(p.ended, p.ended === 'ft' ? [p.ft_made ?? 0, p.ft_att ?? 0] : null) : '';
      return `+${p.points ?? ''} ${[how, p.player_name].filter(Boolean).join(' · ')}`.trim();
    }
    const how = p.ended ? howLabel(p.ended, p.ended === 'ft_miss' ? [0, p.ft_att ?? 2] : null) : '';
    return `− ${[how, p.player_name].filter(Boolean).join(' · ')}`.trim();
  };

  const roster = finishing ? players[finishing.call.side as Side] : [];

  return (
    <View style={s.panel}>
      <Text style={s.title}>{tr('playCalling.title')}</Text>

      {/* Who has the ball */}
      <View style={s.row}>
        {(['our', 'opponent'] as Side[]).map(sd => (
          <TouchableOpacity key={sd} style={[s.sideBtn, side === sd && s.sideBtnOn]} onPress={() => setSide(sd)}>
            <Text style={[s.sideText, side === sd && s.sideTextOn]} numberOfLines={1}>
              {tr('playCalling.ball', { team: sideNames[sd] })}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* The trip being played */}
      {open ? (
        <View style={s.openCard}>
          <Text style={s.openText} numberOfLines={1}>
            {qLabel(open.quarter)} · {sideNames[open.side as Side]} · {open.play}
            {open.defense ? ` ${tr('playCalling.vs')} ${open.defense}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={[s.resultBtn, { backgroundColor: t.positiveSoft, borderColor: t.positive }]}
                              onPress={() => setFinishing({ call: open, result: 'score', player: null })}>
              <Text style={[s.resultText, { color: t.positive }]}>+ {tr('playCalling.score')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.resultBtn, { backgroundColor: t.negativeSoft, borderColor: t.negative }]}
                              onPress={() => setFinishing({ call: open, result: 'no_score', player: null })}>
              <Text style={[s.resultText, { color: t.negative }]}>− {tr('playCalling.noScore')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Defense faced (remembered per side) */}
      <Text style={s.label}>{tr('playCalling.defense')}</Text>
      <View style={s.chips}>
        {defenses.map(d => (
          <TouchableOpacity key={d} style={[s.chip, defense[side] === d && s.chipOn]} onPress={() => pickDefense(d)}>
            <Text style={[s.chipText, defense[side] === d && s.chipTextOn]}>{d}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* The call: tap to start the next trip */}
      <Text style={s.label}>{tr('playCalling.play')}</Text>
      <View style={s.chips}>
        {catalog.slice(0, 16).map((p: any) => (
          <TouchableOpacity key={p.name} style={s.chip} onPress={() => callPlay(p.name)} disabled={busy}
                            accessibilityHint={typeLabel(p.type)}>
            <Text style={s.chipText}>{p.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={[s.row, { marginTop: 6 }]}>
        <TextInput
          style={s.input}
          placeholder={tr('playCalling.newPlay')}
          placeholderTextColor={t.muted2}
          value={newPlay}
          onChangeText={setNewPlay}
          onSubmitEditing={() => callPlay(newPlay)}
          returnKeyType="done"
        />
        <TouchableOpacity style={[s.addBtn, !newPlay.trim() && { opacity: 0.5 }]} disabled={!newPlay.trim() || busy}
                          onPress={() => callPlay(newPlay)}>
          {busy ? <ActivityIndicator color={t.ctaText} size="small" />
                : <Text style={s.addText}>{tr('playCalling.call')}</Text>}
        </TouchableOpacity>
      </View>

      {/* Offensive rebounds, this quarter */}
      <View style={[s.row, { marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }]}>
        <Text style={s.label}>{tr('playCalling.orb')} · {qLabel(liveQuarter)}</Text>
        {(['our', 'opponent'] as Side[]).map(sd => (
          <View key={sd} style={s.orbBox}>
            <Text style={s.orbName} numberOfLines={1}>{sideNames[sd]}</Text>
            <TouchableOpacity onPress={() => orb(sd, -1)} accessibilityLabel={`${sideNames[sd]} −1`}>
              <Ionicons name="remove-circle-outline" size={20} color={t.muted} />
            </TouchableOpacity>
            <Text style={s.orbNum}>{orbCount(sd)}</Text>
            <TouchableOpacity onPress={() => orb(sd, 1)} accessibilityLabel={`${sideNames[sd]} +1`}>
              <Ionicons name="add-circle-outline" size={20} color={t.accent} />
            </TouchableOpacity>
          </View>
        ))}
      </View>

      {/* Looking back: its own quarter row, which never changes where new trips go */}
      <View style={[s.row, { marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }]}>
        <Text style={s.label}>{tr('playCalling.viewing')}</Text>
        {quarters.map(q => (
          <TouchableOpacity key={q} style={[s.qChip, shownQ === q && s.chipOn]} onPress={() => setViewQ(q === liveQuarter ? null : q)}>
            <Text style={[s.chipText, shownQ === q && s.chipTextOn]}>{qLabel(q)}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[s.qChip, shownQ === 'all' && s.chipOn]} onPress={() => setViewQ('all')}>
          <Text style={[s.chipText, shownQ === 'all' && s.chipTextOn]}>{tr('playCalling.all')}</Text>
        </TouchableOpacity>
        {viewQ !== null && (
          <TouchableOpacity onPress={() => setViewQ(null)}>
            <Text style={s.backLive}>{tr('playCalling.backToLive')}</Text>
          </TouchableOpacity>
        )}
      </View>
      {shownDone > 0 && (
        <Text style={s.quick}>{tr('playCalling.quick', { scored: shownScored, n: shownDone, points: shownPts })}</Text>
      )}
      {shown.length === 0 ? (
        <Text style={s.empty}>{tr('playCalling.none')}</Text>
      ) : shown.slice().reverse().map(p => (
        <TouchableOpacity key={p.id} style={s.item} onLongPress={() => removeCall(p)}
                          onPress={() => setFinishing({ call: p, result: p.result === 'no_score' ? 'no_score' : 'score', player: p.player_name })}>
          <Text style={s.itemQ}>{qLabel(p.quarter)}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.itemPlay} numberOfLines={1}>
              {sideNames[p.side as Side]} · {p.play}{p.defense ? ` ${tr('playCalling.vs')} ${p.defense}` : ''}
            </Text>
            <Text style={[s.itemResult, { color: p.result === 'score' ? t.positive : p.result === 'no_score' ? t.negative : t.muted }]}
                  numberOfLines={1}>{resultText(p)}</Text>
          </View>
        </TouchableOpacity>
      ))}

      {/* Who and how, for + and − */}
      <Sheet visible={!!finishing} transparent animationType="slide" onRequestClose={() => setFinishing(null)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={[s.row, { alignItems: 'center', marginBottom: 8 }]}>
              <Text style={s.sheetTitle}>
                {finishing?.result === 'score' ? tr('playCalling.whoScored') : tr('playCalling.howEnded')}
              </Text>
              <TouchableOpacity onPress={() => setFinishing(null)} style={{ marginLeft: 'auto' }}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            <View style={[s.row, { marginBottom: 10 }]}>
              {(['score', 'no_score'] as const).map(r => (
                <TouchableOpacity key={r} style={[s.chip, finishing?.result === r && s.chipOn]}
                                  onPress={() => setFinishing(prev => prev && ({ ...prev, result: r }))}>
                  <Text style={[s.chipText, finishing?.result === r && s.chipTextOn]}>
                    {r === 'score' ? `+ ${tr('playCalling.score')}` : `− ${tr('playCalling.noScore')}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.label}>
              {finishing?.result === 'score' ? tr('playCalling.player') : tr('playCalling.playerOptional')}
            </Text>
            <ScrollView style={{ maxHeight: 160 }} contentContainerStyle={s.chips}>
              {roster.map(p => {
                const on = finishing?.player === p.name;
                return (
                  <TouchableOpacity key={p.name} style={[s.chip, on && s.chipOn]}
                                    onPress={() => setFinishing(prev => prev && ({ ...prev, player: on ? null : p.name }))}>
                    <Text style={[s.chipText, on && s.chipTextOn]}>{p.jersey ? `#${p.jersey} ` : ''}{p.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={[s.label, { marginTop: 10 }]}>{tr('playCalling.how')}</Text>
            <View style={s.chips}>
              {(finishing?.result === 'score' ? SCORE_HOWS : MISS_HOWS).map((h, i) => {
                const needsPlayer = finishing?.result === 'score' && !finishing?.player;
                return (
                  <TouchableOpacity key={i} style={[s.howBtn, needsPlayer && { opacity: 0.4 }]} disabled={needsPlayer}
                                    onPress={() => finish(h.ended, h.ft ?? null)}>
                    <Text style={s.howText}>{howLabel(h.ended, h.ft ?? null)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {finishing?.result === 'score' && !finishing?.player && (
              <Text style={[s.empty, { marginTop: 6 }]}>{tr('playCalling.pickPlayerFirst')}</Text>
            )}
          </View>
        </View>
      </Sheet>
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => ({
  panel: { marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: t.divider } as const,
  title: { color: t.label, fontSize: 11.5, fontFamily: fonts[800], letterSpacing: 2, textTransform: 'uppercase' as const,
           marginBottom: 10 },
  label: { color: t.muted, fontSize: 10.5, fontFamily: fonts[700], letterSpacing: 1, textTransform: 'uppercase' as const,
           marginTop: 10, marginBottom: 6, marginRight: 8 },
  row: { flexDirection: 'row' as const, gap: 8 },
  sideBtn: { flex: 1, borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingVertical: 9, alignItems: 'center' as const },
  sideBtnOn: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  sideText: { color: t.inkSoft, fontFamily: fonts[700], fontSize: 13 },
  sideTextOn: { color: t.ctaText },
  openCard: { marginTop: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: t.cardBorder,
              backgroundColor: t.card, gap: 10 },
  openText: { color: t.ink, fontFamily: fonts[700], fontSize: 14 },
  resultBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 11, alignItems: 'center' as const },
  resultText: { fontFamily: fonts[800], fontSize: 14 },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  chip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: t.card },
  qChip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipOn: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  chipText: { color: t.inkSoft, fontSize: 12.5, fontFamily: fonts[700] },
  chipTextOn: { color: t.ctaText },
  input: { flex: 1, borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
           color: t.ink, backgroundColor: t.card, fontSize: 14 },
  addBtn: { backgroundColor: t.ctaBg, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' as const },
  addText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 13 },
  orbBox: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginRight: 12 },
  orbName: { color: t.inkSoft, fontSize: 12, fontFamily: fonts[700], maxWidth: 110 },
  orbNum: { color: t.ink, fontSize: 15, fontFamily: fonts[800], minWidth: 18, textAlign: 'center' as const },
  backLive: { color: t.accent, fontSize: 12, fontFamily: fonts[700], marginLeft: 4 },
  quick: { color: t.inkSoft, fontSize: 12.5, fontFamily: fonts[700], marginTop: 8 },
  empty: { color: t.muted2, fontSize: 12, marginTop: 8 },
  item: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 8,
          borderBottomWidth: 1, borderBottomColor: t.divider },
  itemQ: { color: t.muted, fontSize: 11, fontFamily: fonts[700], width: 30 },
  itemPlay: { color: t.ink, fontSize: 13, fontFamily: fonts[700] },
  itemResult: { fontSize: 12, marginTop: 1 },
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'center' as const, padding: 20 },
  sheet: { backgroundColor: t.sheet, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(560) },
  sheetTitle: { color: t.ink, fontSize: 17, fontFamily: fonts[800] },
  howBtn: { borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: t.card },
  howText: { color: t.ink, fontSize: 13, fontFamily: fonts[700] },
});
