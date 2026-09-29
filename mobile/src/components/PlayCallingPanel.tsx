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
 * called. What happened in it is tapped as real stats — 2 FG Made, 3 FG
 * Missed, FT Made, Turnover — each for a player, so reading a possession back
 * says who did what. The same basket tapped in Stats is claimed, not added,
 * so it is counted once (see api/play_calling.py).
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
  statLabel: (k: string) => string;
  t: ThemeTokens;
  tr: (k: string, o?: any) => string;
}

const OUTCOMES = ['2 FG Made', '2 FG Missed', '3 FG Made', '3 FG Missed', 'FT Made', 'FT Missed', 'Turnover'];
const isMade = (k: string) => /Made$/.test(k);

export default function PlayCallingPanel({ game, liveQuarter, qLabel, sideNames, players, refreshKey, onScores, statLabel, t, tr }: Props) {
  const s = makeStyles(t);
  const [data, setData] = useState<any | null>(null);
  const [side, setSide] = useState<Side>('our');
  const [defense, setDefense] = useState<Record<Side, string | null>>({ our: null, opponent: null });
  const [newPlay, setNewPlay] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewQ, setViewQ] = useState<number | 'all' | null>(null);   // null: follow the live quarter
  // An outcome tapped, waiting for its player.
  const [pick, setPick] = useState<{ call: any; stat: string } | null>(null);
  // A past possession opened to add to or correct; otherwise the open one.
  const [editId, setEditId] = useState<number | null>(null);

  const load = useCallback(() => {
    playCallingAPI.game(game.id).then(setData).catch(() => {});
  }, [game.id]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const possessions: any[] = data?.possessions ?? [];
  const current = possessions.length ? possessions[possessions.length - 1] : null;
  const open = current && current.result == null ? current : null;
  const editing = editId != null ? possessions.find(p => p.id === editId) ?? null : null;
  // The trip being played stays open to add to (the free throw after an
  // and-1, a putback after a miss) until the next play is called.
  const target = editing ?? current;
  const shownQ = viewQ ?? liveQuarter;
  const shown = shownQ === 'all' ? possessions : possessions.filter(p => p.quarter === shownQ);
  const quarters = useMemo(() => {
    const qs = new Set<number>(possessions.map(p => p.quarter));
    for (let q = 1; q <= Math.max(4, liveQuarter); q++) qs.add(q);
    return Array.from(qs).sort((a, b) => a - b);
  }, [possessions, liveQuarter]);

  const typeLabel = (k: string) => tr(`playCalling.types.${k}`, { defaultValue: k });

  const callPlay = async (name: string) => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await playCallingAPI.add(game.id, { side, quarter: liveQuarter, play: name.trim(), defense: defense[side] });
      setNewPlay('');
      setViewQ(null);
      setEditId(null);
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

  const logOutcome = async (player: string) => {
    if (!pick) return;
    const { call, stat } = pick;
    setPick(null);
    try {
      const r = await playCallingAPI.outcome(call.id, stat, player);
      onScores(r.our_score ?? null, r.opponent_score ?? null);
      load();
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('common.somethingWentWrong'));
    }
  };

  const closeTrip = async (call: any) => {
    await playCallingAPI.close(call.id).catch(() => {});
    load();
  };

  const undoEvent = async (ev: any) => {
    try {
      await playCallingAPI.undoStat(ev.id);
      const g = await playCallingAPI.game(game.id);
      setData(g);
      load();
    } catch { /* gone already */ }
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

  const offenseEvents = (p: any) => (p.events ?? []).filter((e: any) => e.is_opponent === (p.side === 'opponent'));
  const eventText = (e: any) => `${e.player_name} ${statLabel(e.stat_name)}${e.points ? ` (+${e.points})` : ''}`;
  const resultText = (p: any) => {
    const evs = offenseEvents(p);
    if (evs.length) return evs.map(eventText).join(' · ');
    if (p.result == null) return tr('playCalling.open');
    if (p.result === 'score') return `+${p.points ?? ''}${p.player_name ? ` ${p.player_name}` : ''}`;
    return `− ${tr('playCalling.noScore')}`;
  };

  const roster = pick ? players[pick.call.side as Side] : [];

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

      {/* The trip being played (or a past one opened to correct): what
          happened in it, as stats for a player. */}
      {target ? (
        <View style={s.openCard}>
          <View style={[s.row, { alignItems: 'center' }]}>
            <Text style={[s.openText, { flex: 1 }]} numberOfLines={1}>
              {qLabel(target.quarter)} · {sideNames[target.side as Side]} · {target.play}
              {target.defense ? ` ${tr('playCalling.vs')} ${target.defense}` : ''}
            </Text>
            {editing && (
              <TouchableOpacity onPress={() => setEditId(null)}>
                <Text style={s.backLive}>{tr('playCalling.done')}</Text>
              </TouchableOpacity>
            )}
          </View>
          {offenseEvents(target).length > 0 && (
            <View style={{ gap: 4 }}>
              {offenseEvents(target).map((e: any) => (
                <View key={e.id} style={[s.row, { alignItems: 'center' }]}>
                  <Text style={[s.eventText, { color: isMade(e.stat_name) ? t.positive : t.negative }]} numberOfLines={1}>
                    {eventText(e)}
                  </Text>
                  <TouchableOpacity onPress={() => undoEvent(e)} accessibilityLabel={tr('playCalling.undo')}>
                    <Ionicons name="arrow-undo-outline" size={14} color={t.muted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          <View style={s.chips}>
            {OUTCOMES.map(k => {
              const good = isMade(k);
              return (
                <TouchableOpacity key={k} onPress={() => setPick({ call: target, stat: k })}
                                  style={[s.outcomeBtn, { borderColor: good ? t.positive : t.negative,
                                                          backgroundColor: good ? t.positiveSoft : t.negativeSoft }]}>
                  <Text style={[s.outcomeText, { color: good ? t.positive : t.negative }]}>{statLabel(k)}</Text>
                </TouchableOpacity>
              );
            })}
            {target.result == null && (
              <TouchableOpacity onPress={() => closeTrip(target)} style={[s.outcomeBtn, { borderColor: t.line }]}>
                <Text style={[s.outcomeText, { color: t.muted }]}>{tr('playCalling.noScore')}</Text>
              </TouchableOpacity>
            )}
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
                          onPress={() => setEditId(p.id === open?.id ? null : p.id)}>
          <Text style={s.itemQ}>{qLabel(p.quarter)}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.itemPlay} numberOfLines={1}>
              {sideNames[p.side as Side]} · {p.play}{p.defense ? ` ${tr('playCalling.vs')} ${p.defense}` : ''}
            </Text>
            <Text style={[s.itemResult, { color: p.result === 'score' ? t.positive : p.result === 'no_score' ? t.negative : t.muted }]}
                  numberOfLines={2}>{resultText(p)}</Text>
          </View>
        </TouchableOpacity>
      ))}

      {/* Who: the player for the outcome just tapped. */}
      <Sheet visible={!!pick} transparent animationType="slide" onRequestClose={() => setPick(null)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={[s.row, { alignItems: 'center', marginBottom: 10 }]}>
              <Text style={s.sheetTitle}>{pick ? tr('playCalling.whoFor', { stat: statLabel(pick.stat) }) : ''}</Text>
              <TouchableOpacity onPress={() => setPick(null)} style={{ marginLeft: 'auto' }}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={s.chips}>
              {roster.map(p => (
                <TouchableOpacity key={p.name} style={s.howBtn} onPress={() => logOutcome(p.name)}>
                  <Text style={s.howText}>{p.jersey ? `#${p.jersey} ` : ''}{p.name}</Text>
                </TouchableOpacity>
              ))}
              {!roster.length && <Text style={s.empty}>{tr('playCalling.noPlayers')}</Text>}
            </ScrollView>
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
  outcomeBtn: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  outcomeText: { fontFamily: fonts[800], fontSize: 12.5 },
  eventText: { flex: 1, fontSize: 12.5, fontFamily: fonts[700] },
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
