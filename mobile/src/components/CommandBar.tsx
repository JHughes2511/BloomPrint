import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import VoiceTextInput from './VoiceTextInput';
import { assistantAPI } from '../api/client';
import { renderReport } from '../utils/renderReport';
import { GeneratingOverlay } from './GeneratingBasketball';
import { useTheme } from '../theme/ThemeProvider';
import i18n from '../i18n';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  navigate?: { screen: string; params?: any; label?: string } | null;
  pending?: any | null;
  ran?: boolean;
};

// Map the agent's logical screen name to an actual navigation call from the Home
// tab. For a screen nested in another tab's stack, seed the tab's ROOT first so
// the in-screen back button and tab re-tap return to that root (not to Home).
function goTo(navigation: any, target: { screen: string; params?: any; label?: string }) {
  const p = target.params || {};
  const key = String(target.screen || '').toLowerCase().replace(/[\s-]/g, '_');
  const deep = (tab: string, root: string, screen: string, params?: any) => {
    navigation.navigate(tab, { screen: root });
    setTimeout(() => navigation.navigate(tab, { screen, params }), 0);
  };
  try {
    switch (key) {
      case 'home':
        navigation.navigate('HomeTab', { screen: 'Home' }); break;
      case 'edit_profile':
      case 'profile':
      case 'settings':
        navigation.navigate('HomeTab', { screen: 'Home', params: { openEditProfile: true } }); break;
      case 'roster':
      case 'add_team':
      case 'create_team':
      case 'add_player':
      case 'new_player':
        navigation.navigate('RosterTab', { screen: 'Roster' }); break;
      case 'player':
      case 'player_profile':
        deep('RosterTab', 'Roster', 'PlayerProfile', { playerId: p.player_id }); break;
      case 'new_eval':
        deep('RosterTab', 'Roster', 'NewEval', { playerId: p.player_id, playerName: p.player_name }); break;
      case 'training':
        deep('RosterTab', 'Roster', 'Training', { playerId: p.player_id, evalId: p.eval_id }); break;
      case 'eval_report':
      case 'report':
        deep('RecentTab', 'Recent', 'EvalReport', { evalId: p.eval_id, openShare: p.share }); break;
      // Team Grade tab = tracking games, stats, season dashboard, scouting,
      // whiteboard. Deep-link straight to the promised view/modal.
      case 'team_grade':
      case 'dashboard':
      case 'season':
        navigation.navigate('TeamEvalTab', { screen: 'TeamEval', params: { openView: 'dashboard' } }); break;
      case 'games':
      case 'game':
        navigation.navigate('TeamEvalTab', { screen: 'TeamEval', params: { openView: 'games' } }); break;
      case 'track_game':
      case 'new_game':
        navigation.navigate('TeamEvalTab', { screen: 'TeamEval', params: { openNewGame: true } }); break;
      case 'scout':
      case 'scouting':
        navigation.navigate('TeamEvalTab', { screen: 'TeamEval', params: { openView: 'scout' } }); break;
      case 'game_report_view':
        navigation.navigate('TeamEvalTab', { screen: 'TeamEval', params: { openView: 'gamereport' } }); break;
      case 'whiteboard':
        navigation.navigate('TeamEvalTab', { screen: 'TeamEval', params: { openPlaybook: true } }); break;
      case 'game_detail':
        navigation.navigate('TeamEvalTab', { screen: 'TeamEval', params: { openGameId: p.game_id } }); break;
      // Team Eval tab = report packets / team reports / film catalog.
      case 'team_eval':
      case 'team_report':
      case 'packet':
        if (p.report_id != null) deep('TeamTab', 'Team', 'GameReportBuilder', { reportId: p.report_id });
        else navigation.navigate('TeamTab', { screen: 'Team' }); break;
      case 'game_report_builder':
        deep('TeamTab', 'Team', 'GameReportBuilder', { reportId: p.report_id }); break;
      case 'recent':
      case 'reports':
        navigation.navigate('RecentTab', { screen: 'Recent' }); break;
      case 'import':
        deep('RosterTab', 'Roster', 'Import', { mode: 'roster' }); break;
      case 'staff_inbox':
      case 'inbox':
      case 'staff':
      case 'messages':
      case 'message':
      case 'staff_messages':
        deep('HomeTab', 'Home', 'StaffInbox'); break;
      case 'conversation':
        if (p.conversation_id != null) deep('HomeTab', 'Home', 'Conversation', { conversationId: p.conversation_id });
        else deep('HomeTab', 'Home', 'StaffInbox');
        break;
      case 'feedback':
        navigation.navigate('HomeTab', { screen: 'Home', params: { openFeedback: true } }); break;
      case 'notifications':
      case 'alerts':
        deep('HomeTab', 'Home', 'CoachNotifications'); break;
      default:
        // Unknown target — send to Home rather than a wrong screen.
        navigation.navigate('HomeTab', { screen: 'Home' });
    }
  } catch {
    Alert.alert(i18n.t('copilot.couldNotOpenTitle'), i18n.t('copilot.couldNotOpenMsg'));
  }
}

