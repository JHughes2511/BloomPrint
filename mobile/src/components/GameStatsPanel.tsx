import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Rect, Line, Circle, Path, G } from 'react-native-svg';
import { gameEvalAPI } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

/**
 * A game's numbers: the box score, and the charts that can honestly be drawn
 * from it.
 *
 * Everything here comes from stat events already recorded — tapped live or read
 * out of an imported sheet. Nothing is estimated. Three of the six panels a
 * coach asked for need data a box score does not contain (a running score with
 * a clock, or a coordinate per shot); rather than draw an empty or invented
 * version, those say which kind of file would fill them. A fabricated shot
 * chart is worse than no shot chart: it reads as measurement.
 */

const LEADER_KEYS = ['efficiency', 'points', 'rebounds', 'assists', 'blocks', 'steals'] as const;

const ADVANCED_FIELDS = [
  { key: 'points_off_turnovers' }, { key: 'fast_break_points' },
  { key: 'second_chance_points' }, { key: 'points_in_paint' }, { key: 'bench_points' },
] as const;

const mmss = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The margin through the game, one bar per scoring event: above the line when
 * we are ahead, below when we are not. A box score says the game finished
 * 80-71; only this says whether it was ever close.
 */
function LeadTracker({ data, ours, theirs, ourColor, theirColor, t, s, tr }: any) {
  const pts = data.points ?? [];
  const peak = Math.max(1, ...pts.map((p: any) => Math.abs(p.margin)));
  const H = 150, mid = H / 2;
  const barW = Math.max(2, Math.min(10, 900 / Math.max(pts.length, 1)));
  const W = Math.max(pts.length * (barW + 1), 10);
  const rows: [string, any, any][] = [
    [tr('gameStats.biggestLead'), data.biggest_lead.us, data.biggest_lead.them],
    [tr('gameStats.biggestRun'), data.biggest_run.us, data.biggest_run.them],
    [tr('gameStats.timeLeading'), mmss(data.time_leading.us), mmss(data.time_leading.them)],
  ];
  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>{tr('gameStats.leadTracker')}</Text>
      <View style={s.legend}>
        <Text style={[s.legendText, { color: ourColor }]} numberOfLines={1}>{ours.team_name}</Text>
        <Text style={[s.legendText, { color: theirColor, textAlign: 'right' }]} numberOfLines={1}>{theirs.team_name}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Svg width={W} height={H}>
          <Line x1={0} y1={mid} x2={W} y2={mid} stroke={t.line} strokeWidth={1} />
          {pts.map((p: any, i: number) => {
            const h = (Math.abs(p.margin) / peak) * (mid - 6);
            const up = p.margin >= 0;
            return (
              <Rect key={i} x={i * (barW + 1)} width={barW}
                    y={up ? mid - h : mid} height={Math.max(h, 0.5)}
                    fill={up ? ourColor : theirColor} />
            );
          })}
        </Svg>
      </ScrollView>
      {rows.map(([label, a, b]) => (
        <View key={label} style={s.leaderRow}>
          <Text style={[s.compareValue, { color: ourColor, flex: 1 }]}>{a}</Text>
          <Text style={{ color: t.muted, fontSize: 11, fontFamily: fonts[700] }}>{label}</Text>
          <Text style={[s.compareValue, { color: theirColor, flex: 1, textAlign: 'right' }]}>{b}</Text>
        </View>
      ))}
      <View style={[s.leaderRow, { justifyContent: 'center' }]}>
        <Text style={{ color: t.ink, fontSize: 15, fontFamily: fonts[800] }}>{data.lead_changes}</Text>
        <Text style={{ color: t.muted, fontSize: 11, fontFamily: fonts[700] }}>{tr('gameStats.leadChanges')}</Text>
      </View>
    </View>
  );
}

/**
 * Where the shots came from. Made is a filled dot, missed an open cross —
 * distinguishable without relying on colour, which is doing team duty here.
 */
