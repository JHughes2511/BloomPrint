/**
 * Play calling, at a glance: for a game's Insights and for a team in Scout.
 *
 * Each block is one team on one end of the floor — its offense, or (in Scout)
 * what opponents ran against its defense — with the rate it scored at, what it
 * ran, and how that went against each defense. The full tables and the report
 * live on the Play Calling tab; this is the part a coach reads before a game.
 *
 * Points are shown only where the server gave them, which is only where every
 * score in the line had its points recorded (api/play_calling.py _line).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { playCallingAPI } from '../api/client';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

export interface SummaryBlock {
  key: string;
  title: string;                 // "Angola offense", "Against Senegal's defense"
  color: string;                 // the team's colour
  block: any;                    // a play_calling._block
  playsTitle: string;            // "By play" / "Opponents' plays against them"
  defenseTitle: string;          // "By defense faced" / "By the defense they played"
}

interface Props {
  title: string;
  subtitle?: string;
  blocks: SummaryBlock[];
  onOpen?: () => void;           // to the full Play Calling page
  openLabel?: string;
  t: ThemeTokens;
  tr: (k: string, o?: any) => string;
}

const SHOW = 6;

/** A game's play calling, both teams' offense, for Game Insights. Nothing when none was recorded. */
export function GamePlayCallingCard({ gameId, sideNames, refreshKey = 0, onOpen, t, tr }: {
  gameId: number; sideNames: { our: string; opponent: string }; refreshKey?: number;
  onOpen?: () => void; t: ThemeTokens; tr: (k: string, o?: any) => string;
}) {
  const [summary, setSummary] = useState<any>(null);
  useEffect(() => {
    let live = true;
    playCallingAPI.game(gameId).then((d: any) => { if (live) setSummary(d.summary ?? {}); }).catch(() => {});
    return () => { live = false; };
  }, [gameId, refreshKey]);
  if (!summary) return null;
  const blocks: SummaryBlock[] = (['our', 'opponent'] as const).filter(sd => summary[sd]).map(sd => ({
    key: sd, block: summary[sd], color: sd === 'opponent' ? t.negative : t.accent,
    title: tr('playCalling.page.overall', { team: sideNames[sd] }),
    playsTitle: tr('playCalling.page.byPlay'), defenseTitle: tr('playCalling.page.byDefense'),
  }));
  return <PlayCallingSummary title={tr('playCalling.page.tab')} blocks={blocks} onOpen={onOpen}
                             openLabel={tr('playCalling.summary.open')} t={t} tr={tr} />;
}

export default function PlayCallingSummary({ title, subtitle, blocks, onOpen, openLabel, t, tr }: Props) {
  const s = makeStyles(t);
  const [more, setMore] = useState<Record<string, boolean>>({});
  if (!blocks.length) return null;

  const line = (r: any) => tr('playCalling.page.cardLine', { n: r.n, pct: r.pct })
    + (r.points != null ? ` · ${r.points} ${tr('playCalling.page.colPts').toLowerCase()}` : '');

  const Rows = ({ id, heading, rows }: { id: string; heading: string; rows: any[] }) => {
    if (!rows?.length) return null;
    const open = !!more[id];
    const shown = open ? rows : rows.slice(0, SHOW);
    const pts = rows.some(r => r.points != null);
    return (
      <View style={{ marginTop: 12 }}>
        <View style={[s.tr, s.th]}>
          <Text style={[s.heading, { flex: 1 }]}>{heading}</Text>
          <Text style={[s.thText, s.num]}>{tr('playCalling.page.colTrips')}</Text>
          <Text style={[s.thText, s.num]}>{tr('playCalling.page.colScored')}</Text>
          <Text style={[s.thText, s.num]}>%</Text>
          {pts && <Text style={[s.thText, s.num]}>{tr('playCalling.page.colPts')}</Text>}
        </View>
        {shown.map((r: any) => (
          <View key={String(r.key)} style={s.tr}>
            <Text style={[s.td, { flex: 1 }]} numberOfLines={1}>{String(r.key)}</Text>
            <Text style={[s.td, s.num]}>{r.n}</Text>
            <Text style={[s.td, s.num]}>{r.scored}</Text>
            <Text style={[s.td, s.num, { color: r.pct >= 50 ? t.positive : r.pct < 35 ? t.negative : t.inkSoft }]}>{r.pct}</Text>
            {pts && <Text style={[s.td, s.num]}>{r.points ?? '—'}</Text>}
          </View>
        ))}
        {rows.length > SHOW && (
          <TouchableOpacity onPress={() => setMore(m => ({ ...m, [id]: !open }))}>
            <Text style={s.more}>{open ? tr('playCalling.summary.less') : tr('playCalling.summary.more', { n: rows.length - SHOW })}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[s.cardLabel, { flex: 1 }]}>{title}</Text>
        {onOpen && (
          <TouchableOpacity onPress={onOpen}>
            <Text style={s.open}>{openLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      {blocks.map((b, i) => (
        <View key={b.key} style={[{ marginTop: i ? 22 : 8 }, i ? s.divided : null]}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <Text style={[s.team, { color: b.color }]}>{b.title}</Text>
            <Text style={s.overall}>{line(b.block.overall)}</Text>
          </View>
          <Rows id={`${b.key}-play`} heading={b.playsTitle} rows={b.block.by_play} />
          <Rows id={`${b.key}-def`} heading={b.defenseTitle} rows={b.block.by_defense} />
          <Rows id={`${b.key}-pvd`} heading={tr('playCalling.page.byPlayDefense')} rows={b.block.by_play_defense} />
        </View>
      ))}
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => ({
  card: { backgroundColor: t.card, borderRadius: 14, borderWidth: 1, borderColor: t.cardBorder, padding: 16, marginBottom: 12 } as const,
  cardLabel: { color: t.label, fontSize: 11.5, fontFamily: fonts[800], letterSpacing: 2, textTransform: 'uppercase' as const },
  subtitle: { color: t.muted2, fontSize: 12, marginTop: 4 },
  open: { color: t.accent, fontSize: 12, fontFamily: fonts[700] },
  divided: { paddingTop: 18, borderTopWidth: 1, borderTopColor: t.divider },
  team: { fontSize: 15, fontFamily: fonts[800] },
  overall: { color: t.inkSoft, fontSize: 13, fontFamily: fonts[700] },
  heading: { color: t.muted, fontSize: 10.5, fontFamily: fonts[800], letterSpacing: 1, textTransform: 'uppercase' as const },
  tr: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: 5, gap: 6,
        borderBottomWidth: 1, borderBottomColor: t.divider },
  th: { paddingBottom: 4 },
  thText: { color: t.muted2, fontSize: 10.5, fontFamily: fonts[700] },
  td: { color: t.ink, fontSize: 13 },
  num: { width: 44, textAlign: 'right' as const },
  more: { color: t.accent, fontSize: 12, fontFamily: fonts[700], marginTop: 6 },
});
