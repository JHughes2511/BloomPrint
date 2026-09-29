/**
 * "Is this him?" — the clips of a highlight tape the analysis was not sure of.
 *
 * Opened while the film is being analysed (the job says job:confirmClips).
 * Each clip is a frame with a box round who the analysis thinks is the
 * player; Yes counts it, No leaves it out. Done (or closing) leaves the rest
 * out, and the analysis carries on at once. Every answer also teaches the app
 * how the player looks, so the next tape asks less (api/player_look.py).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import { evalsAPI } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { sheetCap } from '../responsive/modalSizes';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function ClipCheckSheet({ jobId, playerName, onClose }: { jobId: number | null; playerName: string; onClose: () => void }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const [clips, setClips] = useState<any[] | null>(null);

  useEffect(() => {
    if (!jobId) return;
    setClips(null);
    evalsAPI.clipChecks(jobId).then(setClips).catch(() => setClips([]));
  }, [jobId]);

  // Answers still on their way: Done waits for them, or a quick Yes-then-Done
  // could reach the server in the wrong order and leave that clip out.
  const pending = useRef<Promise<any>[]>([]);
  const answer = (c: any, a: 'yes' | 'no') => {
    setClips(prev => prev && prev.map(x => (x.id === c.id ? { ...x, answer: a } : x)));
    pending.current.push(evalsAPI.answerClip(c.id, a).catch(() => {}));
  };
  const open = (clips ?? []).filter(c => !c.answer);
  // Every clip answered: nothing left to wait for.
  useEffect(() => {
    if (clips && clips.length && !open.length) { const tm = setTimeout(onClose, 600); return () => clearTimeout(tm); }
  }, [clips]);
  const done = () => {
    const id = jobId;
    onClose();
    if (id) Promise.all(pending.current).then(() => evalsAPI.clipChecksDone(id)).catch(() => {});
  };

  return (
    <Sheet visible={!!jobId} transparent animationType="fade" onRequestClose={done}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{tr('clipCheck.title', { name: playerName })}</Text>
              <Text style={s.hint}>{tr('clipCheck.hint')}</Text>
            </View>
            <TouchableOpacity onPress={done}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
          </View>
          {!clips ? <ActivityIndicator color={t.accent} style={{ marginVertical: 24 }} /> : (
            <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={s.grid}>
              {clips.map(c => (
                <View key={c.id} style={[s.card, c.answer && { opacity: 0.55 }]}>
                  {c.thumb ? <Image source={{ uri: c.thumb }} style={s.thumb} resizeMode="cover" accessibilityLabel={tr('clipCheck.frame')} />
                    : <View style={[s.thumb, { alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="film-outline" size={28} color={t.muted2} /></View>}
                  <Text style={s.meta}>
                    {tr('clipCheck.clip', { n: c.clip })} · {mmss(c.start ?? 0)}–{mmss(c.end ?? 0)}
                    {c.uni || c.no ? ` · ${[c.uni, c.no ? `#${c.no}` : ''].filter(Boolean).join(' ')}` : ''}
                  </Text>
                  {c.answer ? (
                    <Text style={[s.meta, { color: c.answer === 'yes' ? t.positive : t.muted, fontFamily: fonts[800] }]}>
                      {c.answer === 'yes' ? tr('clipCheck.counted') : tr('clipCheck.leftOut')}
                    </Text>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity style={[s.btn, { backgroundColor: t.ctaBg }]} onPress={() => answer(c, 'yes')}>
                        <Text style={{ color: t.ctaText, fontFamily: fonts[800], fontSize: 13 }}>{tr('clipCheck.yes')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.btn, { borderWidth: 1, borderColor: t.line }]} onPress={() => answer(c, 'no')}>
                        <Text style={{ color: t.inkSoft, fontFamily: fonts[700], fontSize: 13 }}>{tr('clipCheck.no')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
          <TouchableOpacity style={[s.done, { backgroundColor: t.chip }]} onPress={done}>
            <Text style={{ color: t.ink, fontFamily: fonts[800] }}>
              {open.length ? tr('clipCheck.doneLeaveOut', { count: open.length }) : tr('clipCheck.done')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Sheet>
  );
}

const makeStyles = (t: ThemeTokens) => ({
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'center' as const, padding: 16 },
  sheet: { backgroundColor: t.sheet, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(820) },
  title: { color: t.ink, fontSize: 17, fontFamily: fonts[800] },
  hint: { color: t.muted, fontSize: 12.5, marginTop: 4, marginBottom: 12 },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10 },
  card: { flexBasis: 230, flexGrow: 1, gap: 6, borderWidth: 1, borderColor: t.cardBorder, borderRadius: 12, padding: 8, backgroundColor: t.card },
  thumb: { width: '100%' as const, aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: t.chip },
  meta: { color: t.muted, fontSize: 12 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' as const },
  done: { marginTop: 12, borderRadius: 12, paddingVertical: 12, alignItems: 'center' as const },
});
