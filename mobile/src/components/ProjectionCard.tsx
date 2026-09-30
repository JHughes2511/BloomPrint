/**
 * The living projection on a player's profile: who they will be in 4–5 years,
 * read from everything on file (api/projection.py).
 *
 * Shows the separation verdict, likely level and role, best / likely / floor,
 * the two comps, what must happen, and a confidence meter that is counted from
 * the evidence (reports, tracked games, films), never judged. Remade on demand
 * here, and by the server whenever a new report on the player is saved; the
 * "what changed" line says what moved it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { playersAPI } from '../api/client';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

type Props = {
  playerId: number;
  t: ThemeTokens;
  tr: (k: string, o?: any) => string;
  style?: any;
  /** Changes when the profile reloads (a new report), to fetch again. */
  refreshKey?: any;
};

const sepColor = (sep: string, t: ThemeTokens) =>
  sep === 'DOMINANT' || sep === 'SEPARATES' ? t.positive
    : sep === 'ONE-TOOL SEPARATOR' ? t.accent : sep === 'AT LEVEL' ? t.brown : sep ? t.negative : t.muted;

const sepKey = (sep: string) => sep.toLowerCase().replace(/[^a-z]+/g, '_');

export default function ProjectionCard({ playerId, t, tr, style, refreshKey }: Props) {
  const s = makeStyles(t);
  const [p, setP] = useState<any | null>(null);
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<any>(null);

  const load = useCallback(() => {
    playersAPI.projection(playerId).then(setP).catch(() => setP({ status: 'none', can_make: false }));
  }, [playerId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  // While one is being made, look again every few seconds.
  useEffect(() => {
    clearTimeout(timer.current);
    if (p?.status === 'making') timer.current = setTimeout(load, 3000);
    return () => clearTimeout(timer.current);
  }, [p, load]);

  const make = async () => {
    setAsking(true); setErr(null);
    try { setP(await playersAPI.refreshProjection(playerId)); }
    catch (e: any) { setErr(e?.response?.data?.detail ?? tr('common.somethingWentWrong')); }
    finally { setAsking(false); }
  };

  const d = p?.data;
  const making = p?.status === 'making';
  const m = p?.meter ?? { score: 0, level: 'low' };
  const ev = p?.evidence ?? {};
  const meterColor = m.level === 'high' ? t.positive : m.level === 'medium' ? t.accent : t.brown;

  return (
    <View style={[s.card, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Ionicons name="telescope-outline" size={16} color={t.label} />
        <Text style={[s.label, { flex: 1 }]}>{tr('projection.title')}</Text>
        {d && !making && (
          <TouchableOpacity onPress={make} disabled={asking} style={s.refresh} accessibilityLabel={tr('projection.refresh')}>
            {asking ? <ActivityIndicator size="small" color={t.accent} />
              : <><Ionicons name="refresh" size={14} color={t.accent} /><Text style={s.refreshText}>{tr('projection.refresh')}</Text></>}
          </TouchableOpacity>
        )}
      </View>

      {!p ? <ActivityIndicator color={t.accent} style={{ marginVertical: 12 }} /> : !d ? (
        <View style={{ gap: 10 }}>
          {making ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color={t.accent} />
              <Text style={s.muted}>{tr('projection.making')}</Text>
            </View>
          ) : (
            <>
              <Text style={s.muted}>{p.can_make ? tr('projection.intro') : tr('projection.empty')}</Text>
              {p.status === 'failed' && <Text style={[s.muted, { color: t.negative }]}>{tr('projection.failed')}</Text>}
              {p.can_make && (
                <TouchableOpacity style={s.makeBtn} onPress={make} disabled={asking}>
                  {asking ? <ActivityIndicator size="small" color={t.ctaText} />
                    : <Text style={s.makeText}>{tr('projection.make')}</Text>}
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          {making && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <ActivityIndicator size="small" color={t.accent} />
              <Text style={s.small}>{tr('projection.updating')}</Text>
            </View>
          )}

          {/* Identify: the separation verdict */}
          {!!d.separation && (
            <View style={{ gap: 4 }}>
              <View style={[s.pill, { borderColor: sepColor(d.separation, t) }]}>
                <Text style={[s.pillText, { color: sepColor(d.separation, t) }]}>
                  {tr(`projection.sep.${sepKey(d.separation)}`, { defaultValue: d.separation })}
                </Text>
              </View>
              <Text style={s.small}>{tr(`projection.sepMeaning.${sepKey(d.separation)}`, { defaultValue: '' })}</Text>
              {!!d.separation_why && <Text style={s.body}>{d.separation_why}</Text>}
            </View>
          )}

          {/* Likely level and role */}
          <View>
            <Text style={s.section}>{tr('projection.likelyIn')}</Text>
            <Text style={s.headline}>{[d.level, d.role].filter(Boolean).join(' · ') || d.likely}</Text>
          </View>

          {/* Best / likely / floor */}
          <View style={s.outcomes}>
            {(['best', 'likely', 'floor'] as const).map(k => (
              <View key={k} style={[s.outcome, k === 'likely' && { borderColor: t.accent }]}>
                <Text style={[s.section, k === 'likely' && { color: t.accent }]}>{tr(`projection.${k}`)}</Text>
                <Text style={s.body}>{d[k] || '—'}</Text>
              </View>
            ))}
          </View>

          {/* Comps */}
          {!!(d.style_comp || d.level_comp) && (
            <View style={{ gap: 6 }}>
              {!!d.style_comp && <Text style={s.body}><Text style={s.bold}>{tr('projection.styleComp')}: </Text>{d.style_comp}</Text>}
              {!!d.level_comp && <Text style={s.body}><Text style={s.bold}>{tr('projection.levelComp')}: </Text>{d.level_comp}</Text>}
            </View>
          )}

          {(d.must_happen ?? []).length > 0 && (
            <View>
              <Text style={s.section}>{tr('projection.mustHappen')}</Text>
              {d.must_happen.map((x: string, i: number) => <Text key={i} style={s.body}>• {x}</Text>)}
            </View>
          )}

          {/* Confidence: counted from the evidence */}
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[s.section, { marginBottom: 0 }]}>{tr('projection.confidence')}</Text>
              <Text style={[s.pillText, { color: meterColor }]}>{tr(`projection.conf.${m.level}`)}</Text>
            </View>
            <View style={s.track} accessibilityLabel={`${tr('projection.confidence')} ${m.score}%`}>
              <View style={[s.fill, { width: `${Math.max(4, m.score)}%`, backgroundColor: meterColor }]} />
            </View>
            <Text style={s.small}>
              {tr('projection.evReports')} {ev.reports ?? 0} · {tr('projection.evGames')} {ev.games ?? 0} · {tr('projection.evFilms')} {ev.films ?? 0}
            </Text>
            {!!d.confidence_note && <Text style={s.small}>{d.confidence_note}</Text>}
          </View>

          {!!d.what_changed && (
            <View style={s.changed}>
              <Ionicons name="swap-vertical" size={14} color={t.brown} />
              <Text style={[s.body, { flex: 1 }]}><Text style={s.bold}>{tr('projection.changed')}: </Text>{d.what_changed}</Text>
            </View>
          )}

          {p.newer && !making && <Text style={[s.small, { color: t.accent }]}>{tr('projection.newer')}</Text>}
          {!!p.made_at && (
            <Text style={s.small}>{tr('projection.updated', { date: new Date(p.made_at).toLocaleDateString() })}</Text>
          )}
        </View>
      )}
      {!!err && <Text style={[s.small, { color: t.negative, marginTop: 8 }]}>{err}</Text>}
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => ({
  card: { backgroundColor: t.card, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: t.cardBorder } as const,
  label: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase' as const },
  section: { color: t.muted, fontSize: 10.5, fontFamily: fonts[800], letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 4 },
  headline: { color: t.ink, fontSize: 18, fontFamily: fonts[800] },
  body: { color: t.inkSoft, fontSize: 13.5, lineHeight: 19 },
  bold: { color: t.ink, fontFamily: fonts[700] },
  small: { color: t.muted, fontSize: 12 },
  muted: { color: t.muted, fontSize: 13.5 },
  pill: { alignSelf: 'flex-start' as const, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 11.5, fontFamily: fonts[800], letterSpacing: 0.5 },
  outcomes: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  outcome: { flexGrow: 1, flexBasis: 150, borderWidth: 1, borderColor: t.divider, borderRadius: 12, padding: 10 },
  track: { height: 8, borderRadius: 999, backgroundColor: t.chip, overflow: 'hidden' as const },
  fill: { height: 8, borderRadius: 999 },
  changed: { flexDirection: 'row' as const, gap: 6, alignItems: 'flex-start' as const, backgroundColor: t.brownSoft, borderRadius: 10, padding: 9 },
  refresh: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 4 },
  refreshText: { color: t.accent, fontSize: 12.5, fontFamily: fonts[700] },
  makeBtn: { alignSelf: 'flex-start' as const, backgroundColor: t.ctaBg, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, minWidth: 120, alignItems: 'center' as const },
  makeText: { color: t.ctaText, fontSize: 13, fontFamily: fonts[800] },
});
