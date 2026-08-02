import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  Image, Modal, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import VoiceTextInput from '../components/VoiceTextInput';
import {
  staffMessagesAPI, evalsAPI, gameReportsAPI, gameEvalAPI, trainingAPI,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer from '../responsive/PageContainer';
import { renderReport } from '../utils/renderReport';
import { reportSubject } from '../utils/reportSubject';
import { outputTypeLabel } from '../utils/reportType';
import { sheetCap, desktopOnly } from '../responsive/modalSizes';

export default function ConversationScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { coach } = useAuth();
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const styles = makeStyles(t);
  const cid: number = route.params?.conversationId;
  const initialTitle: string = route.params?.title ?? tr('conversation.title');

  const [title, setTitle] = useState(initialTitle);
  const [isGroup, setIsGroup] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<any[]>([]);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showReportPicker, setShowReportPicker] = useState(false);
  const [reportList, setReportList] = useState<any[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportSearch, setReportSearch] = useState('');
  const [reportView, setReportView] = useState<{ title: string; text: string } | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const rec = useRef<Audio.Recording | null>(null);

  const load = async () => {
    try {
      const res = await staffMessagesAPI.get(cid);
      setTitle(res.title ?? initialTitle);
      setIsGroup(!!res.is_group);
      setMessages(res.messages ?? []);
    } catch {}
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
  };

  // Poll while focused so new messages appear.
  useFocusEffect(useCallback(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [cid]));

  const send = async () => {
    if (!text.trim() && pending.length === 0) return;
    setSending(true);
    try {
      const m = await staffMessagesAPI.send(cid, { text: text.trim() || undefined, attachments: pending });
      setMessages(prev => [...prev, m]);
      setText('');
      setPending([]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('conversation.sendError'));
    } finally {
      setSending(false);
    }
  };

  // ── Attachments ──
  const pickImage = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert(tr('conversation.permissionNeededTitle'), tr('conversation.imagePermissionMsg')); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.5 });
    if (!res.canceled && res.assets?.[0]?.base64) {
      setPending(prev => [...prev, { kind: 'image', data: `data:image/jpeg;base64,${res.assets[0].base64}`, name: tr('conversation.image') }]);
    }
  };

  const startRec = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert(tr('conversation.permissionNeededTitle'), tr('conversation.micPermissionMsg')); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const r = new Audio.Recording();
      await r.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await r.startAsync();
      rec.current = r;
      setRecording(true);
    } catch { Alert.alert(tr('common.error'), tr('conversation.recordStartError')); }
  };

  const stopRec = async () => {
    const r = rec.current;
    if (!r) return;
    try {
      await r.stopAndUnloadAsync();
      const uri = r.getURI();
      rec.current = null;
      setRecording(false);
      if (uri) {
        const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
        setPending(prev => [...prev, { kind: 'audio', data: `data:audio/m4a;base64,${b64}`, name: tr('conversation.voiceMessage') }]);
      }
    } catch { setRecording(false); }
  };

  const playAudio = async (dataUri: string) => {
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      let uri = dataUri;
      // iOS can't play a data: URI directly — write it to a temp file first.
      if (dataUri.startsWith('data:')) {
        const b64 = dataUri.split(',')[1] ?? '';
        const path = `${FileSystem.cacheDirectory}sm_${Date.now()}.m4a`;
        await FileSystem.writeAsStringAsync(path, b64, { encoding: 'base64' as any });
        uri = path;
      }
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      sound.setOnPlaybackStatusUpdate((st: any) => { if (st?.isLoaded && st.didJustFinish) sound.unloadAsync().catch(() => {}); });
    } catch { Alert.alert(tr('common.error'), tr('conversation.playAudioError')); }
  };

  const openReportPicker = async () => {
    setShowReportPicker(true);
    setReportSearch('');
    setReportsLoading(true);
    const d = (v: any) => { try { return new Date(v).toLocaleDateString(); } catch { return ''; } };
    try {
      const [evals, team, games, scout, training] = await Promise.all([
        evalsAPI.recent().catch(() => []),
        evalsAPI.teamReports().catch(() => []),
        gameReportsAPI.list().catch(() => []),
        gameEvalAPI.listSessions().catch(() => []),
        trainingAPI.recent().catch(() => []),
      ]);
      const items = [
        ...(evals ?? []).map((e: any) => ({
          category: tr('conversation.categories.evals'), report_type: 'eval', report_id: e.id,
          report_title: `${e.player_name ?? tr('conversation.playerFallback')} · ${outputTypeLabel(e.output_type ?? '')}`,
          sub: d(e.created_at),
        })),
        ...(team ?? []).map((rep: any) => {
          const subject = reportSubject(rep.report_text ?? '', rep.output_type ?? '');
          return {
            category: tr('conversation.categories.teamReports'), report_type: 'team_report', report_id: rep.id,
            report_title: subject || outputTypeLabel(rep.output_type ?? '') || tr('conversation.teamReport'),
            sub: `${outputTypeLabel(rep.output_type ?? '') || tr('conversation.teamReport')} · ${d(rep.created_at)}`,
            report_text: rep.report_text,
          };
        }),
        ...(games ?? []).map((g: any) => ({
          category: tr('conversation.categories.gameReports'), report_type: 'game', report_id: g.id,
          report_title: g.title || (g.my_team_name ? `${g.my_team_name}${g.opponent_team_name ? ` ${tr('conversation.vsOpponent', { name: g.opponent_team_name })}` : ''}` : tr('conversation.gameReport')),
          sub: `${tr('conversation.gameReport')} · ${d(g.updated_at || g.created_at)}`,
          report_text: g.report_text,
        })),
        ...(scout ?? []).filter((g: any) => g.ai_scouting_report).map((g: any) => ({
          category: tr('conversation.categories.scoutReports'), report_type: 'scout', report_id: g.id,
          report_title: tr('conversation.vsOpponent', { name: g.opponent_name ?? tr('conversation.opponentFallback') }),
          sub: `${tr('conversation.scoutReport')} · ${d(g.date || g.created_at)}`,
          report_text: String(g.ai_scouting_report).replace(/\s*END OF REPORT\.?\s*$/i, ''),
        })),
        ...(training ?? []).map((ts: any) => ({
          category: tr('conversation.categories.training'), report_type: 'training', report_id: ts.id,
          report_title: tr('conversation.playerTraining', { name: ts.player_name ?? tr('conversation.playerFallback') }),
          sub: `${tr('conversation.trainingProgram')} · ${d(ts.created_at)}`,
          report_text: ts.program_text,
        })),
      ];
      setReportList(items);
    } catch { setReportList([]); }
    setReportsLoading(false);
  };

  const attachReport = async (r: any) => {
    let reportText = r.report_text;
    if (!reportText && r.report_type === 'eval') {
      try { const e = await evalsAPI.get(r.report_id); reportText = e.report_text; } catch {}
    }
    setPending(prev => [...prev, { kind: 'report', report_type: r.report_type, report_id: r.report_id, report_title: r.report_title, report_text: reportText || '' }]);
    setShowReportPicker(false);
  };

  const renderAttachment = (a: any, mine: boolean) => {
    if (a.kind === 'image' && a.data) {
      return <Image key={a.id ?? a.data.slice(-12)} source={{ uri: a.data }} style={styles.attImage} resizeMode="cover" />;
    }
    if (a.kind === 'audio' && a.data) {
      return (
        <TouchableOpacity key={a.id ?? 'aud'} style={styles.attAudio} onPress={() => playAudio(a.data)}>
          <Ionicons name="play" size={16} color={mine ? '#fff' : t.accent} />
          <Text style={[styles.attAudioText, mine && { color: '#fff' }]} numberOfLines={1}>{tr('conversation.voiceMessage')}</Text>
        </TouchableOpacity>
      );
    }
    // report
    const typeLabel = ({ eval: tr('conversation.playerEval'), team_report: tr('conversation.teamReport'), game: tr('conversation.gameReport'), scout: tr('conversation.scoutReport'), training: tr('conversation.trainingLabel') } as Record<string, string>)[a.report_type] || tr('conversation.report');
    const title = (a.report_title && String(a.report_title).trim()) || typeLabel;
    return (
      <TouchableOpacity key={a.id ?? a.report_id} style={styles.attReport} onPress={() => setReportView({ title, text: a.report_text || tr('conversation.noContent') })}>
        <View style={styles.attReportIcon}><Ionicons name="document-text" size={18} color="#fff" /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.attReportTitle} numberOfLines={2}>{title}</Text>
          <Text style={styles.attReportSub} numberOfLines={1}>{tr('conversation.tapToOpen', { type: typeLabel })}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={t.muted2} />
      </TouchableOpacity>
    );
  };

  return (
    <ScreenBackground>
    <PageContainer maxWidth={900}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ flexShrink: 0 }}>
          <Ionicons name="chevron-back" size={24} color={t.ink} />
        </TouchableOpacity>
        {/* Translated titles run 20-40% longer than English. Wrap to a second
            line rather than clipping — a truncated heading tells the coach
            less than a taller one costs them. */}
        <Text style={styles.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>{title}</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={t.accent} size="large" /></View>
        ) : (
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 12 }}>
            {messages.length === 0 && <Text style={styles.empty}>{tr('conversation.noMessagesYet')}</Text>}
            {messages.map(m => {
              const mine = m.sender_id === coach?.id;
              return (
                <View key={m.id} style={[styles.bubbleRow, mine ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    {isGroup && !mine && <Text style={styles.senderName}>{m.sender_name}</Text>}
                    {(m.attachments ?? []).map((a: any) => renderAttachment(a, mine))}
                    {!!m.text && <Text style={[styles.bubbleText, mine && { color: '#fff' }]}>{m.text}</Text>}
                    <Text style={[styles.bubbleTime, mine && { color: '#ffffffaa' }]}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Pending attachments */}
        {pending.length > 0 && (
          <ScrollView horizontal style={styles.pendingRow} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }} showsHorizontalScrollIndicator={false}>
            {pending.map((a, i) => (
              <View key={i} style={styles.pendingChip}>
                <Ionicons name={a.kind === 'image' ? 'image' : a.kind === 'audio' ? 'mic' : 'document-text'} size={13} color={t.accent} />
                <Text style={styles.pendingChipText} numberOfLines={1}>{a.report_title || a.name || a.kind}</Text>
                <TouchableOpacity onPress={() => setPending(prev => prev.filter((_, j) => j !== i))}>
                  <Ionicons name="close-circle" size={15} color={t.muted} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Composer */}
        <View style={styles.composer}>
          <TouchableOpacity style={styles.attachBtn} onPress={openReportPicker}><Ionicons name="document-attach-outline" size={20} color={t.muted} /></TouchableOpacity>
          <TouchableOpacity style={styles.attachBtn} onPress={() => pickImage(false)}><Ionicons name="image-outline" size={20} color={t.muted} /></TouchableOpacity>
          <TouchableOpacity style={styles.attachBtn} onPress={() => pickImage(true)}><Ionicons name="camera-outline" size={20} color={t.muted} /></TouchableOpacity>
          <TouchableOpacity style={styles.attachBtn} onPress={recording ? stopRec : startRec}>
            <Ionicons name={recording ? 'stop-circle' : 'mic-outline'} size={20} color={recording ? t.negative : t.muted} />
          </TouchableOpacity>
          <VoiceTextInput
            style={styles.input}
            placeholder={tr('conversation.messagePlaceholder')}
            placeholderTextColor={t.muted2}
            value={text}
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity style={styles.sendBtn} onPress={send} disabled={sending || (!text.trim() && pending.length === 0)}>
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Report picker */}
      <Modal visible={showReportPicker} transparent animationType="slide" onRequestClose={() => setShowReportPicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{tr('conversation.attachReport')}</Text>
              <TouchableOpacity style={{ flexShrink: 0 }} onPress={() => setShowReportPicker(false)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
            </View>
            <View style={styles.pickerSearch}>
              <Ionicons name="search" size={16} color={t.muted} />
              <VoiceTextInput
                style={styles.pickerSearchInput}
                placeholder={tr('conversation.searchReportsPlaceholder')}
                placeholderTextColor={t.muted2}
                value={reportSearch}
                onChangeText={setReportSearch}
              />
            </View>
            {reportsLoading ? <ActivityIndicator color={t.accent} style={{ marginVertical: 24 }} /> : (() => {
              const q = reportSearch.trim().toLowerCase();
              const filtered = reportList.filter(r => !q || `${r.report_title} ${r.sub} ${r.category}`.toLowerCase().includes(q));
              const cats = [tr('conversation.categories.evals'), tr('conversation.categories.teamReports'), tr('conversation.categories.gameReports'), tr('conversation.categories.scoutReports'), tr('conversation.categories.training')];
              return (
                <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
                  {filtered.length === 0 && <Text style={styles.empty}>{tr('conversation.noReportsFound')}</Text>}
                  {cats.map(cat => {
                    const rows = filtered.filter(r => r.category === cat);
                    if (!rows.length) return null;
                    return (
                      <View key={cat}>
                        <Text style={styles.catHeader} numberOfLines={1}>{cat}</Text>
                        {rows.map((r, i) => (
                          <TouchableOpacity key={`${r.report_type}-${r.report_id}-${i}`} style={styles.reportRow} onPress={() => attachReport(r)}>
                            <Ionicons name="document-text-outline" size={16} color={t.accent} />
                            <View style={{ flex: 1, flexShrink: 1, minWidth: 0 }}>
                              <Text style={styles.reportRowText} numberOfLines={1}>{r.report_title}</Text>
                              {!!r.sub && <Text style={styles.reportRowSub} numberOfLines={1}>{r.sub}</Text>}
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    );
                  })}
                </ScrollView>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Report reader */}
      <Modal visible={!!reportView} transparent animationType="slide" onRequestClose={() => setReportView(null)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { maxHeight: '85%' }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{reportView?.title}</Text>
              <TouchableOpacity style={{ flexShrink: 0 }} onPress={() => setReportView(null)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
            </View>
            <ScrollView>{reportView ? renderReport(reportView.text, { heading: t.ink, body: t.inkSoft }) : null}</ScrollView>
          </View>
        </View>
      </Modal>
    </PageContainer>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 56, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: t.divider },
  title: { color: t.ink, fontSize: 18, fontFamily: fonts[800], flex: 1, flexShrink: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: t.muted2, fontSize: 13, textAlign: 'center', marginVertical: 20 },
  bubbleRow: { flexDirection: 'row', marginBottom: 8 },
  bubble: { maxWidth: '80%', borderRadius: 16, padding: 10, paddingHorizontal: 13 },
  bubbleMine: { backgroundColor: t.accent, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, borderBottomLeftRadius: 4 },
  senderName: { color: t.accent, fontSize: 11, fontFamily: fonts[700], marginBottom: 3 },
  bubbleText: { color: t.inkSoft, fontSize: 14.5, lineHeight: 20 },
  bubbleTime: { color: t.muted2, fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  attImage: { width: 200, height: 150, borderRadius: 10, marginBottom: 6 },
  attAudio: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.chip, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6 },
  attAudioText: { color: t.inkSoft, fontSize: 13, fontFamily: fonts[600], flexShrink: 1 },
  attReport: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 6, borderWidth: 1, borderColor: t.cardBorder, width: 240, maxWidth: '100%' },
  attReportIcon: { width: 34, height: 34, borderRadius: 9, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  attReportTitle: { color: t.ink, fontSize: 13.5, fontFamily: fonts[700] },
  attReportSub: { color: t.muted, fontSize: 11, marginTop: 1 },
  pendingRow: { maxHeight: 44, paddingVertical: 6 },
  pendingChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: t.accent, maxWidth: 200 },
  pendingChipText: { color: t.accent, fontSize: 12, fontFamily: fonts[600], flexShrink: 1 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, paddingHorizontal: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.divider },
  attachBtn: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  input: { flex: 1, backgroundColor: t.chip, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, color: t.ink, fontSize: 14.5, borderWidth: 1, borderColor: t.line, maxHeight: 110, minHeight: 40 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    ...desktopOnly({ width: 44, height: 44, borderRadius: 10, backgroundColor: t.ctaBg }) },
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '70%', borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(560)},
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { color: t.ink, fontSize: 16, fontFamily: fonts[800], flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: t.divider },
  reportRowText: { color: t.inkSoft, fontSize: 14, fontFamily: fonts[600] },
  reportRowSub: { color: t.muted2, fontSize: 11, marginTop: 1 },
  catHeader: { color: t.label, fontSize: 10.5, fontFamily: fonts[800], letterSpacing: 1, textTransform: 'uppercase', marginTop: 14, marginBottom: 4 },
  pickerSearch: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.chip, borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: t.line, marginBottom: 6 },
  pickerSearchInput: { flex: 1, paddingVertical: 10, color: t.ink, fontSize: 14 },
});
