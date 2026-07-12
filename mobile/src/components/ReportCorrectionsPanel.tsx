import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import VoiceTextInput from './VoiceTextInput';
import { GeneratingOverlay } from './GeneratingBasketball';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

/**
 * ReportCorrectionsPanel — a focused, report-specific pass for correcting things
 * in a FINISHED report (distinct from the context panel that builds it). Enter
 * what's wrong, add it, then Apply Corrections to regenerate. Reused by the
 * scouting report and the full game report via injected API functions.
 */
export type ReportCorrectionsPanelProps = {
  list: () => Promise<any[]>;
  add: (text: string) => Promise<any>;
  remove: (id: number) => Promise<any>;
  apply: () => Promise<any>;
  resultKey: string;               // key on the apply() response holding the new text
  onApplied?: (newText: string) => void;
};

export default function ReportCorrectionsPanel({ list, add, remove, apply, resultKey, onApplied }: ReportCorrectionsPanelProps) {
  const { t } = useTheme();
  const s = makeStyles(t);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);

  const reload = async () => { try { setCorrections(await list()); } catch { setCorrections([]); } };
  useEffect(() => { reload(); }, []);

  const addCorrection = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await add(text.trim());
      setText('');
      await reload();
    } catch (e: any) { Alert.alert('Error', e?.response?.data?.detail ?? 'Could not save correction'); }
    setBusy(false);
  };

  const delCorrection = async (id: number) => {
    try { await remove(id); await reload(); }
    catch (e: any) { Alert.alert('Error', e?.response?.data?.detail ?? 'Could not delete'); }
  };

  const applyCorrections = async () => {
    setApplying(true);
    try {
      if (text.trim()) { await add(text.trim()); setText(''); }
      const res = await apply();
      await reload();
      onApplied?.(res?.[resultKey] ?? '');
    } catch (e: any) { Alert.alert('Error', e?.response?.data?.detail ?? 'Could not apply corrections'); }
    setApplying(false);
  };

  const pending = corrections.filter((c: any) => !c.applied);

  return (
    <View>
      <Text style={s.hint}>
        Something wrong in the report? Note the correction, then Apply Corrections to rebuild it with your fixes.
      </Text>

      <VoiceTextInput
        style={s.input}
        placeholder="e.g. The 3PT number is wrong — he was 8-of-13, not 12-of-13"
        placeholderTextColor={t.muted2}
        value={text}
        onChangeText={setText}
        multiline
      />

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'stretch' }}>
        <TouchableOpacity style={[s.secondaryBtn, (!text.trim() || busy) && { opacity: 0.5 }]} onPress={addCorrection} disabled={!text.trim() || busy}>
          <Text style={s.secondaryText} numberOfLines={1}>Add</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.primaryBtn, (applying || (pending.length === 0 && !text.trim())) && { opacity: 0.5 }]}
          onPress={applyCorrections}
          disabled={applying || (pending.length === 0 && !text.trim())}
        >
          {applying ? <ActivityIndicator color={t.ctaText} size="small" /> : (
            <>
              <Ionicons name="sparkles-outline" size={14} color={t.ctaText} />
              <Text style={s.primaryText} numberOfLines={1}>Apply Corrections</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={{ maxHeight: 180, marginTop: 12 }}>
        {corrections.length === 0 && <Text style={s.empty}>No corrections yet.</Text>}
        {corrections.map((c: any) => (
          <View key={`corr-${c.id}`} style={s.row}>
            <Text style={[s.rowText, c.applied && { color: t.muted2 }]}>{c.correction}</Text>
            {c.applied
              ? <Text style={s.appliedTag}>applied</Text>
              : <TouchableOpacity onPress={() => delCorrection(c.id)}><Ionicons name="trash-outline" size={16} color={t.negative} /></TouchableOpacity>}
          </View>
        ))}
      </ScrollView>

      <GeneratingOverlay visible={applying} label="Applying your corrections…" />
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  hint: { color: t.muted2, fontSize: 12, marginBottom: 10, lineHeight: 18 },
  input: { backgroundColor: t.card, borderRadius: 10, padding: 12, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 60, textAlignVertical: 'top' },
  secondaryBtn: { paddingHorizontal: 18, borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.accent, backgroundColor: t.accentSoft },
  secondaryText: { color: t.accent, fontFamily: fonts[700], fontSize: 13 },
  primaryBtn: { flex: 1, flexDirection: 'row', gap: 5, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: t.ctaBg },
  primaryText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 13 },
  empty: { color: t.muted2, fontSize: 12, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.chip, borderRadius: 8, padding: 10, marginBottom: 6 },
  rowText: { flex: 1, color: t.inkSoft, fontSize: 13 },
  appliedTag: { color: t.muted2, fontSize: 10, fontFamily: fonts[700], textTransform: 'uppercase', letterSpacing: 0.5 },
});
