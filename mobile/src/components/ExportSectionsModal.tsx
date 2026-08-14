import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch, Modal, ActivityIndicator, Alert } from 'react-native';
import Sheet from './Sheet';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { splitReportSections } from '../utils/mdToHtml';
import { exportReportPdf, printReport } from '../utils/exportDoc';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { sheetCap } from '../responsive/modalSizes';

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
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const sections = splitReportSections(reportText ?? '');
  // Kept BY POSITION, not by heading. A report can carry the same heading more
  // than once — a film breakdown has a "SEGMENT 1 NOTES" per segment — and
  // keying on the text made those one switch: flipping any of them flipped all
  // of them, and what came out did not match what was ticked.
  const [on, setOn] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) setOn(splitReportSections(reportText ?? '').map(() => true));
  }, [visible, reportText]);

  // A heading that appears more than once is numbered on screen, so the coach
  // can tell which switch belongs to which part of the report.
  const labelFor = (i: number) => {
    const h = sections[i].heading;
    const same = sections.map((s, j) => (s.heading === h ? j : -1)).filter(j => j >= 0);
    return same.length > 1 ? `${h} (${same.indexOf(i) + 1} of ${same.length})` : h;
  };

  const filtered = () =>
    sections
      .filter((sec, i) => sec.pinned || on[i] !== false)
      .map(sec => (sec.heading === 'Overview' || sec.heading === 'Report'
        ? sec.body : `## ${sec.heading}\n${sec.body}`))
      .join('\n\n')
      .trim() || reportText;

  const doc = () => ({ title, subtitle: subject, text: filtered() });

  const doExport = async () => {
    setBusy(true);
    try {
      await exportReportPdf(doc());
      onClose();
    } catch (e: any) {
      Alert.alert(tr('components.exportSections.exportErrorTitle'),
                  e?.response?.data?.detail ?? e?.message ?? tr('components.exportSections.couldNotExport'));
    }
    setBusy(false);
  };
  const doPrint = async () => {
    setBusy(true);
    try { await printReport(doc()); onClose(); }
    catch (e: any) {
      Alert.alert(tr('components.exportSections.printErrorTitle'),
                  e?.message ?? tr('components.exportSections.couldNotPrint'));
    }
    setBusy(false);
  };

  return (
    <Sheet visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.box}>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{tr('components.exportSections.exportPrint')}</Text>
              <Text style={s.sub}>{tr('components.exportSections.chooseSections')}</Text>
            </View>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 340 }}>
            {sections.every(sec => sec.pinned) && <Text style={{ color: t.muted2, paddingVertical: 12 }}>{tr('components.exportSections.oneSection')}</Text>}
            {sections.map((sec, i) => (sec.pinned ? null : (
              <View key={i} style={s.row}>
                <Text style={s.rowLabel} numberOfLines={1}>{labelFor(i)}</Text>
                <Switch
                  value={on[i] !== false}
                  onValueChange={v => setOn(p => { const next = p.slice(); next[i] = v; return next; })}
                  trackColor={{ false: t.line, true: t.accent }} thumbColor="#fff"
                />
              </View>
            )))}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <TouchableOpacity style={s.secondaryBtn} onPress={doPrint} disabled={busy}>
              <Ionicons name="print-outline" size={16} color={t.ink} />
              <Text style={s.secondaryText}>{tr('common.print')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.primaryBtn} onPress={doExport} disabled={busy}>
              {busy ? <ActivityIndicator color={t.ctaText} size="small" /> : (
                <><Ionicons name="download-outline" size={16} color={t.ctaText} /><Text style={s.primaryText}>{tr('components.exportSections.exportPdf')}</Text></>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Sheet>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  box: { backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 30, ...sheetCap(560)},
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
