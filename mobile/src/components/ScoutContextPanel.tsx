import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import VoiceTextInput from './VoiceTextInput';
import { gameEvalAPI } from '../api/client';
import { GeneratingOverlay } from './GeneratingBasketball';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

/**
 * ScoutContextPanel — one place to add the qualitative context a scouting
 * report needs beyond the box score. Context can be:
 *   - "Remembered for {opponent}"  → opponent note (persists across games)
 *   - "This report"                → game scouting correction (this game only)
 * Apply & Regenerate rebuilds the report from stats + BOTH channels.
 */
export type ScoutContextPanelProps = {
  gameId: number;
  opponentName?: string;
  onRegenerated?: (newText: string) => void;
  onBack?: () => void;
};

export default function ScoutContextPanel({ gameId, opponentName, onRegenerated, onBack }: ScoutContextPanelProps) {
  const { t } = useTheme();
  const s = makeStyles(t);
  const [notes, setNotes] = useState<any[]>([]);       // opponent notes (remembered)
  const [corrections, setCorrections] = useState<any[]>([]); // game corrections (this report)
  const [text, setText] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);

  const reload = async () => {
    try { setCorrections(await gameEvalAPI.scoutingCorrections(gameId)); } catch { setCorrections([]); }
    if (opponentName) {
      try { setNotes(await gameEvalAPI.getOpponentNotes(opponentName)); } catch { setNotes([]); }
    }
  };
  useEffect(() => { reload(); }, [gameId, opponentName]);

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (remember && opponentName) await gameEvalAPI.addOpponentNote(opponentName, text.trim());
      else await gameEvalAPI.addScoutingCorrection(gameId, text.trim());
      setText('');
      await reload();
      Alert.alert('Saved', 'Context saved. Apply & Regenerate when ready.');
    } catch (e: any) { Alert.alert('Error', e?.response?.data?.detail ?? 'Could not save'); }
    setBusy(false);
  };

  const delNote = async (id: number) => {
    try { await gameEvalAPI.deleteOpponentNote(id); await reload(); }
    catch (e: any) { Alert.alert('Error', e?.response?.data?.detail ?? 'Could not delete'); }
  };
  const delCorrection = async (id: number) => {
    try { await gameEvalAPI.deleteScoutingCorrection(id); await reload(); }
    catch (e: any) { Alert.alert('Error', e?.response?.data?.detail ?? 'Could not delete'); }
  };

  const applyRegen = async () => {
    setApplying(true);
    try {
      if (text.trim()) {
        if (remember && opponentName) await gameEvalAPI.addOpponentNote(opponentName, text.trim());
        else await gameEvalAPI.addScoutingCorrection(gameId, text.trim());
        setText('');
      }
      const res = await gameEvalAPI.applyScoutingCorrections(gameId);
      await reload();
      onRegenerated?.(res.ai_scouting_report ?? '');
    } catch (e: any) { Alert.alert('Error', e?.response?.data?.detail ?? 'Could not regenerate'); }
    setApplying(false);
  };

  return (
    <View>
      <Text style={s.hint}>
        Add context the box score can't capture — schemes, personnel, injuries, tendencies. Apply & Regenerate rebuilds the report from the stats plus everything here.
      </Text>

      <VoiceTextInput
        style={s.input}
        placeholder="Add context or an adjustment..."
        placeholderTextColor={t.muted2}
        value={text}
        onChangeText={setText}
        multiline
      />
      {!!opponentName && (
        <View style={s.rememberRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.rememberLabel}>Remember for {opponentName}</Text>
            <Text style={s.rememberSub}>{remember ? 'Kept for every future scout of this opponent' : 'Applies to this report only'}</Text>
          </View>
          <Switch value={remember} onValueChange={setRemember} trackColor={{ false: t.line, true: t.accent }} thumbColor="#fff" />
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {onBack && (
          <TouchableOpacity style={s.secondaryBtn} onPress={onBack}>
            <Text style={{ color: t.muted, fontFamily: fonts[700] }}>Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[s.secondaryBtn, (!text.trim() || busy) && { opacity: 0.5 }]} onPress={add} disabled={!text.trim() || busy}>
          <Text style={{ color: t.accent, fontFamily: fonts[700] }}>Save Corrections</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.primaryBtn, applying && { opacity: 0.6 }]} onPress={applyRegen} disabled={applying}>
          {applying ? <ActivityIndicator color={t.ctaText} size="small" /> : (
            <><Ionicons name="sparkles-outline" size={14} color={t.ctaText} /><Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>  Apply & Regenerate</Text></>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={{ maxHeight: 200, marginTop: 12 }}>
        {!!opponentName && (
          <>
            <Text style={s.section}>REMEMBERED ABOUT {String(opponentName).toUpperCase()}</Text>
            {notes.length === 0 && <Text style={s.empty}>None yet.</Text>}
            {notes.map((n: any) => (
              <View key={`note-${n.id}`} style={s.row}>
                <Text style={s.rowText}>{n.note_text ?? n.text}</Text>
                <TouchableOpacity onPress={() => delNote(n.id)}><Ionicons name="trash-outline" size={16} color={t.negative} /></TouchableOpacity>
              </View>
            ))}
          </>
        )}
        <Text style={[s.section, { marginTop: 10 }]}>THIS REPORT</Text>
        {corrections.length === 0 && <Text style={s.empty}>None yet.</Text>}
        {corrections.map((c: any) => (
          <View key={`corr-${c.id}`} style={s.row}>
            <Text style={[s.rowText, c.applied && { color: t.muted2 }]}>{c.correction}</Text>
            {!c.applied && <TouchableOpacity onPress={() => delCorrection(c.id)}><Ionicons name="trash-outline" size={16} color={t.negative} /></TouchableOpacity>}
          </View>
        ))}
      </ScrollView>

      <GeneratingOverlay visible={applying} label="Rebuilding the scouting report…" />
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  hint: { color: t.muted2, fontSize: 12, marginBottom: 10, lineHeight: 18 },
  input: { backgroundColor: t.card, borderRadius: 10, padding: 12, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 60, textAlignVertical: 'top' },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, backgroundColor: t.chip, borderRadius: 10, padding: 12 },
  rememberLabel: { color: t.ink, fontSize: 13, fontFamily: fonts[700] },
  rememberSub: { color: t.muted2, fontSize: 11, marginTop: 2 },
  secondaryBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.accent, backgroundColor: t.accentSoft },
  primaryBtn: { flex: 1.4, flexDirection: 'row', borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.ctaBg },
  section: { color: t.label, fontSize: 10, fontFamily: fonts[800], letterSpacing: 1, marginBottom: 6 },
  empty: { color: t.muted2, fontSize: 12, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.chip, borderRadius: 8, padding: 10, marginBottom: 6 },
  rowText: { flex: 1, color: t.inkSoft, fontSize: 13 },
});
