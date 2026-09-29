/**
 * "Who's who in this clip?" — for a Game Report film cut from several games,
 * the clips where the analysis could not tell which colour was which team.
 *
 * Each clip shows a frame and the colours on the floor; tap the team for each
 * colour (or Neither, for a team that is not one of the two). An answer is
 * saved as soon as every colour has one. Answers count whenever they are
 * given, even after the analysis has finished: plays are filed under teams
 * when they are read. Each answer also teaches the app the teams' colours.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import { gameReportsAPI } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { sheetCap } from '../responsive/modalSizes';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function TeamClipSheet({ reportId, clipId, onClose }: { reportId: number; clipId: number | null; onClose: () => void }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const [data, setData] = useState<{ teams: string[]; segments: any[] } | null>(null);
  const [draft, setDraft] = useState<Record<number, Record<string, string>>>({});
  const pending = useRef<Promise<any>[]>([]);

  useEffect(() => {
    if (!clipId) return;
    setData(null); setDraft({});
    gameReportsAPI.clipSegments(reportId, clipId).then(setData).catch(() => setData({ teams: [], segments: [] }));
  }, [reportId, clipId]);

  const pick = (g: any, colour: string, team: string) => {
    const next = { ...(draft[g.id] ?? {}), [colour]: team };
    setDraft(d => ({ ...d, [g.id]: next }));
    // Saved once every colour on the floor has a team.
    if ((g.seen ?? []).every((c: string) => next[c])) {
      setData(prev => prev && ({ ...prev, segments: prev.segments.map(x => (x.id === g.id ? { ...x, answer: 'answered', colours: next } : x)) }));
      pending.current.push(gameReportsAPI.answerSegment(reportId, clipId!, g.id, next).catch(() => {}));
    }
  };
  const open = (data?.segments ?? []).filter(g => !g.answer);
  useEffect(() => {
    if (data && data.segments.length && !open.length) { const tm = setTimeout(onClose, 600); return () => clearTimeout(tm); }
  }, [data]);
  const done = () => {
    const id = clipId;
    onClose();
    if (id) Promise.all(pending.current).then(() => gameReportsAPI.segmentsDone(reportId, id)).catch(() => {});
  };

  const choices = [...(data?.teams ?? []), 'neither'];
  return (
    <Sheet visible={!!clipId} transparent animationType="fade" onRequestClose={done}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{tr('teamClips.title')}</Text>
              <Text style={s.hint}>{tr('teamClips.hint')}</Text>
            </View>
            <TouchableOpacity onPress={done}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
          </View>
          {!data ? <ActivityIndicator color={t.accent} style={{ marginVertical: 24 }} /> : (
            <ScrollView style={{ maxHeight: 540 }} contentContainerStyle={s.grid}>
              {data.segments.map(g => (
                <View key={g.id} style={[s.card, g.answer && { opacity: 0.55 }]}>
                  {g.thumb ? <Image source={{ uri: g.thumb }} style={s.thumb} resizeMode="cover" accessibilityLabel={tr('clipCheck.frame')} />
                    : <View style={[s.thumb, { alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="film-outline" size={28} color={t.muted2} /></View>}
                  <Text style={s.meta}>{tr('clipCheck.clip', { n: g.idx })} · {mmss(g.start)}–{mmss(g.end)}</Text>
                  {(g.seen ?? []).map((colour: string) => {
                    const chosen = (g.answer ? g.colours : draft[g.id])?.[colour];
                    return (
                      <View key={colour} style={{ gap: 4 }}>
                        <Text style={s.colour}>{tr('teamClips.whoWore', { colour })}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                          {choices.map(team => {
                            const on = chosen === team;
                            return (
                              <TouchableOpacity key={team} disabled={!!g.answer} onPress={() => pick(g, colour, team)}
                                                style={[s.chip, on && s.chipOn]}>
                                <Text style={[s.chipText, on && s.chipTextOn]}>{team === 'neither' ? tr('teamClips.neither') : team}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          )}
          <TouchableOpacity style={[s.done, { backgroundColor: t.chip }]} onPress={done}>
            <Text style={{ color: t.ink, fontFamily: fonts[800] }}>
              {open.length ? tr('teamClips.doneLeave', { count: open.length }) : tr('clipCheck.done')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Sheet>
  );
}

const makeStyles = (t: ThemeTokens) => ({
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'center' as const, padding: 16 },
  sheet: { backgroundColor: t.sheet, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(860) },
  title: { color: t.ink, fontSize: 17, fontFamily: fonts[800] },
  hint: { color: t.muted, fontSize: 12.5, marginTop: 4, marginBottom: 12 },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10 },
  card: { flexBasis: 250, flexGrow: 1, gap: 8, borderWidth: 1, borderColor: t.cardBorder, borderRadius: 12, padding: 8, backgroundColor: t.card },
  thumb: { width: '100%' as const, aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: t.chip },
  meta: { color: t.muted, fontSize: 12 },
  colour: { color: t.inkSoft, fontSize: 12.5, fontFamily: fonts[700] },
  chip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipOn: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  chipText: { color: t.inkSoft, fontSize: 12.5, fontFamily: fonts[700] },
  chipTextOn: { color: t.ctaText },
  done: { marginTop: 12, borderRadius: 12, paddingVertical: 12, alignItems: 'center' as const },
});
