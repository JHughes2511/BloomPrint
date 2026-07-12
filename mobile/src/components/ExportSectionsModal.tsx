import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch, Modal, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { splitReportSections, joinReportSections, mdToHtml, wrapPrintDocument, safeFileName } from '../utils/mdToHtml';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

/**
 * ExportSectionsModal — pick which report sections to include, then Export (PDF)
 * or Print. The document header is pinned (always included); only real content
 * sections are toggleable, same as sharing.
 */
export type ExportSectionsModalProps = {
  visible: boolean;
  title: string;
  subject?: string;
  reportText: string;
  onClose: () => void;
};

export default function ExportSectionsModal({ visible, title, subject, reportText, onClose }: ExportSectionsModalProps) {
  const { t } = useTheme();
  const s = makeStyles(t);
  const sections = splitReportSections(reportText ?? '');
  const toggleSections = sections.filter(sec => !sec.pinned);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) setToggles(Object.fromEntries(splitReportSections(reportText ?? '').map(sec => [sec.heading, true])));
  }, [visible, reportText]);

  const filtered = () => joinReportSections(sections, toggles) || reportText;
  const html = () => wrapPrintDocument({
    title,
    subtitle: subject ?? '',
    date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    bodyHtml: mdToHtml(filtered()),
  });

  const doExport = async () => {
    setBusy(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: html() });
      const dest = (FileSystem.cacheDirectory ?? '') + `${safeFileName(title)}.pdf`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: title });
      onClose();
    } catch (e: any) { Alert.alert('Export Error', e?.message ?? 'Could not export'); }
    setBusy(false);
  };
  const doPrint = async () => {
    setBusy(true);
    try { await Print.printAsync({ html: html() }); onClose(); }
    catch (e: any) { Alert.alert('Print Error', e?.message ?? 'Could not print'); }
    setBusy(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.box}>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Export / Print</Text>
              <Text style={s.sub}>Choose the sections to include</Text>
            </View>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 340 }}>
            {toggleSections.length === 0 && <Text style={{ color: t.muted2, paddingVertical: 12 }}>This report has one section — it will export in full.</Text>}
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
            <TouchableOpacity style={s.secondaryBtn} onPress={doPrint} disabled={busy}>
              <Ionicons name="print-outline" size={16} color={t.ink} />
              <Text style={s.secondaryText}>Print</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.primaryBtn} onPress={doExport} disabled={busy}>
              {busy ? <ActivityIndicator color={t.ctaText} size="small" /> : (
                <><Ionicons name="download-outline" size={16} color={t.ctaText} /><Text style={s.primaryText}>Export PDF</Text></>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  box: { backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 30 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  title: { color: t.ink, fontSize: 18, fontFamily: fonts[800] },
  sub: { color: t.muted2, fontSize: 12, marginTop: 3 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.chip },
  rowLabel: { flex: 1, marginRight: 10, color: t.ink, fontSize: 14, fontFamily: fonts[600] },
  secondaryBtn: { flex: 1, flexDirection: 'row', gap: 6, borderRadius: 10, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.line, backgroundColor: t.card },
  secondaryText: { color: t.ink, fontFamily: fonts[700], fontSize: 14 },
  primaryBtn: { flex: 1.3, flexDirection: 'row', gap: 6, borderRadius: 10, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: t.ctaBg },
  primaryText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 14 },
});
