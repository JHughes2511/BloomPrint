import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import Sheet from './Sheet';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useReportTranslation } from '../hooks/useReportTranslation';
import TranslationToggle from './TranslationToggle';
import VoiceTextInput from './VoiceTextInput';
import KeyboardAwareScrollView from './KeyboardAwareScrollView';
import { staffSharingAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { renderReport } from '../utils/renderReport';
import { GeneratingOverlay } from './GeneratingBasketball';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { CONTENT_MAX_WIDTH, sheetCap, REPORT_MODAL_WIDTH } from '../responsive/modalSizes';

type BottomTab = 'correct' | 'comments' | 'notes';

export type SharedReportViewerProps = {
  shared: any | null;         // StaffSharedReportOut
  visible: boolean;
  onClose: () => void;
  onChanged?: () => void;     // called after a regenerate so lists can refresh
};

export default function SharedReportViewer({ shared, visible, onClose, onChanged }: SharedReportViewerProps) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { coach } = useAuth();
  const styles = makeStyles(t);

  // Per-report-type display labels, translated with an English fallback.
  const typeLabelFor = (rt: string) => tr(`components.viewer.typeLabels.${rt}`, { defaultValue: rt });
  const updatedLabelFor = (rt: string) => tr(`components.viewer.updatedLabels.${rt}`, { defaultValue: tr('components.viewer.updatedReportFallback') });

  const [item, setItem] = useState<any | null>(shared);
  const [bodyMode, setBodyMode] = useState<'original' | 'updated'>('original');
  const [bottomTab, setBottomTab] = useState<BottomTab>('comments');
  const [comments, setComments] = useState<any[]>([]);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [commentText, setCommentText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [correctText, setCorrectText] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [busy, setBusy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // The recipient can correct/regenerate; the original sharer (viewing their
  // sent copy) gets view + comments/notes only.
  const isRecipient = item?.recipient_id == null || item?.recipient_id === coach?.id;
  const canRegen = isRecipient && !!item?.allow_regenerate;

  useEffect(() => {
    if (visible && shared) {
      setItem(shared);
      const amRecipient = shared.recipient_id == null || shared.recipient_id === coach?.id;
      setBodyMode(amRecipient && shared.regenerated_text ? 'updated' : 'original');
      setBottomTab(amRecipient && shared.allow_regenerate ? 'correct' : 'comments');
      setCommentText(''); setNoteText(''); setCorrectText('');
      staffSharingAPI.getComments(shared.id).then(setComments).catch(() => setComments([]));
      if (amRecipient && shared.allow_regenerate) {
        staffSharingAPI.listCorrections(shared.id).then(setCorrections).catch(() => setCorrections([]));
      } else {
        setCorrections([]);
      }
    }
  }, [visible, shared]);

  // Computed with optional access so the hook below can run on EVERY render —
  // it must sit above the `if (!item)` return or the hook count changes between
  // renders and React throws "Rendered more hooks than during the previous render".
  const bodyText = bodyMode === 'updated'
    ? (item?.regenerated_text ?? item?.report_text ?? '')
    : (item?.report_text ?? '');
  // A shared report is the most likely place to hit another language: translate
  // on view, keeping a toggle back to what the sharer actually wrote.
  const rt = useReportTranslation('shared', item?.id, bodyText || undefined);

  if (!item) return null;

  const pendingCount = corrections.filter(c => !c.applied).length;
  // Comments/notes are tied to the Original vs Updated version you're viewing.
  const isNote = (c: any) => String(c.text).startsWith('[Coach Note]');
  const underCurrent = (c: any) => (c.target ?? 'original') === bodyMode;

  const submitComment = async () => {
    if (!commentText.trim()) return;
    setBusy(true);
    try {
      await staffSharingAPI.addComment(item.id, commentText.trim(), bodyMode);
      setComments(await staffSharingAPI.getComments(item.id));
      setCommentText('');
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('components.viewer.couldNotAddComment'));
    }
    setBusy(false);
  };

  const saveNote = async () => {
    if (!noteText.trim()) return;
    setBusy(true);
    try {
      await staffSharingAPI.addComment(item.id, `[Coach Note] ${noteText.trim()}`, bodyMode);
      setComments(await staffSharingAPI.getComments(item.id));
      setNoteText('');
      Alert.alert(tr('components.viewer.saved'), tr('components.viewer.noteSaved'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('components.viewer.couldNotSaveNote'));
    }
    setBusy(false);
  };

  const applyCorrection = async () => {
    if (!correctText.trim()) return;
    setBusy(true);
    try {
      await staffSharingAPI.addCorrection(item.id, correctText.trim());
      setCorrections(await staffSharingAPI.listCorrections(item.id));
      setCorrectText('');
      Alert.alert(tr('components.viewer.saved'), tr('components.viewer.correctionSaved'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('components.viewer.couldNotSaveCorrection'));
    }
    setBusy(false);
  };

  const saveEditedCorrection = async (id: number) => {
    if (!editingText.trim()) return;
    setBusy(true);
    try {
      await staffSharingAPI.editCorrection(id, editingText.trim());
      setCorrections(await staffSharingAPI.listCorrections(item.id));
      setEditingId(null); setEditingText('');
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('components.viewer.couldNotEditCorrection'));
    }
    setBusy(false);
  };

  const deleteCorrection = (id: number) => {
    Alert.alert(tr('components.viewer.deleteCorrectionTitle'), tr('components.viewer.deleteCorrectionMsg'), [
      { text: tr('common.cancel'), style: 'cancel' },
      { text: tr('common.delete'), style: 'destructive', onPress: async () => {
        try {
          await staffSharingAPI.deleteCorrection(id);
          setCorrections(await staffSharingAPI.listCorrections(item.id));
        } catch (e: any) {
          Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('components.viewer.couldNotDelete'));
        }
      } },
    ]);
  };

  const applyAndRegenerate = async () => {
    setRegenerating(true);
    try {
      const updated = await staffSharingAPI.regenerateMine(item.id, correctText.trim() || undefined);
      setItem(updated);
      setCorrections(await staffSharingAPI.listCorrections(item.id));
      setCorrectText('');
      setBodyMode('updated');
      onChanged?.();
      Alert.alert(tr('components.viewer.updatedTitle'), tr('components.viewer.updatedSavedMsg', { label: updatedLabelFor(item.report_type) }));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('components.viewer.couldNotRegenerate'));
    }
    setRegenerating(false);
  };

  // Only the recipient sees their own updated version; the sharer sees the
  // original + comments/notes until the recipient approves a request.
  const hasUpdated = isRecipient && !!item.regenerated_text;
  const updatedLabel = updatedLabelFor(item.report_type);

  return (
    <Sheet visible={visible} animationType="slide" transparent onRequestClose={() => onClose()}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.box}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.subject_name || typeLabelFor(item.report_type) || tr('components.viewer.reportFallback')}</Text>
              <Text style={styles.sub}>{tr('components.viewer.fromSender', { type: typeLabelFor(item.report_type), sender: item.sender_name })}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={t.muted} />
            </TouchableOpacity>
          </View>

          {/* Body-version chips */}
          <View style={styles.chipRow}>
            <TouchableOpacity style={[styles.chip, bodyMode === 'original' && styles.chipActive]} onPress={() => setBodyMode('original')}>
              <Text style={[styles.chipText, bodyMode === 'original' && styles.chipTextActive]}>{tr('components.viewer.original')}</Text>
            </TouchableOpacity>
            {hasUpdated && (
              <TouchableOpacity style={[styles.chip, bodyMode === 'updated' && styles.chipActive]} onPress={() => setBodyMode('updated')}>
                <Text style={[styles.chipText, bodyMode === 'updated' && styles.chipTextActive]}>{updatedLabel}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Report body — always visible + scrollable */}
          <View style={styles.bodyWrap}>
            <KeyboardAwareScrollView contentContainerStyle={styles.bodyContent}>
              {bodyText ? (
                <>
                  <TranslationToggle
                    canToggle={rt.canToggle} isTranslated={rt.isTranslated}
                    showOriginal={rt.showOriginal} loading={rt.loading} onToggle={rt.toggle}
                  />
                  {renderReport(rt.text, { heading: t.ink, body: t.inkSoft })}
                </>
              ) : <Text style={{ color: t.muted2 }}>{tr('components.viewer.noContent')}</Text>}
            </KeyboardAwareScrollView>
          </View>

          {/* Bottom action panel — report stays visible above */}
          <View style={styles.bottomPanel}>
            <View style={styles.bottomTabs}>
              {canRegen && (
                <TouchableOpacity style={[styles.bottomTab, bottomTab === 'correct' && styles.bottomTabActive]} onPress={() => setBottomTab('correct')}>
                  <Text style={[styles.bottomTabText, bottomTab === 'correct' && styles.bottomTabTextActive]}>
                    {tr('components.viewer.correctionsTab', { count: corrections.length })}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.bottomTab, bottomTab === 'comments' && styles.bottomTabActive]} onPress={() => setBottomTab('comments')}>
                <Text style={[styles.bottomTabText, bottomTab === 'comments' && styles.bottomTabTextActive]}>{tr('components.viewer.commentsTab', { count: comments.filter(c => !isNote(c) && underCurrent(c)).length })}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.bottomTab, bottomTab === 'notes' && styles.bottomTabActive]} onPress={() => setBottomTab('notes')}>
                <Text style={[styles.bottomTabText, bottomTab === 'notes' && styles.bottomTabTextActive]}>{tr('components.viewer.notesTab', { count: comments.filter(c => isNote(c) && underCurrent(c)).length })}</Text>
              </TouchableOpacity>
            </View>

            {bottomTab === 'correct' && canRegen && (
              <View>
                {/* Saved corrections — edit / delete the un-applied ones */}
                {corrections.length > 0 && (
                  <ScrollView style={{ maxHeight: 130, marginBottom: 8 }}>
                    {corrections.map((c: any) => (
                      <View key={c.id} style={styles.corrRow}>
                        {editingId === c.id ? (
                          <>
                            <VoiceTextInput
                              style={[styles.input, { flex: 1, minHeight: 40 }]}
                              value={editingText}
                              onChangeText={setEditingText}
                              multiline
                            />
                            <TouchableOpacity style={styles.corrIcon} onPress={() => saveEditedCorrection(c.id)} disabled={busy}>
                              <Ionicons name="checkmark" size={18} color={t.positive} />
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.corrIcon} onPress={() => { setEditingId(null); setEditingText(''); }}>
                              <Ionicons name="close" size={18} color={t.muted} />
                            </TouchableOpacity>
                          </>
                        ) : (
                          <>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.corrText, c.applied && { color: t.muted2 }]}>{c.correction}</Text>
                              {c.applied && <Text style={styles.corrApplied}>{tr('components.viewer.applied')}</Text>}
                            </View>
                            {!c.applied && (
                              <>
                                <TouchableOpacity style={styles.corrIcon} onPress={() => { setEditingId(c.id); setEditingText(c.correction); }}>
                                  <Ionicons name="create-outline" size={16} color={t.accent} />
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.corrIcon} onPress={() => deleteCorrection(c.id)}>
                                  <Ionicons name="trash-outline" size={16} color={t.negative} />
                                </TouchableOpacity>
                              </>
                            )}
                          </>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                )}
                <VoiceTextInput
                  style={styles.input}
                  placeholder={tr('components.viewer.correctPlaceholder')}
                  placeholderTextColor={t.muted2}
                  value={correctText}
                  onChangeText={setCorrectText}
                  multiline
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity
                    style={[styles.secondaryBtn, (!correctText.trim() || busy) && { opacity: 0.5 }]}
                    onPress={applyCorrection}
                    disabled={!correctText.trim() || busy}
                  >
                    <Text style={styles.secondaryBtnText}>{tr('components.viewer.saveCorrections')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryBtn, ((pendingCount === 0 && !correctText.trim()) || regenerating) && { opacity: 0.5 }]}
                    onPress={applyAndRegenerate}
                    disabled={(pendingCount === 0 && !correctText.trim()) || regenerating}
                  >
                    <Ionicons name="sparkles-outline" size={14} color={t.ctaText} />
                    <Text style={styles.primaryBtnText}>{tr('components.viewer.applyRegenerate')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {bottomTab === 'comments' && (
              <View>
                <Text style={styles.scopeHint}>{tr('components.viewer.commentsOn', { version: bodyMode === 'updated' ? updatedLabel : tr('components.viewer.original') })}</Text>
                <ScrollView style={{ maxHeight: 120 }}>
                  {comments.filter(c => !isNote(c) && underCurrent(c)).length === 0 && (
                    <Text style={styles.empty}>{tr('components.viewer.noCommentsYet')}</Text>
                  )}
                  {comments.filter(c => !isNote(c) && underCurrent(c)).map((c: any) => (
                    <View key={c.id} style={styles.commentCard}>
                      <Text style={styles.commentAuthor}>{c.author_name}</Text>
                      <Text style={styles.commentText}>{c.text}</Text>
                    </View>
                  ))}
                </ScrollView>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <VoiceTextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder={tr('components.viewer.addCommentPlaceholder')}
                    placeholderTextColor={t.muted2}
                    value={commentText}
                    onChangeText={setCommentText}
                    multiline
                  />
                  <TouchableOpacity style={styles.sendBtn} onPress={submitComment} disabled={busy || !commentText.trim()}>
                    {busy ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="send" size={18} color={t.ctaText} />}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {bottomTab === 'notes' && (
              <View>
                <Text style={styles.scopeHint}>{tr('components.viewer.notesOn', { version: bodyMode === 'updated' ? updatedLabel : tr('components.viewer.original') })}</Text>
                <ScrollView style={{ maxHeight: 100 }}>
                  {comments.filter(c => isNote(c) && underCurrent(c)).length === 0 && (
                    <Text style={styles.empty}>{tr('components.viewer.noNotesYet')}</Text>
                  )}
                  {comments.filter(c => isNote(c) && underCurrent(c)).map((c: any) => (
                    <View key={c.id} style={styles.commentCard}>
                      <Text style={styles.commentText}>{String(c.text).replace('[Coach Note] ', '')}</Text>
                    </View>
                  ))}
                </ScrollView>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <VoiceTextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder={tr('components.viewer.addNotePlaceholder')}
                    placeholderTextColor={t.muted2}
                    value={noteText}
                    onChangeText={setNoteText}
                    multiline
                  />
                  <TouchableOpacity style={[styles.sendBtn, { backgroundColor: t.positive }]} onPress={saveNote} disabled={busy || !noteText.trim()}>
                    {busy ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="bookmark" size={18} color={t.ctaText} />}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          <GeneratingOverlay visible={regenerating} label={tr('components.viewer.buildingUpdated')} />
        </View>
      </KeyboardAvoidingView>
    </Sheet>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  box: { backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20, height: '90%', ...sheetCap(REPORT_MODAL_WIDTH)},
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  title: { color: t.ink, fontSize: 18, fontFamily: fonts[800] },
  sub: { color: t.muted2, fontSize: 12, marginTop: 4 },
  chipRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  chip: { alignSelf: 'flex-start', height: 34, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: t.line, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: t.accentSoft, borderColor: t.accent },
  chipText: { color: t.muted, fontSize: 13, fontFamily: fonts[600] },
  chipTextActive: { color: t.accent, fontFamily: fonts[700] },
  bodyWrap: { flex: 1, marginTop: 10 },
  bodyContent: { paddingHorizontal: 16, paddingBottom: 16 },
  bottomPanel: { borderTopWidth: 1, borderTopColor: t.line, paddingTop: 10, marginTop: 6 },
  bottomTabs: { flexDirection: 'row', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  bottomTab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: t.line, backgroundColor: t.chip },
  bottomTabActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  bottomTabText: { color: t.muted, fontSize: 12, fontFamily: fonts[600], lineHeight: 16 },
  bottomTabTextActive: { color: t.ctaText, fontFamily: fonts[700] },
  input: { backgroundColor: t.card, borderRadius: 10, padding: 12, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 44, maxHeight: 120 },
  secondaryBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.accent, backgroundColor: t.accentSoft },
  secondaryBtnText: { color: t.accent, fontFamily: fonts[700], fontSize: 13 },
  primaryBtn: { flex: 1, flexDirection: 'row', gap: 6, borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.ctaBg },
  primaryBtnText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 13 },
  sendBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: t.ctaBg, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
  hint: { color: t.muted2, fontSize: 11, marginTop: 8 },
  scopeHint: { color: t.accent, fontSize: 10, fontFamily: fonts[700], letterSpacing: 0.5, marginBottom: 6 },
  corrRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.chip, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6 },
  corrText: { color: t.inkSoft, fontSize: 13 },
  corrApplied: { color: t.positive, fontSize: 10, fontFamily: fonts[700], marginTop: 2 },
  corrIcon: { padding: 4 },
  empty: { color: t.muted2, textAlign: 'center', paddingVertical: 16, fontSize: 13 },
  commentCard: { backgroundColor: t.chip, borderRadius: 10, padding: 10, marginBottom: 6 },
  commentAuthor: { color: t.accent, fontSize: 11, fontFamily: fonts[700], marginBottom: 2 },
  commentText: { color: t.inkSoft, fontSize: 13 },
});