function ShotChart({ shots, ours, theirs, ourColor, theirColor, t, s, tr }: any) {
  const W = 560, H = W * 0.53;   // a basketball court is roughly 94 x 50
  const px = (x: number) => (Math.max(0, Math.min(100, x)) / 100) * W;
  const py = (y: number) => (Math.max(0, Math.min(100, y)) / 100) * H;
  const line = t.line;
  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>{tr('gameStats.shotChart')}</Text>
      <View style={s.legend}>
        <Text style={[s.legendText, { color: ourColor }]} numberOfLines={1}>{ours.team_name}</Text>
        <Text style={[s.legendText, { color: theirColor, textAlign: 'right' }]} numberOfLines={1}>{theirs.team_name}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Svg width={W} height={H}>
          <Rect x={1} y={1} width={W - 2} height={H - 2} fill="none" stroke={line} strokeWidth={1.5} rx={4} />
          <Line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke={line} strokeWidth={1.5} />
          <Circle cx={W / 2} cy={H / 2} r={H * 0.12} fill="none" stroke={line} strokeWidth={1.5} />
          {/* Keys and arcs, one per end. */}
          {[0, 1].map(side => {
            const flip = side === 1;
            const keyW = W * 0.19, keyH = H * 0.32;
            const kx = flip ? W - keyW : 0;
            const hoopX = flip ? W - W * 0.06 : W * 0.06;
            const r = H * 0.42;
            return (
              <G key={side}>
                <Rect x={kx} y={(H - keyH) / 2} width={keyW} height={keyH} fill="none" stroke={line} strokeWidth={1.5} />
                <Circle cx={hoopX} cy={H / 2} r={H * 0.022} fill="none" stroke={line} strokeWidth={1.5} />
                <Path
                  d={`M ${hoopX} ${H / 2 - r} A ${r} ${r} 0 0 ${flip ? 0 : 1} ${hoopX} ${H / 2 + r}`}
                  fill="none" stroke={line} strokeWidth={1.5}
                />
              </G>
            );
          })}
          {shots.map((sh: any, i: number) => {
            const c = sh.is_opponent ? theirColor : ourColor;
            const x = px(sh.x), y = py(sh.y);
            return sh.made
              ? <Circle key={i} cx={x} cy={y} r={4.5} fill={c} />
              : (
                <G key={i}>
                  <Line x1={x - 4} y1={y - 4} x2={x + 4} y2={y + 4} stroke={c} strokeWidth={2} />
                  <Line x1={x - 4} y1={y + 4} x2={x + 4} y2={y - 4} stroke={c} strokeWidth={2} />
                </G>
              );
          })}
        </Svg>
      </ScrollView>
      <Text style={[s.empty, { marginTop: 8 }]}>{tr('gameStats.shotLegend')}</Text>
    </View>
  );
}
type LeaderKey = typeof LEADER_KEYS[number];

const KEY_STATS: { key: string; label: string }[] = [
  { key: 'PTS', label: 'PTS' }, { key: 'REB', label: 'REB' },
  { key: 'OREB', label: 'OREB' }, { key: 'DREB', label: 'DREB' },
  { key: 'AST', label: 'AST' }, { key: 'STL', label: 'STL' },
  { key: 'BLK', label: 'BLK' }, { key: 'TO', label: 'TO' },
  { key: 'PF', label: 'PF' },
];

// Column order of the box score, matching how a printed one reads.
const BOX_COLS = ['PTS', 'FGM', 'FGA', '3PM', '3PA', 'FTM', 'FTA',
                  'OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF'];

