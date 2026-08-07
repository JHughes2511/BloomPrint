import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch, ActivityIndicator, Alert } from 'react-native';
import Sheet from './Sheet';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { splitReportSections } from '../utils/mdToHtml';
import { trainingAPI } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { sheetCap } from '../responsive/modalSizes';

/**
 * Choose what the player sees before a training program is sent.
 *
 * Sending used to hand the whole program over with no say in it, while every
 * other share in the app lets the coach switch sections off first. The sections
 * come from the program's own headings, the same split the export and share
 * sheets use, so the list always matches the document in front of the coach.
 */
export default function SendTrainingModal({
  visible, trainingId, playerName, programText, onClose, onSent, inline,
}: {
  visible: boolean;
  trainingId: number | null;
  playerName?: string;
  programText?: string | null;
  onClose: () => void;
  onSent?: (playerName?: string) => void;
  /**
   * Render as an overlay inside whatever is already on screen, rather than as
   * a modal of its own.
   *
   * Needed when this opens from a report the coach is reading: react-native-web
   * keeps one modal stack, and closing a modal that was opened on top of
   * another takes BOTH down — cancelling the picker dropped the coach back to
   * the profile, losing the report whose sections they were choosing.
   */
  inline?: boolean;
}) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const sections = splitReportSections(programText ?? '');
  const toggleSections = sections.filter(sec => !sec.pinned);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) setToggles(Object.fromEntries(sections.map(sec => [sec.heading, true])));
  }, [visible, programText]);   // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!trainingId) return;
    setBusy(true);
    try {
      // Only the headings the coach left on. An empty list means "everything",
      // which is also what a program with no headings at all sends.
      const off = toggleSections.filter(sec => toggles[sec.heading] === false).map(sec => sec.heading);
      const res = await trainingAPI.sendToPlayer(trainingId, off);
      onClose();
      onSent?.(res?.player_name ?? playerName);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('components.sendTraining.couldNotSend'));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <View style={[s.overlay, inline && s.inlineOverlay]}>
        <View style={s.box}>
          <View style={s.header}>
            <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
              <Text style={s.title} numberOfLines={1}>{tr('components.sendTraining.title')}</Text>
              <Text style={s.sub} numberOfLines={2}>
                {playerName
                  ? tr('components.sendTraining.subWithName', { name: playerName })
                  : tr('components.sendTraining.sub')}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ flexShrink: 0 }}>
              <Ionicons name="close" size={22} color={t.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 340 }}>
            {toggleSections.length === 0 && (
              <Text style={{ color: t.muted2, paddingVertical: 12 }}>{tr('components.sendTraining.oneSection')}</Text>
            )}
            {toggleSections.map((sec, i) => (
              <View key={`${sec.heading}-${i}`} style={s.row}>
                <Text style={s.rowLabel} numberOfLines={1}>{sec.heading}</Text>
                <Switch
                  value={toggles[sec.heading] !== false}
                  onValueChange={v => setToggles(p => ({ ...p, [sec.heading]: v }))}
                  trackColor={{ false: t.line, true: t.accent }} thumbColor="#fff"
                />
              </View>
            ))}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <TouchableOpacity style={s.secondaryBtn} onPress={onClose} disabled={busy}>
              <Text style={s.secondaryText} numberOfLines={1}>{tr('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.primaryBtn} onPress={send} disabled={busy || !trainingId}>
              {busy ? <ActivityIndicator color={t.ctaText} size="small" /> : (
                <>
                  <Ionicons name="paper-plane-outline" size={16} color={t.ctaText} />
                  <Text style={s.primaryText} numberOfLines={1}>{tr('components.sendTraining.send')}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
      </View>
    </View>
  );

  if (!visible) return null;
  if (inline) return body;
  return (
    <Sheet visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {body}
    </Sheet>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  // Covers the screen it is rendered into, instead of being its own modal.
  inlineOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 50 },
  box: { backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 30, ...sheetCap(560) },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  title: { color: t.ink, fontSize: 18, fontFamily: fonts[800] },
  sub: { color: t.muted2, fontSize: 12, marginTop: 3 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.chip },
  rowLabel: { flex: 1, marginRight: 10, color: t.ink, fontSize: 14, fontFamily: fonts[600] },
  secondaryBtn: { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.line, backgroundColor: t.card },
  secondaryText: { color: t.ink, fontFamily: fonts[700], fontSize: 14, flexShrink: 1 },
  primaryBtn: { flex: 1.3, flexDirection: 'row', gap: 6, borderRadius: 10, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: t.ctaBg },
  primaryText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 14, flexShrink: 1 },
});
