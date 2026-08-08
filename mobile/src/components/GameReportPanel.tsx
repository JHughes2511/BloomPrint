import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import VoiceTextInput from './VoiceTextInput';
import { gameEvalAPI } from '../api/client';
import { GeneratingOverlay, parseGenProgress, jobProgressLabel } from './GeneratingBasketball';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

/**
 * GameReportPanel — the game-report twin of ScoutContextPanel. One place to add
 * the qualitative context a full game report needs beyond the box score. Context
 * can be:
 *   - "Remember for {opponent}" → opponent note (persists across games, also
 *     feeds scouting + packets)
 *   - "This report"             → game-report correction (this report only)
 * Apply & Regenerate rebuilds the report from stats + opponent notes + both
 * channels, and persists it (so it lands in Recents and feeds game packets).
 */
export type GameReportPanelProps = {
  gameId: number;
  opponentName?: string;
  hasReport?: boolean;
  onRegenerated?: (newText: string) => void;
};

export default function GameReportPanel({ gameId, opponentName, hasReport, onRegenerated }: GameReportPanelProps) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const [notes, setNotes] = useState<any[]>([]);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState('');
  const [versions, setVersions] = useState<any[]>([]);

  const loadVersions = async () => {
    try { setVersions(await gameEvalAPI.reportVersions(gameId, 'game_report')); } catch { setVersions([]); }
  };

  const restore = async (versionId: number) => {
    try {
      const res = await gameEvalAPI.restoreReportVersion(gameId, versionId);
      await loadVersions();
      onRegenerated?.(res.ai_game_report ?? '');
    } catch (e: any) { Alert.alert(tr('common.error'), e?.response?.data?.detail ?? e?.message ?? tr('components.gameReport.couldNotGenerate')); }
  };

  const reload = async () => {
    try { setCorrections(await gameEvalAPI.gameReportCorrections(gameId)); } catch { setCorrections([]); }
    if (opponentName) {
      try { setNotes(await gameEvalAPI.getOpponentNotes(opponentName)); } catch { setNotes([]); }
    }
  };
  useEffect(() => { reload(); loadVersions(); }, [gameId, opponentName]);

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (remember && opponentName) await gameEvalAPI.addOpponentNote(opponentName, text.trim());
      else await gameEvalAPI.addGameReportCorrection(gameId, text.trim());
      setText('');
      await reload();
      Alert.alert(tr('components.gameReport.saved'), tr('components.gameReport.contextSaved'));
    } catch (e: any) { Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('components.gameReport.couldNotSave')); }
    setBusy(false);
  };

  const delNote = async (id: number) => {
    try { await gameEvalAPI.deleteOpponentNote(id); await reload(); }
    catch (e: any) { Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('components.gameReport.couldNotDelete')); }
  };
  const delCorrection = async (id: number) => {
    try { await gameEvalAPI.deleteGameReportCorrection(id); await reload(); }
    catch (e: any) { Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('components.gameReport.couldNotDelete')); }
  };

  const applyRegen = async () => {
    setApplying(true);
    setProgress('');
    try {
      const typed = text.trim();
      // See ScoutContextPanel: the server files the text and applies it.
      if (typed) setText('');
      const res = await gameEvalAPI.applyGameReportCorrections(
        gameId, { text: typed || undefined, remember: !!(remember && opponentName) }, setProgress);
      await reload();
      await loadVersions();
      onRegenerated?.(res.ai_game_report ?? '');
    } catch (e: any) { Alert.alert(tr('common.error'), e?.response?.data?.detail ?? e?.message ?? tr('components.gameReport.couldNotGenerate')); }
    setApplying(false);
  };

  return (
    <View>
      <Text style={s.hint}>
        {tr('components.gameReport.hint')}
      </Text>

      <VoiceTextInput
        style={s.input}
        placeholder={tr('components.gameReport.contextPlaceholder')}
        placeholderTextColor={t.muted2}
        value={text}
        onChangeText={setText}
        multiline
      />
      {!!opponentName && (
        <View style={s.rememberRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.rememberLabel}>{tr('components.gameReport.rememberFor', { opponent: opponentName })}</Text>
            <Text style={s.rememberSub}>{remember ? tr('components.gameReport.rememberOn') : tr('components.gameReport.rememberOff')}</Text>
          </View>
          <Switch value={remember} onValueChange={setRemember} trackColor={{ false: t.line, true: t.accent }} thumbColor="#fff" />
        </View>
      )}

      <View style={s.btnRow}>
        <TouchableOpacity style={[s.secondaryBtn, (!text.trim() || busy) && { opacity: 0.5 }]} onPress={add} disabled={!text.trim() || busy}>
          <Text style={s.secondaryText} numberOfLines={1}>{tr('common.save')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.primaryBtn, applying && { opacity: 0.6 }]} onPress={applyRegen} disabled={applying}>
          {applying ? <ActivityIndicator color={t.ctaText} size="small" /> : (
            <>
              <Ionicons name="sparkles-outline" size={14} color={t.ctaText} />
              <Text style={s.primaryText} numberOfLines={1}>{hasReport ? tr('components.gameReport.applyRegenerate') : tr('components.gameReport.generateGameReport')}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={{ maxHeight: 200, marginTop: 12 }}>
        {!!opponentName && (
          <>
            <Text style={s.section}>{tr('components.gameReport.rememberedAbout', { opponent: String(opponentName).toUpperCase() })}</Text>
            {notes.length === 0 && <Text style={s.empty}>{tr('components.gameReport.noneYet')}</Text>}
            {notes.map((n: any) => (
              <View key={`note-${n.id}`} style={s.row}>
                <Text style={s.rowText}>{n.note_text ?? n.text}</Text>
                <TouchableOpacity onPress={() => delNote(n.id)}><Ionicons name="trash-outline" size={16} color={t.negative} /></TouchableOpacity>
              </View>
            ))}
          </>
        )}
        <Text style={[s.section, { marginTop: 10 }]}>{tr('components.gameReport.thisReport')}</Text>
        {corrections.length === 0 && <Text style={s.empty}>{tr('components.gameReport.noneYet')}</Text>}
        {corrections.map((c: any) => (
          <View key={`corr-${c.id}`} style={s.row}>
            <Text style={[s.rowText, c.applied && { color: t.muted2 }]}>{c.correction}</Text>
            {!c.applied && <TouchableOpacity onPress={() => delCorrection(c.id)}><Ionicons name="trash-outline" size={16} color={t.negative} /></TouchableOpacity>}
          </View>
        ))}
      </ScrollView>

      {versions.length > 0 && (
        <View style={{ marginTop: 12 }}>
          <Text style={s.section}>{tr('components.gameReport.previousVersions')}</Text>
          {versions.slice(0, 5).map((v: any) => (
            <View key={v.id} style={s.row}>
              <Text style={s.rowText} numberOfLines={1}>{new Date(v.created_at).toLocaleString()}</Text>
              <TouchableOpacity onPress={() => restore(v.id)}>
                <Text style={s.restoreText}>{tr('components.gameReport.restore')}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <GeneratingOverlay
        visible={applying}
        label={jobProgressLabel(progress, tr) || tr('components.gameReport.building')}
        realProgress={parseGenProgress(progress)}
      />
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  restoreText: { color: t.accent, fontSize: 11, fontFamily: fonts[600] },
  hint: { color: t.muted2, fontSize: 12, marginBottom: 10, lineHeight: 18 },
  input: { backgroundColor: t.card, borderRadius: 10, padding: 12, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 60, textAlignVertical: 'top' },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, backgroundColor: t.chip, borderRadius: 10, padding: 12 },
  rememberLabel: { color: t.ink, fontSize: 13, fontFamily: fonts[700] },
  rememberSub: { color: t.muted2, fontSize: 11, marginTop: 2 },
  secondaryBtn: { paddingHorizontal: 18, borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.accent, backgroundColor: t.accentSoft },
  secondaryText: { color: t.accent, fontFamily: fonts[700], fontSize: 13 },
  /**
   * Wraps rather than squeezes. On a phone the primary label — "Generate
   * Scouting Report", or "Apply & Regenerate" — cannot fit beside the other
   * buttons, and squeezing it wrapped the text onto a second line and left the
   * pills different heights. flexBasis is the width it asks for; when it no
   * longer fits it takes a line of its own at full width instead.
   */
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'stretch' },
  primaryBtn: { flexGrow: 1, flexBasis: 200, minWidth: 200, flexDirection: 'row', gap: 5, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: t.ctaBg },
  primaryText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 13 },
  section: { color: t.label, fontSize: 10, fontFamily: fonts[800], letterSpacing: 1, marginBottom: 6 },
  empty: { color: t.muted2, fontSize: 12, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.chip, borderRadius: 8, padding: 10, marginBottom: 6 },
  rowText: { flex: 1, color: t.inkSoft, fontSize: 13 },
});
