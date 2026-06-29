import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { mdToHtml, safeFileName, wrapPrintDocument } from '../utils/mdToHtml';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';

export default function SummaryScreen() {
  const { t } = useTheme();
  const styles = makeStyles(t);
  const markdownStyles = makeMarkdownStyles(t);
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { title, reportText, fileName: fileNameParam } = route.params as {
    title: string; reportText: string; fileName?: string;
  };

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const buildFileName = () => {
    const base = safeFileName(fileNameParam || title) || 'BIM Report';
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // Avoid double-stamping if the passed name already ends with a date
    return /\d{4}-\d{2}-\d{2}$/.test(base) ? base : `${base} - ${stamp}`;
  };

  const buildHtml = () =>
    wrapPrintDocument({ title, date: dateStr, bodyHtml: mdToHtml(reportText) });

  const exportPdf = async () => {
    try {
      const { uri } = await Print.printToFileAsync({ html: buildHtml() });
      const dest = FileSystem.cacheDirectory + buildFileName() + '.pdf';
      await FileSystem.copyAsync({ from: uri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: 'Share Summary' });
    } catch (e: any) {
      Alert.alert('Export Error', e?.message ?? 'Could not export');
    }
  };

  const printDoc = async () => {
    try {
      await Print.printAsync({ html: buildHtml() });
    } catch (e: any) {
      Alert.alert('Print Error', e?.message ?? 'Could not print');
    }
  };

  return (
    <ScreenBackground>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={t.ink} />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
        </View>

        <View style={styles.reportBox}>
          <Markdown style={markdownStyles}>{reportText}</Markdown>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={exportPdf}>
            <Ionicons name="share-outline" size={18} color={t.muted} />
            <Text style={styles.actionText}>Export PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={printDoc}>
            <Ionicons name="print-outline" size={18} color={t.muted} />
            <Text style={styles.actionText}>Print</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenBackground>
  );
}

const makeMarkdownStyles = (t: ThemeTokens) => ({
  body: { color: t.inkSoft, fontSize: 13, lineHeight: 22 },
  heading1: { color: t.ink, fontSize: 16, fontWeight: '800' as const, marginTop: 16, marginBottom: 4 },
  heading2: { color: t.ink, fontSize: 14, fontWeight: '700' as const, marginTop: 14, marginBottom: 4 },
  heading3: { color: t.muted, fontSize: 13, fontWeight: '700' as const, marginTop: 12, marginBottom: 2 },
  strong: { color: t.ink, fontWeight: '700' as const },
  bullet_list: { marginLeft: 8 },
  list_item: { color: t.inkSoft, fontSize: 13 },
});

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', alignItems: 'flex-start', padding: 20, paddingTop: 56, gap: 12 },
  title: { color: t.ink, fontSize: 18, fontWeight: '900', flex: 1 },
  reportBox: { backgroundColor: t.card, margin: 16, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: t.cardBorder },
  actionRow: { flexDirection: 'row', margin: 16, gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.line,
  },
  actionText: { color: t.muted, fontWeight: '600', fontSize: 13 },
});
