/**
 * Play calling, live: what was called, against what, and whether it scored.
 *
 * Sits under the live tracker's Line-up and End Game. The quarter a possession
 * is filed under is the tracker's own — the Q row at the top of the page — and
 * never this panel's: the panel's own quarter row only chooses which quarter to
 * LOOK at, so a coach reading back through Q1 in the third quarter cannot file
 * a Q3 possession under Q1.
 *
 * Top to bottom is the order a coach works in: the defense, then the play
 * (which starts the trip), then the shot. A possession opens when its play is
 * tapped and closes when the next one is called. What happened in it is tapped as real stats — 2 FG Made, 3 FG
 * Missed, FT Made, Turnover — each for a player, so reading a possession back
 * says who did what. The same basket tapped in Stats is claimed, not added,
 * so it is counted once (see api/play_calling.py).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Sheet from './Sheet';
import { InjuryTag } from './InjuryLog';
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
  onScoreBump: (side: Side, points: number) => void;
  clock?: () => number | null;
  injuryOf?: (name: string, side: Side) => any;   // a current injury, to tag the player in the picker             // seconds left on the tracker's clock, stamped on each stat   // a basket on the scoreboard now, before the server says so
  statLabel: (k: string) => string;
  t: ThemeTokens;
  tr: (k: string, o?: any) => string;
}

const OUTCOMES = ['2 FG Made', '2 FG Missed', '3 FG Made', '3 FG Missed', 'FT Made', 'FT Missed', 'Turnover'];
const isMade = (k: string) => /Made$/.test(k);

const PTS: Record<string, number> = { '2 FG Made': 2, '3 FG Made': 3, 'FT Made': 1 };

export default function PlayCallingPanel({ game, liveQuarter, qLabel, sideNames, players, refreshKey, onScores, onScoreBump,
                                           clock, injuryOf, statLabel, t, tr }: Props) {
  const s = makeStyles(t);
  const [data, setData] = useState<any | null>(null);
  const [side, setSide] = useState<Side>('our');
  const [defense, setDefense] = useState<Record<Side, string | null>>({ our: null, opponent: null });
  const [newPlay, setNewPlay] = useState('');
  const [viewQ, setViewQ] = useState<number | 'all' | null>(null);   // null: follow the live quarter
  // An outcome tapped, waiting for its player.
  const [pick, setPick] = useState<{ call: any; stat: string } | null>(null);

  // Every tap shows at once; the server catches up behind it. While a tap is
  // still on its way, a reload would wipe it off the screen, so reloads wait
  // until nothing is in flight. A possession made on screen has a stand-in id
  // (negative) until the server gives it a real one.
  const inFlight = useRef(0);
  const realIds = useRef<Record<number, Promise<number>>>({});
  const load = useCallback(() => {
    playCallingAPI.game(game.id).then(g => { if (inFlight.current === 0) setData(g); }).catch(() => {});
  }, [game.id]);
  useEffect(() => { load(); }, [load, refreshKey]);
  const idOf = (call: any): Promise<number> => call.id > 0 ? Promise.resolve(call.id) : realIds.current[call.id];
  const send = async (work: () => Promise<any>) => {
    inFlight.current += 1;
    try {
      return await work();
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('common.somethingWentWrong'));
      return undefined;
    } finally {
      inFlight.current -= 1;
      load();
    }
  };
  const patch = (id: number, fn: (p: any) => any) =>
    setData((prev: any) => prev && ({ ...prev, possessions: prev.possessions.map((p: any) => p.id === id ? fn(p) : p) }));

  const possessions: any[] = data?.possessions ?? [];
  // The trip being played stays open to add to (the free throw after an
  // and-1, a putback after a miss) until the next play is called.
  const current = possessions.length ? possessions[possessions.length - 1] : null;
  const shownQ = viewQ ?? liveQuarter;
  const shown = shownQ === 'all' ? possessions : possessions.filter(p => p.quarter === shownQ);
  const quarters = useMemo(() => {
    const qs = new Set<number>(possessions.map(p => p.quarter));
    for (let q = 1; q <= Math.max(4, liveQuarter); q++) qs.add(q);
    return Array.from(qs).sort((a, b) => a - b);
  }, [possessions, liveQuarter]);

  const typeLabel = (k: string) => tr(`playCalling.types.${k}`, { defaultValue: k });

  // Defense first, then the play: tapping the play starts the trip, with the
  // defense already on it.
  const callPlay = (name: string) => {
    const play = name.trim();
    if (!play) return;
    const tempId = -Date.now();
    const d = defense[side];
    setData((prev: any) => ({ ...(prev ?? {}), possessions: [...(prev?.possessions ?? []),
      { id: tempId, side, quarter: liveQuarter, play, defense: d, result: null, points: null, events: [] }] }));
    setNewPlay('');
    setViewQ(null);
    const made = playCallingAPI.add(game.id, { side, quarter: liveQuarter, play, defense: d });
    realIds.current[tempId] = made.then((r: any) => r.id);
    send(async () => {
      try {
        await made;
      } catch (e) {
        setData((prev: any) => prev && ({ ...prev, possessions: prev.possessions.filter((p: any) => p.id !== tempId) }));
        throw e;
      }
    });
  };

  const pickDefense = (d: string) => {
    const next = defense[side] === d ? null : d;
    setDefense(prev => ({ ...prev, [side]: next }));
    // Changing the defense while this side's trip is still open corrects it too.
    const c = current;
    if (c && c.side === side && c.result == null) {
      patch(c.id, p => ({ ...p, defense: next }));
      send(async () => playCallingAPI.edit(await idOf(c), { defense: next ?? '' }));
    }
  };

  const logOutcome = (player: string) => {
    if (!pick) return;
    const { call, stat } = pick;
    setPick(null);
    const at = clock?.() ?? null;       // the clock when tapped, not when sent
    const pts = PTS[stat] ?? 0;
    const ev = { id: -Date.now(), player_name: player, stat_name: stat, points: pts || null,
                 is_opponent: call.side === 'opponent' };
    patch(call.id, p => ({
      ...p, events: [...(p.events ?? []), ev],
      result: pts ? 'score' : stat === 'Turnover' && p.result == null ? 'no_score' : p.result,
      points: pts ? (p.points ?? 0) + pts : p.points,
    }));
    if (pts) onScoreBump(call.side, pts);
    send(async () => {
      try {
        const r = await playCallingAPI.outcome(await idOf(call), stat, player, at);
        onScores(r.our_score ?? null, r.opponent_score ?? null);
      } catch (e) {
        if (pts) onScoreBump(call.side, -pts);
        throw e;
      }
    });
  };

  const closeTrip = (call: any) => {
    patch(call.id, p => ({ ...p, result: 'no_score' }));
    send(async () => playCallingAPI.close(await idOf(call)));
  };

  const orb = async (sd: Side, delta: number) => {
    const q = String(liveQuarter);
    setData((prev: any) => prev && ({ ...prev, orb: { ...(prev.orb ?? {}), [sd]: { ...(prev.orb?.[sd] ?? {}),
      [q]: Math.max(0, Number(prev.orb?.[sd]?.[q] ?? 0) + delta) } } }));
    send(() => playCallingAPI.orb(game.id, sd, liveQuarter, delta));
  };

  // A wrong call comes off with everything tapped in it: its stats leave the
  // box score and its baskets come off the scoreboard.
  const removeCall = (call: any) => Alert.alert(tr('playCalling.deleteTitle'), tr('playCalling.deleteNote'), [
    { text: tr('common.cancel'), style: 'cancel' },
    { text: tr('common.delete'), style: 'destructive', onPress: () => {
      setData((prev: any) => prev && ({ ...prev, possessions: prev.possessions.filter((p: any) => p.id !== call.id) }));
      for (const e of call.events ?? []) {
        if (e.points) onScoreBump(e.is_opponent ? 'opponent' : 'our', -e.points);
      }
      send(async () => {
        const r = await playCallingAPI.remove(await idOf(call));
        onScores(r.our_score ?? null, r.opponent_score ?? null);
      });
    } },
  ]);

  const catalog: any[] = data?.catalog?.[side] ?? [];
  const defenses: string[] = data?.catalog?.defenses ?? [];
  const orbCount = (sd: Side) => Number(data?.orb?.[sd]?.[String(liveQuarter)] ?? 0);
  const shownScored = shown.filter(p => p.result === 'score').length;
  const shownDone = shown.filter(p => p.result).length;
  // Points only when every score shown has them: a score nobody gave points
  // for is a score, not a guess.
  const shownComplete = shown.filter(p => p.result === 'score').every(p => p.points != null);
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
  // The trip waiting for its shot. Once something is logged for it, it has
  // gone to the list below and this clears for the next play (a putback or
  // the free throw of an and-1 still attaches to it from the stat pad).
  const waiting = current && current.result == null && offenseEvents(current).length === 0 ? current : null;
  const callLine = (p: any) =>
    `${sideNames[p.side as Side]} · ${p.play}${p.defense ? ` ${tr('playCalling.vs')} ${p.defense}` : ''}`;

  // The team with the ball, sorted by jersey number, for a tidy grid.
  const jerseyNum = (j?: string | null) => { const n = parseInt(String(j ?? ''), 10); return Number.isFinite(n) ? n : 999; };
  const roster = pick ? [...players[pick.call.side as Side]].sort((a, b) =>
    jerseyNum(a.jersey) - jerseyNum(b.jersey) || a.name.localeCompare(b.name)) : [];
  const pickColor = pick?.call.side === 'opponent' ? t.negative : t.accent;
  const pickSoft = pick?.call.side === 'opponent' ? t.negativeSoft : t.accentSoft;

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

      {/* 1. Defense faced (remembered per side) */}
      <Text style={[s.label, s.section]}>{tr('playCalling.defense')}</Text>
      <View style={s.chips}>
        {defenses.map(d => (
          <TouchableOpacity key={d} style={[s.chip, defense[side] === d && s.chipOn]} onPress={() => pickDefense(d)}>
            <Text style={[s.chipText, defense[side] === d && s.chipTextOn]}>{d}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 2. The call: tap to start the next trip */}
      <Text style={[s.label, s.section]}>{tr('playCalling.play')}</Text>
      <View style={s.chips}>
        {/* The play being run lights up, the way the defense does. */}
        {catalog.slice(0, 16).map((p: any) => {
          const on = !!waiting && waiting.side === side && waiting.play === p.name;
          return (
            <TouchableOpacity key={p.name} style={[s.chip, on && s.chipOn]} onPress={() => callPlay(p.name)}
                              accessibilityHint={typeLabel(p.type)} accessibilityState={{ selected: on }}>
              <Text style={[s.chipText, on && s.chipTextOn]}>{p.name}</Text>
            </TouchableOpacity>
          );
        })}
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
        <TouchableOpacity style={[s.addBtn, !newPlay.trim() && { opacity: 0.5 }]} disabled={!newPlay.trim()}
                          onPress={() => callPlay(newPlay)}>
          <Text style={s.addText}>{tr('playCalling.call')}</Text>
        </TouchableOpacity>
      </View>

      {/* 3. The shot: what happened on the trip just called, as a stat for a
          player. It lands in the list below as it is tapped. */}
      <Text style={[s.label, s.section]}>{tr('playCalling.result')}</Text>
      {waiting ? (
        <View style={s.openCard}>
          <View style={[s.row, { alignItems: 'center' }]}>
            <Text style={[s.openText, { flex: 1 }]} numberOfLines={1}>{qLabel(waiting.quarter)} · {callLine(waiting)}</Text>
            <TouchableOpacity onPress={() => removeCall(waiting)} accessibilityLabel={tr('playCalling.deleteTitle')} hitSlop={8}>
              <Ionicons name="trash-outline" size={16} color={t.muted} />
            </TouchableOpacity>
          </View>
          <View style={s.chips}>
            {OUTCOMES.map(k => {
              const good = isMade(k);
              return (
                <TouchableOpacity key={k} onPress={() => setPick({ call: waiting, stat: k })}
                                  style={[s.outcomeBtn, { borderColor: good ? t.positive : t.negative,
                                                          backgroundColor: good ? t.positiveSoft : t.negativeSoft }]}>
                  <Text style={[s.outcomeText, { color: good ? t.positive : t.negative }]}>{statLabel(k)}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity onPress={() => closeTrip(waiting)} style={[s.outcomeBtn, { borderColor: t.line }]}>
              <Text style={[s.outcomeText, { color: t.muted }]}>{tr('playCalling.noScore')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Text style={s.empty}>{tr('playCalling.pickPlayFirst')}</Text>
      )}

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
        <Text style={s.quick}>
          {shownComplete
            ? tr('playCalling.quick', { scored: shownScored, n: shownDone, points: shownPts })
            : tr('playCalling.quickScored', { scored: shownScored, n: shownDone })}
        </Text>
      )}
      {shown.length === 0 ? (
        <Text style={s.empty}>{tr('playCalling.none')}</Text>
      ) : shown.slice().reverse().map(p => (
        <View key={p.id} style={s.item}>
          <Text style={s.itemQ}>{qLabel(p.quarter)}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.itemPlay} numberOfLines={1}>{callLine(p)}</Text>
            <Text style={[s.itemResult, { color: p.result === 'score' ? t.positive : p.result === 'no_score' ? t.negative : t.muted }]}
                  numberOfLines={2}>{resultText(p)}</Text>
          </View>
          <TouchableOpacity onPress={() => removeCall(p)} accessibilityLabel={tr('playCalling.deleteTitle')} hitSlop={8}>
            <Ionicons name="trash-outline" size={16} color={t.muted} />
          </TouchableOpacity>
        </View>
      ))}

      {/* Who: the player for the outcome just tapped. */}
      <Sheet visible={!!pick} transparent animationType="fade" onRequestClose={() => setPick(null)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={[s.row, { alignItems: 'flex-start', marginBottom: 12 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetTitle}>{pick ? tr('playCalling.whoFor', { stat: statLabel(pick.stat) }) : ''}</Text>
                {/* Whose players these are, in that team's colour. */}
                {pick && (
                  <View style={[s.teamTag, { backgroundColor: pickSoft, borderColor: pickColor }]}>
                    <View style={[s.teamDot, { backgroundColor: pickColor }]} />
                    <Text style={[s.teamTagText, { color: pickColor }]}>{sideNames[pick.call.side as Side]}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={() => setPick(null)}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={s.playerGrid}>
              {roster.map(p => (
                <TouchableOpacity key={p.name} style={s.playerCell} onPress={() => logOutcome(p.name)}>
                  <Text style={[s.playerNo, { color: pickColor }]}>{p.jersey ? `#${p.jersey}` : '—'}</Text>
                  <Text style={s.playerName} numberOfLines={2}>{p.name}</Text>
                  <InjuryTag injury={injuryOf?.(p.name, pick!.call.side as Side)} t={t} tr={tr} />
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
  // A section's own heading: clear of the one above, close to what it heads.
  section: { marginTop: 18, marginBottom: 8 },
  row: { flexDirection: 'row' as const, gap: 8 },
  sideBtn: { flex: 1, borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingVertical: 9, alignItems: 'center' as const },
  sideBtnOn: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  sideText: { color: t.inkSoft, fontFamily: fonts[700], fontSize: 13 },
  sideTextOn: { color: t.ctaText },
  openCard: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: t.cardBorder,
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
  sheet: { backgroundColor: t.sheet, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(760) },
  sheetTitle: { color: t.ink, fontSize: 17, fontFamily: fonts[800] },
  teamTag: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, alignSelf: 'flex-start' as const,
             marginTop: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  teamDot: { width: 7, height: 7, borderRadius: 4 },
  teamTagText: { fontSize: 12, fontFamily: fonts[800] },
  playerGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, rowGap: 8, columnGap: 8 },
  playerCell: { width: '31.8%' as const, minWidth: 140, flexGrow: 0, flexDirection: 'row' as const, alignItems: 'center' as const,
                gap: 8, borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10,
                backgroundColor: t.card },
  playerNo: { width: 34, fontSize: 13, fontFamily: fonts[800] },
  playerName: { flex: 1, color: t.ink, fontSize: 13, fontFamily: fonts[700] },
  howBtn: { borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: t.card },
  howText: { color: t.ink, fontSize: 13, fontFamily: fonts[700] },
});
