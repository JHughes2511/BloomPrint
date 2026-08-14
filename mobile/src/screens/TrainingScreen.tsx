import React, { useEffect, useState } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useGoUp } from '../navigation/goUp';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { trainingAPI } from '../api/client';
import { TrainingSession } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { topPad } from '../responsive/screenPadding';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer, { REPORT_MAX_WIDTH } from '../responsive/PageContainer';
import { GeneratingOverlay, parseGenProgress, jobProgressLabel } from '../components/GeneratingBasketball';
import { renderReport } from '../utils/renderReport';
import { useReportSearch, ReportSearchBar, ReportSearchButton } from '../components/ReportSearch';

export default function TrainingScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  // Back means up a level — see navigation/goUp.ts.
  const goUp = useGoUp();
  const { playerId, evalId } = route.params;
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const styles = makeStyles(t);

  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [current, setCurrent] = useState<TrainingSession | null>(null);
  // A training program is a week of days; finding one drill in it by eye is
  // the sort of scrolling this saves.
  const find = useReportSearch(current?.program_text ?? '');
  const [focusPrompt, setFocusPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  // How far into writing the program the server is, from the job it runs on.
  const [genProgress, setGenProgress] = useState('');
  const [reference, setReference] = useState<{ uri: string; name: string; type: string } | null>(null);

  useEffect(() => {
    trainingAPI.forPlayer(playerId)
      .then(s => { setSessions(s); if (s.length) setCurrent(s[s.length - 1]); })
      .finally(() => setLoading(false));
  }, [playerId]);

  const pickReference = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (!res.canceled && res.assets?.[0]) {
        const a = res.assets[0];
        setReference({ uri: a.uri, name: a.name ?? 'reference', type: a.mimeType ?? 'application/octet-stream' });
      }
    } catch {
      Alert.alert(tr('common.error'), tr('training.couldNotOpenFilePicker'));
    }
  };

  const generate = async () => {
    setGenerating(true);
    setGenProgress('');
    try {
      const s = await trainingAPI.generate(
        { player_id: playerId, evaluation_id: evalId, focus_prompt: focusPrompt, reference: reference ?? undefined },
        setGenProgress,
      );
      setSessions(prev => [...prev, s]);
      setCurrent(s);
      setFocusPrompt('');
      setReference(null);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? e?.message ?? tr('training.couldNotGenerateProgram'));
    } finally {
      setGenerating(false);
      setGenProgress('');
    }
  };

  if (loading) return <ScreenBackground><View style={styles.center}><ActivityIndicator color={t.accent} size="large" /></View></ScreenBackground>;

  return (
    <ScreenBackground>
    <PageContainer maxWidth={REPORT_MAX_WIDTH}>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={undefined}
    >
    <KeyboardAwareScrollView ref={find.scrollRef} style={styles.container} contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goUp()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={t.ink} />
        </TouchableOpacity>
        {/* Translated titles run 20-40% longer than English. Wrap to a second
            line rather than clipping — a truncated heading tells the coach
            less than a taller one costs them. */}
        <Text style={styles.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
          {tr('reportTypes.training_program')}
        </Text>
      </View>

      {/* Focus input */}
      <View style={styles.section}>
        <Text style={styles.label} numberOfLines={1}>{tr('training.additionalFocus')}</Text>
        <VoiceTextInput
          style={styles.input}
          placeholder={tr('training.focusPlaceholder')}
          placeholderTextColor={t.muted2}
          value={focusPrompt}
          onChangeText={setFocusPrompt}
          multiline
        />

        {/* Import reference content */}
        {reference ? (
          <View style={styles.refChip}>
            <Ionicons name="document-attach" size={16} color={t.accent} />
            <Text style={styles.refChipText} numberOfLines={1}>{reference.name}</Text>
            <TouchableOpacity style={styles.refChipClear} onPress={() => setReference(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color={t.muted} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.importBtn} onPress={pickReference}>
            <Ionicons name="cloud-upload-outline" size={16} color={t.accent} />
            <Text style={styles.importBtnText} numberOfLines={1}>{tr('training.importReference')}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.generateBtn} onPress={generate} disabled={generating}>
          {generating
            ? <><ActivityIndicator color={t.ctaText} /><Text style={styles.generateText} numberOfLines={1}>{tr('training.generating')}</Text></>
            : <><Ionicons name="barbell" size={16} color={t.ctaText} /><Text style={styles.generateText} numberOfLines={1}>{tr('training.generateProgram')}</Text></>
          }
        </TouchableOpacity>
        <GeneratingOverlay
          visible={generating}
          label={jobProgressLabel(genProgress, tr) || tr('training.buildingOverlay')}
          realProgress={parseGenProgress(genProgress)}
        />
      </View>

      {/* Priority stack */}
      {current?.priorities && current.priorities.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.label} numberOfLines={1}>{tr('training.priorityStack')}</Text>
          {current.priorities
            .filter(p => p && p.replace(/[^A-Za-z0-9]/g, '').length >= 3)
            .map((p, i) => (
            <View key={i} style={styles.priorityRow}>
              <View style={styles.priorityNum}>
                <Text style={styles.priorityNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.priorityText}>{p}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Program text */}
      {current?.program_text && (
        <View style={styles.section}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={[styles.label, { flex: 1 }]} numberOfLines={1}>{tr('training.fullProgram')}</Text>
            <ReportSearchButton ctl={find} />
          </View>
          <ReportSearchBar ctl={find} />
          {renderReport(current.program_text, { heading: t.ink, body: t.inkSoft }, find.search)}
        </View>
      )}

      {/* History */}
      {sessions.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.label} numberOfLines={1}>{tr('training.previousPrograms')}</Text>
          {[...sessions].reverse().slice(1).map((s, i, arr) => {
            const focus = (s.priorities ?? []).find(p => p && p.replace(/[^A-Za-z0-9]/g, '').length >= 3);
            return (
              <TouchableOpacity key={s.id} style={styles.historyCard} onPress={() => setCurrent(s)}>
                <Text style={styles.historyPriority} numberOfLines={1}>{tr('training.programNumber', { num: arr.length - i })}</Text>
                <Text style={styles.historyDate} numberOfLines={1}>
                  {new Date(s.created_at).toLocaleDateString()}{focus ? ` · ${focus}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {!current && !generating && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{tr('training.emptyText')}</Text>
        </View>
      )}
    </KeyboardAwareScrollView>
    </KeyboardAvoidingView>
    </PageContainer>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: topPad(56), gap: 12 },
  backBtn: { flexShrink: 0 },
  title: { color: t.ink, fontSize: 30, fontFamily: fonts[800], letterSpacing: -0.6, flex: 1, flexShrink: 1, minWidth: 0 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  label: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 },
  input: {
    backgroundColor: t.card, borderRadius: 14, padding: 14,
    color: t.ink, fontSize: 14, marginBottom: 12, borderWidth: 1, borderColor: t.line, minHeight: 70,
  },
  generateBtn: {
    backgroundColor: t.ctaBg, borderRadius: 999, padding: 15,
    // gap, not two spaces inside the label: leading whitespace in a text node
    // collapses in a browser, so the icon sat flush against the word.
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  generateText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 15, flexShrink: 1 },
  importBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12,
    backgroundColor: t.accentSoft, borderRadius: 12, padding: 13, flexShrink: 1,
  },
  importBtnText: { color: t.accent, fontFamily: fonts[600], fontSize: 12.5, flex: 1, flexShrink: 1, minWidth: 0 },
  refChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12,
    backgroundColor: t.card, borderRadius: 12, padding: 13, borderWidth: 1, borderColor: t.cardBorder,
  },
  refChipText: { color: t.ink, fontFamily: fonts[600], fontSize: 13, flex: 1, flexShrink: 1, minWidth: 0 },
  refChipClear: { flexShrink: 0 },
  priorityRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, gap: 12 },
  priorityNum: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: t.accent,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  priorityNumText: { color: t.ctaText, fontSize: 13, fontFamily: fonts[800] },
  priorityText: { color: t.inkSoft, fontSize: 14, flex: 1, lineHeight: 20, paddingTop: 4 },
  programText: { color: t.inkSoft, fontSize: 12, lineHeight: 20 },
  historyCard: { backgroundColor: t.card, borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: t.cardBorder },
  historyDate: { color: t.muted, fontSize: 11 },
  historyPriority: { color: t.inkSoft, fontSize: 13, marginTop: 2 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: t.muted2, fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