/**
 * Renders its own trigger pill by default. The sidebar already has an "Ask
 * BloomPrint" row, so it drives this in controlled mode instead: without that,
 * nesting the component inside another modal meant clicking the sidebar opened
 * a sheet showing the pill, which you then had to click a second time to reach
 * the chat.
 */
type Props = {
  /** Controlled visibility. Omit for the standalone pill-and-sheet behaviour. */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  /** Hide the pill when something else is the entry point. */
  hideTrigger?: boolean;
};

export default function CommandBar({ open: openProp, onOpenChange, hideTrigger }: Props = {}) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const navigation = useNavigation<any>();
  const [openSelf, setOpenSelf] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp! : openSelf;
  const setOpen = (next: boolean) => {
    if (!controlled) setOpenSelf(next);
    onOpenChange?.(next);
  };
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [runningIdx, setRunningIdx] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const pinToEnd = (animated = true) => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated }));
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated }), 120);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated }), 320);
  };

  // Keep the tail of the conversation visible while typing: when the keyboard
  // slides up it covers the newest messages, so re-pin the scroll to the end.
  // Listen to BOTH will/did so it lands whether or not the frame is settled.
  useEffect(() => {
    if (!open) return;
    const subs = ['keyboardWillShow', 'keyboardDidShow', 'keyboardWillChangeFrame']
      .map(evt => Keyboard.addListener(evt as any, () => pinToEnd(true)));
    return () => subs.forEach(s => s.remove());
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setBusy(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    try {
      const res = await assistantAPI.ask(text, history);
      setMessages(prev => [...prev, {
        role: 'assistant', content: res.reply || '…',
        navigate: res.navigate || null, pending: res.pending_action || null,
      }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: e?.response?.data?.detail ?? tr('copilot.errorTryAgain') }]);
    } finally {
      setBusy(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  const runPending = async (idx: number, action: any) => {
    setBusy(true);
    setRunningIdx(idx);
    try {
      const res = await assistantAPI.confirm(action);
      setMessages(prev => prev.map((m, i) => i === idx ? { ...m, ran: true } : m).concat([{
        role: 'assistant', content: res.message || tr('copilot.done'), navigate: res.navigate || null,
      }]));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('copilot.couldNotComplete'));
    } finally {
      setBusy(false);
      setRunningIdx(null);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  return (
    <>
      {/* Collapsed command bar — compact pill */}
      {!hideTrigger && (
        <TouchableOpacity style={s.bar} onPress={() => setOpen(true)} activeOpacity={0.8}>
          <Ionicons name="sparkles" size={14} color={t.accent} />
          <Text style={s.barText}>{tr('copilot.askBloomPrint')}</Text>
        </TouchableOpacity>
      )}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <View style={s.header}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="sparkles" size={18} color={t.accent} />
                <Text style={s.title}>{tr('copilot.askBloomPrint')}</Text>
              </View>
              <TouchableOpacity onPress={() => setOpen(false)}><Ionicons name="close" size={24} color={t.muted} /></TouchableOpacity>
            </View>

            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
              onContentSizeChange={() => { if (messages.length) pinToEnd(true); }}
              keyboardShouldPersistTaps="handled"
            >
              {messages.length === 0 && (
                <View style={{ paddingVertical: 24 }}>
                  <Text style={s.emptyTitle}>{tr('copilot.emptyTitle')}</Text>
                  {(tr('copilot.examples', { returnObjects: true }) as string[]).map(ex => (
                    <TouchableOpacity key={ex} style={s.exChip} onPress={() => setInput(ex)}>
                      <Text style={s.exText}>{ex}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {messages.map((m, i) => (
                <View key={i} style={{ marginBottom: 14, alignItems: m.role === 'user' ? 'flex-end' : 'stretch' }}>
                  {m.role === 'user' ? (
                    <View style={s.userBubble}><Text style={s.userText}>{m.content}</Text></View>
                  ) : (
                    <View style={s.aiBubble}>
                      {renderReport(m.content, { heading: t.ink, body: t.inkSoft })}
                      {m.navigate && (
                        <TouchableOpacity style={s.navBtn} onPress={() => { goTo(navigation, m.navigate!); setOpen(false); }}>
                          <Ionicons name="open-outline" size={15} color={t.ctaText} />
                          <Text style={s.navBtnText}>{m.navigate.label || tr('copilot.takeMeThere')}</Text>
                        </TouchableOpacity>
                      )}
                      {m.pending && !m.ran && (
                        <View style={s.confirmCard}>
                          <Text style={s.confirmText}>{m.pending.description || tr('copilot.generateThis')}</Text>
                          {runningIdx === i ? (
                            <View style={{ marginTop: 12 }}>
                              <GeneratingOverlay visible label={tr('copilot.generatingReport')} />
                            </View>
                          ) : (
                            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                              <TouchableOpacity style={s.confirmNo} onPress={() => setMessages(prev => prev.map((x, xi) => xi === i ? { ...x, ran: true } : x))} disabled={busy}>
                                <Text style={s.confirmNoText}>{tr('common.cancel')}</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={s.confirmYes} onPress={() => runPending(i, m.pending)} disabled={busy}>
                                <Ionicons name={m.pending.kind === 'send_staff_message' ? 'send' : 'sparkles'} size={14} color={t.ctaText} />
                                <Text style={s.confirmYesText}>{m.pending.kind === 'send_staff_message' ? tr('common.send') : tr('common.generate')}</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              ))}
              {busy && runningIdx === null && <ActivityIndicator color={t.accent} style={{ marginVertical: 12 }} />}
            </ScrollView>

            <View style={s.inputRow}>
              <VoiceTextInput
                style={s.input}
                placeholder={tr('copilot.inputPlaceholder')}
                placeholderTextColor={t.muted2}
                value={input}
                onChangeText={setInput}
                multiline
              />
              <TouchableOpacity style={[s.sendBtn, (!input.trim() || busy) && { opacity: 0.5 }]} onPress={send} disabled={!input.trim() || busy}>
                <Ionicons name="arrow-up" size={20} color={t.ctaText} />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', backgroundColor: t.card, borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  barText: { color: t.muted, fontSize: 12.5, fontFamily: fonts[700] },
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '90%', width: '100%', maxWidth: 560, alignSelf: 'center'},
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: t.chip },
  title: { color: t.ink, fontSize: 17, fontFamily: fonts[800] },
  emptyTitle: { color: t.muted, fontSize: 13, fontFamily: fonts[700], marginBottom: 12 },
  exChip: { backgroundColor: t.card, borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 12, marginBottom: 8 },
  exText: { color: t.inkSoft, fontSize: 13 },
  userBubble: { backgroundColor: t.ctaBg, borderRadius: 14, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '85%' },
  userText: { color: t.ctaText, fontSize: 14 },
  aiBubble: { backgroundColor: t.card, borderWidth: 1, borderColor: t.chip, borderRadius: 14, borderBottomLeftRadius: 4, paddingHorizontal: 14, paddingVertical: 10, alignSelf: 'stretch' },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: t.ctaBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginTop: 10 },
  navBtnText: { color: t.ctaText, fontSize: 13, fontFamily: fonts[700] },
  confirmCard: { backgroundColor: t.accentSoft, borderRadius: 10, padding: 12, marginTop: 10 },
  confirmText: { color: t.ink, fontSize: 13 },
  confirmNo: { flex: 1, backgroundColor: t.chip, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  confirmNoText: { color: t.muted, fontFamily: fonts[700], fontSize: 13 },
  confirmYes: { flex: 1.4, flexDirection: 'row', gap: 5, backgroundColor: t.ctaBg, borderRadius: 8, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  confirmYesText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 30 : 14, borderTopWidth: 1, borderTopColor: t.chip },
  input: { flex: 1, backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.line, paddingHorizontal: 14, paddingVertical: 10, color: t.ink, fontSize: 14, maxHeight: 120 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: t.ctaBg, alignItems: 'center', justifyContent: 'center' },
});