export default function GameStatsPanel({ gameId }: { gameId: number }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [leaderTab, setLeaderTab] = useState<LeaderKey>('efficiency');

  useEffect(() => {
    let live = true;
    setLoading(true);
    gameEvalAPI.boxScore(gameId)
      .then(d => { if (live) setData(d); })
      .catch(() => { if (live) setData(null); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [gameId]);

  if (loading) return <ActivityIndicator color={t.accent} style={{ marginTop: 24 }} />;
  if (!data?.available?.box_score) {
    return (
      <View style={s.card}>
        <Text style={s.empty}>{tr('gameStats.noStatsYet')}</Text>
      </View>
    );
  }

  const [ours, theirs] = data.sides;
  const ourColor = t.accent;
  const theirColor = t.negative;

  /** A two-sided bar: our number against theirs, each scaled to the larger. */
  const CompareRow = ({ label, a, b }: { label: string; a: number; b: number }) => {
    const max = Math.max(a, b, 1);
    return (
      <View style={s.compareRow}>
        <View style={s.compareSide}>
          <Text style={[s.compareValue, { color: ourColor, textAlign: 'right' }]}>{a}</Text>
          <View style={s.trackRight}>
            <View style={[s.bar, { width: `${(a / max) * 100}%`, backgroundColor: ourColor }]} />
          </View>
        </View>
        <Text style={s.compareLabel}>{label}</Text>
        <View style={s.compareSide}>
          <View style={s.trackLeft}>
            <View style={[s.bar, { width: `${(b / max) * 100}%`, backgroundColor: theirColor }]} />
          </View>
          <Text style={[s.compareValue, { color: theirColor }]}>{b}</Text>
        </View>
      </View>
    );
  };

  /** A chart that cannot be drawn, and the file that would let it be. */
  const Missing = ({ title, need }: { title: string; need: string }) => (
    <View style={s.card}>
      <Text style={s.cardLabel}>{title}</Text>
      <Text style={s.empty}>{tr(`gameStats.needs.${need}`)}</Text>
    </View>
  );

  const leaders = data.leaders?.[leaderTab] ?? [];

  return (
    <View>
      {/* ── Game Leaders ── */}
      <View style={s.card}>
        <Text style={s.cardLabel}>{tr('gameStats.gameLeaders')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {LEADER_KEYS.map(k => (
              <TouchableOpacity
                key={k}
                style={[s.chip, leaderTab === k && s.chipActive]}
                onPress={() => setLeaderTab(k)}
              >
                <Text style={[s.chipText, leaderTab === k && s.chipTextActive]}>
                  {tr(`gameStats.leaders.${k}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        {leaders.length === 0
          ? <Text style={s.empty}>{tr('gameStats.noneRecorded')}</Text>
          : leaders.map((l: any, i: number) => (
              <View key={`${l.team_name}-${l.player}`} style={s.leaderRow}>
                <Text style={s.rank}>{i + 1}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.leaderName} numberOfLines={1}>{l.player}</Text>
                  <Text style={s.leaderTeam} numberOfLines={1}>{l.team_name}</Text>
                </View>
                <Text style={s.leaderValue}>{l.value}</Text>
              </View>
            ))}
      </View>

      {/* ── Shooting ── */}
      {data.available.shooting ? (
        <View style={s.card}>
          <Text style={s.cardLabel}>{tr('gameStats.shooting')}</Text>
          <View style={s.legend}>
            <Text style={[s.legendText, { color: ourColor }]} numberOfLines={1}>{ours.team_name}</Text>
            <Text style={[s.legendText, { color: theirColor, textAlign: 'right' }]} numberOfLines={1}>{theirs.team_name}</Text>
          </View>
          {([['FG', 'fg'], ['2PT', 'two'], ['3PT', 'three'], ['FT', 'ft']] as const).map(([label, key]) => {
            const a = data.shooting[0][key], b = data.shooting[1][key];
            return (
              <View key={key} style={s.compareRow}>
                <View style={s.compareSide}>
                  <Text style={[s.compareValue, { color: ourColor, textAlign: 'right' }]}>
                    {a == null ? '—' : `${a}%`}
                  </Text>
                  <View style={s.trackRight}>
                    <View style={[s.bar, { width: `${a ?? 0}%`, backgroundColor: ourColor }]} />
                  </View>
                </View>
                <Text style={s.compareLabel}>{label}</Text>
                <View style={s.compareSide}>
                  <View style={s.trackLeft}>
                    <View style={[s.bar, { width: `${b ?? 0}%`, backgroundColor: theirColor }]} />
                  </View>
                  <Text style={[s.compareValue, { color: theirColor }]}>
                    {b == null ? '—' : `${b}%`}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <Missing title={tr('gameStats.shooting')} need="attempts" />
      )}

      {/* ── Key Stats ── */}
      <View style={s.card}>
        <Text style={s.cardLabel}>{tr('gameStats.keyStats')}</Text>
        <View style={s.legend}>
          <Text style={[s.legendText, { color: ourColor }]} numberOfLines={1}>{ours.team_name}</Text>
          <Text style={[s.legendText, { color: theirColor, textAlign: 'right' }]} numberOfLines={1}>{theirs.team_name}</Text>
        </View>
        {KEY_STATS.map(k => (
          <CompareRow key={k.key} label={k.label}
                      a={ours.totals[k.key] ?? 0} b={theirs.totals[k.key] ?? 0} />
        ))}
      </View>

      {/* ── Lead Tracker ── */}
      {data.available.lead_tracker
        ? <LeadTracker data={data.lead_tracker} ours={ours} theirs={theirs}
                       ourColor={ourColor} theirColor={theirColor} t={t} s={s} tr={tr} />
        : <Missing title={tr('gameStats.leadTracker')} need={data.needs.lead_tracker} />}

      {/* ── Advanced Stats ── */}
      {data.available.advanced ? (
        <View style={s.card}>
          <Text style={s.cardLabel}>{tr('gameStats.advanced')}</Text>
          <View style={s.legend}>
            <Text style={[s.legendText, { color: ourColor }]} numberOfLines={1}>{ours.team_name}</Text>
            <Text style={[s.legendText, { color: theirColor, textAlign: 'right' }]} numberOfLines={1}>{theirs.team_name}</Text>
          </View>
          {ADVANCED_FIELDS.map(f => {
            const a = data.advanced.find((r: any) => !r.is_opponent)?.[f.key];
            const b = data.advanced.find((r: any) => r.is_opponent)?.[f.key];
            // A panel that did not state this row leaves it out entirely rather
            // than drawing two empty bars that read as nil-all.
            if (a == null && b == null) return null;
            return <CompareRow key={f.key} label={tr(`gameStats.adv.${f.key}`)} a={a ?? 0} b={b ?? 0} />;
          })}
        </View>
      ) : (
        <Missing title={tr('gameStats.advanced')} need={data.needs.advanced} />
      )}

      {/* ── Shot Chart ── */}
      {data.available.shot_chart
        ? <ShotChart shots={data.shot_chart} ours={ours} theirs={theirs}
                     ourColor={ourColor} theirColor={theirColor} t={t} s={s} tr={tr} />
        : <Missing title={tr('gameStats.shotChart')} need={data.needs.shot_chart} />}

      {/* ── Box score ── */}
      {data.sides.filter((side: any) => side.players.length > 0).map((side: any) => (
        <View key={String(side.is_opponent)} style={s.card}>
          <Text style={s.cardLabel} numberOfLines={1}>{side.team_name}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={[s.tRow, s.tHead]}>
                <Text style={[s.tCell, s.tName, s.tHeadText]} numberOfLines={1}>
                  {tr('gameStats.player')}
                </Text>
                {BOX_COLS.map(c => (
                  <Text key={c} style={[s.tCell, s.tHeadText]}>{c}</Text>
                ))}
              </View>
              {side.players.map((p: any) => (
                <View key={p.player} style={s.tRow}>
                  <Text style={[s.tCell, s.tName]} numberOfLines={1}>{p.player}</Text>
                  {BOX_COLS.map(c => <Text key={c} style={s.tCell}>{p[c] ?? 0}</Text>)}
                </View>
              ))}
              <View style={[s.tRow, s.tTotals]}>
                <Text style={[s.tCell, s.tName, s.tHeadText]} numberOfLines={1}>
                  {tr('gameStats.total')}
                </Text>
                {BOX_COLS.map(c => (
                  <Text key={c} style={[s.tCell, s.tHeadText]}>{side.totals[c] ?? 0}</Text>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => ({
  card: { backgroundColor: t.card, borderRadius: 14, padding: 14, marginBottom: 12,
          borderWidth: 1, borderColor: t.cardBorder } as const,
  cardLabel: { color: t.label, fontSize: 10, fontFamily: fonts[800], letterSpacing: 1,
               textTransform: 'uppercase', marginBottom: 10 } as const,
  empty: { color: t.muted2, fontSize: 12, lineHeight: 18 } as const,

  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1,
          borderColor: t.line } as const,
  chipActive: { backgroundColor: t.accentSoft, borderColor: t.accent } as const,
  chipText: { color: t.muted, fontSize: 12, fontFamily: fonts[700] } as const,
  chipTextActive: { color: t.accent } as const,

  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7,
               borderTopWidth: 1, borderTopColor: t.line } as const,
  rank: { color: t.muted2, fontSize: 11, width: 16 } as const,
  leaderName: { color: t.ink, fontSize: 13, fontFamily: fonts[700] } as const,
  leaderTeam: { color: t.muted2, fontSize: 10 } as const,
  leaderValue: { color: t.ink, fontSize: 15, fontFamily: fonts[800] } as const,

  legend: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, gap: 8 } as const,
  legendText: { fontSize: 11, fontFamily: fonts[700], flex: 1 } as const,
  compareRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 } as const,
  compareSide: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 } as const,
  compareLabel: { color: t.muted, fontSize: 10, fontFamily: fonts[700], width: 42,
                  textAlign: 'center' } as const,
  compareValue: { fontSize: 12, fontFamily: fonts[800], minWidth: 42 } as const,
  trackRight: { flex: 1, height: 14, backgroundColor: t.chip, borderRadius: 4,
                flexDirection: 'row', justifyContent: 'flex-end', overflow: 'hidden' } as const,
  trackLeft: { flex: 1, height: 14, backgroundColor: t.chip, borderRadius: 4,
               flexDirection: 'row', overflow: 'hidden' } as const,
  bar: { height: '100%' } as const,

  tRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: t.line } as const,
  tHead: { borderTopWidth: 0 } as const,
  tTotals: { borderTopWidth: 2, borderTopColor: t.line } as const,
  tCell: { width: 46, paddingVertical: 7, color: t.inkSoft, fontSize: 12, textAlign: 'center' } as const,
  tName: { width: 150, textAlign: 'left', color: t.ink, paddingRight: 8 } as const,
  tHeadText: { color: t.label, fontFamily: fonts[800], fontSize: 11 } as const,
});
