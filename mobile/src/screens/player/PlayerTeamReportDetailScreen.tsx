import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { playerReportsAPI } from '../../api/playerClient';
import { useTheme } from '../../theme/ThemeProvider';
import { topPad } from '../../responsive/screenPadding';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';
import PageContainer, { REPORT_MAX_WIDTH } from '../../responsive/PageContainer';

function cleanMarkdown(text: string): string {
  return text
    .split('\n')
    .map(line => {
      if (/^\s*\*{1,2}\s*$/.test(line)) return '';
      return line.replace(/\*\*\s*$/, '').replace(/^\s*\*\*\s*/, '');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function PlayerTeamReportDetailScreen() {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const markdownStyles = makeMarkdownStyles(t);
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { reportId } = route.params;
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    playerReportsAPI.listTeam()
      .then(list => {
        const found = list.find((r: any) => r.id === reportId);
        setReport(found ?? null);
      })
      .finally(() => setLoading(false));
  }, [reportId]);

  if (loading) {
    return (
      <ScreenBackground>
        <View style={styles.center}>
          <ActivityIndicator color={t.positive} size="large" />
        </View>
      </ScreenBackground>
    );
  }

  if (!report) {
    return (
      <ScreenBackground>
        <View style={styles.center}>
          <Text style={{ color: t.ink }}>{tr('playerApp.teamReportDetail.notFound')}</Text>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
    <PageContainer maxWidth={REPORT_MAX_WIDTH}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ flexShrink: 0 }}>
            <Ionicons name="chevron-back" size={24} color={t.ink} />
          </TouchableOpacity>
          {/* Long translated report types clip instead of wrapping the header. */}
          <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginLeft: 12, marginRight: 8 }}>
            <Text style={styles.title} numberOfLines={1}>
              {report.output_type.replace(/_/g, ' ').toUpperCase()}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {tr('playerApp.teamReportDetail.sharedBy', { name: report.shared_by_name || tr('playerApp.teamReportDetail.coachFallback'), date: new Date(report.created_at).toLocaleDateString() })}
            </Text>
          </View>
        </View>

        {report.message ? (
          <View style={styles.messageBox}>
            <Text style={styles.messageLabel} numberOfLines={1}>{tr('playerApp.teamReportDetail.coachMessage')}</Text>
            <Text style={styles.messageText}>{report.message}</Text>
          </View>
        ) : null}

        {report.report_text ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel} numberOfLines={1}>{tr('playerApp.teamReportDetail.teamReport')}</Text>
            <View style={styles.reportBox}>
              <Markdown style={markdownStyles}>{cleanMarkdown(report.report_text)}</Markdown>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </PageContainer>
    </ScreenBackground>
  );
}

const makeMarkdownStyles = (t: ThemeTokens) => ({
  body: { color: t.inkSoft, fontSize: 13, lineHeight: 22 },
  heading1: { color: t.ink, fontSize: 16, fontFamily: fonts[800], marginTop: 16, marginBottom: 4 },
  heading2: { color: t.ink, fontSize: 14, fontFamily: fonts[700], marginTop: 14, marginBottom: 4 },
  strong: { color: t.ink, fontFamily: fonts[700] },
  bullet_list: { marginLeft: 8 },
  list_item: { color: t.inkSoft, fontSize: 13 },
});

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: topPad(56) },
  title: { color: t.ink, fontSize: 16, fontFamily: fonts[900], flexShrink: 1 },
  sub: { color: t.muted, fontSize: 11, marginTop: 2, flexShrink: 1 },
  messageBox: {
    backgroundColor: t.positiveSoft,
    borderLeftWidth: 3,
    borderLeftColor: t.positive,
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
  },
  messageLabel: { color: t.positive, fontSize: 10, fontFamily: fonts[700], marginBottom: 4, textTransform: 'uppercase', flexShrink: 1 },
  messageText: { color: t.inkSoft, fontSize: 13 },
  section: { paddingHorizontal: 20, marginTop: 20 },
  sectionLabel: { color: t.label, fontSize: 11, fontFamily: fonts[700], letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  reportBox: { backgroundColor: t.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: t.cardBorder },
});
