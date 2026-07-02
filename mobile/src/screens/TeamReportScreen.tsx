import React, { useState, useEffect } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { evalsAPI, teamsAPI, playerAPI, gameReportsAPI, staffSharingAPI, coachesAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { mdToHtml, safeFileName, splitReportSections, joinReportSections } from '../utils/mdToHtml';
import { buildReportHtml, buildPdfFileName } from '../utils/buildReportPdf';
import { useFocusEffect } from '@react-navigation/native';
import { renderReport } from '../utils/renderReport';
import { outputTypeLabel } from '../utils/reportType';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';

const OUTPUT_TYPES = [
  { key: 'coaching_report',  label: 'Coaching Report' },
  { key: 'game_analysis',    label: 'Game Analysis' },
  { key: 'game_situational', label: 'Game Situational' },
  { key: 'film_breakdown',   label: 'Film Breakdown' },
  { key: 'scouting_report',  label: 'Scouting Report' },
  { key: 'training_program', label: 'Training Program' },
  { key: 'box_score',        label: 'Box Score' },
];

export default function TeamReportScreen() {
  const { coach } = useAuth();
  const navigation = useNavigation<any>();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const shareStyles = makeShareStyles(t);
  const [outputType, setOutputType] = useState('coaching_report');
  const [focusPrompt, setFocusPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [reportText, setReportText] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const scrollRef = React.useRef<ScrollView>(null);

  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [videoAsset, setVideoAsset] = useState<{ uri: string; name: string; type: string } | null>(null);

  const pickVideo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const name = asset.fileName ?? asset.uri.split('/').pop() ?? 'team_video.mp4';
      setVideoAsset({ uri: asset.uri, name, type: 'video/mp4' });
    }
  };

  const [showQuickReport, setShowQuickReport] = useState(false);
  const [gameReports, setGameReports] = useState<any[]>([]);
  const [loadingGameReports, setLoadingGameReports] = useState(true);

  const loadGameReports = () => {
    gameReportsAPI.list().then(setGameReports).catch(() => {}).finally(() => setLoadingGameReports(false));
  };

  useFocusEffect(React.useCallback(() => { loadGameReports(); }, []));

  const [savedTeamReportId, setSavedTeamReportId] = useState<number | null>(null);

  // Previous reports list
  const [showPrevReports, setShowPrevReports] = useState(false);
  const [prevReports, setPrevReports] = useState<any[]>([]);
  const [loadingPrevReports, setLoadingPrevReports] = useState(false);
  const [selectedPrevReport, setSelectedPrevReport] = useState<any | null>(null);
  const [prevReportFilter, setPrevReportFilter] = useState<string>('all');
  const [showPrevSearch, setShowPrevSearch] = useState(false);
  const [prevSearchText, setPrevSearchText] = useState('');
  const [prevReportCorrectionText, setPrevReportCorrectionText] = useState('');
  const [prevReportCorrections, setPrevReportCorrections] = useState<any[]>([]);
  const [addingPrevCorrection, setAddingPrevCorrection] = useState(false);
  const [regeneratingPrevReport, setRegeneratingPrevReport] = useState(false);

  const loadPrevReports = async () => {
    setLoadingPrevReports(true);
    try {
      const reports = await evalsAPI.teamReports(50);
      setPrevReports(reports);
    } catch {}
    setLoadingPrevReports(false);
  };

  const openPrevReport = async (report: any) => {
    setSelectedPrevReport(report);
    setPrevReportCorrectionText('');
    try {
      const corrs = await evalsAPI.teamReportCorrections(report.id);
      setPrevReportCorrections(corrs);
    } catch {
      setPrevReportCorrections([]);
    }
  };

  const addPrevReportCorrection = async (generateNew: boolean) => {
    if (!prevReportCorrectionText.trim() || !selectedPrevReport) return;
    setAddingPrevCorrection(true);
    try {
      const c = await evalsAPI.addTeamReportCorrection(selectedPrevReport.id, prevReportCorrectionText.trim());
      setPrevReportCorrections(prev => [...prev, c]);
      setPrevReportCorrectionText('');
      if (generateNew) {
        setRegeneratingPrevReport(true);
        try {
          const updated = await evalsAPI.regenerateTeamReport(selectedPrevReport.id);
          setSelectedPrevReport(updated);
          setPrevReports(prev => prev.map(r => r.id === updated.id ? updated : r));
          const updatedCorrs = await evalsAPI.teamReportCorrections(selectedPrevReport.id);
          setPrevReportCorrections(updatedCorrs);
          Alert.alert('Regenerated', 'Team report updated with your corrections.');
        } catch (e: any) {
          Alert.alert('Error', e?.response?.data?.detail ?? 'Could not regenerate');
        } finally {
          setRegeneratingPrevReport(false);
        }
      } else {
        Alert.alert('Saved', 'Correction saved for later.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not save correction');
    } finally {
      setAddingPrevCorrection(false);
    }
  };

  const regeneratePrevReport = async () => {
    if (!selectedPrevReport) return;
    const unapplied = prevReportCorrections.filter((c: any) => !c.applied);
    if (unapplied.length === 0) {
      Alert.alert('No Pending Corrections', 'Add at least one correction before regenerating.');
      return;
    }
    setRegeneratingPrevReport(true);
    try {
      const updated = await evalsAPI.regenerateTeamReport(selectedPrevReport.id);
      setSelectedPrevReport(updated);
      setPrevReports(prev => prev.map(r => r.id === updated.id ? updated : r));
      const updatedCorrs = await evalsAPI.teamReportCorrections(selectedPrevReport.id);
      setPrevReportCorrections(updatedCorrs);
      Alert.alert('Regenerated', 'Team report updated with your corrections.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not regenerate');
    } finally {
      setRegeneratingPrevReport(false);
    }
  };

  const [showStaffShare, setShowStaffShare] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffResults, setStaffResults] = useState<any[]>([]);
  const [staffSearchLoading, setStaffSearchLoading] = useState(false);
  const [allowRegen, setAllowRegen] = useState(false);
  const [sendingStaff, setSendingStaff] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [shareTarget, setShareTarget] = useState<'player' | 'team' | 'all_staff'>('player');
  const [shareSearch, setShareSearch] = useState('');
  const [shareResults, setShareResults] = useState<any[]>([]);
  const [selectedShareTarget, setSelectedShareTarget] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [shareMessage, setShareMessage] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareSearchLoading, setShareSearchLoading] = useState(false);
  // Section include/exclude toggles for share modals — derived from the report's
  // actual headings so labels always match what's in this report.
  const [sectionToggles, setSectionToggles] = useState<Record<string, boolean>>({});
  // Context for which report is being shared (prev report modal)
  const [shareSourceReport, setShareSourceReport] = useState<any>(null);
  // Export state for prev report modal
  const [exportingPrevReport, setExportingPrevReport] = useState(false);

  const typeLabel = () => outputTypeLabel(outputType);

  const exportPdf = async () => {
    if (!reportText) return;
    setExporting(true);
    try {
      const now = new Date();
      const html = buildReportHtml({
        title: typeLabel(),
        subject: coach?.program_name ?? 'Team',
        date: now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        body: reportText,
      });
      const fileName = buildPdfFileName(typeLabel(), coach?.program_name ?? 'Team', now);
      const { uri } = await Print.printToFileAsync({ html });
      const dest = FileSystem.cacheDirectory + fileName + '.pdf';
      await FileSystem.copyAsync({ from: uri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: fileName });
    } catch (e: any) {
      Alert.alert('Export Error', e?.message ?? 'Could not export');
    } finally {
      setExporting(false);
    }
  };

  const printPdf = async () => {
    if (!reportText) return;
    try {
      const now = new Date();
      const html = buildReportHtml({
        title: typeLabel(),
        subject: coach?.program_name ?? 'Team',
        date: now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        body: reportText,
      });
      await Print.printAsync({ html });
    } catch (e: any) {
      Alert.alert('Print Error', e?.message ?? 'Could not print');
    }
  };

  useEffect(() => {
    teamsAPI.list().then(setTeams).catch(() => {});
  }, []);

  const searchPlayers = async () => {
    if (!shareSearch.trim()) return;
    setShareSearchLoading(true);
    try {
      if (shareTarget === 'all_staff') {
        const results = await playerAPI.searchStaff(shareSearch.trim());
        setShareResults(results);
      } else {
        const results = await playerAPI.searchPlayerUsers(shareSearch.trim());
        setShareResults(results);
      }
    } catch {}
    setShareSearchLoading(false);
  };

  // Sections of the report currently being shared (derived from its headings)
  const reportSections = splitReportSections(reportText ?? '');

  // Initialise toggles (all-on) for the sections of the report about to be shared
  const initSectionToggles = () => {
    const next: Record<string, boolean> = {};
    for (const s of splitReportSections(reportText ?? '')) next[s.heading] = true;
    setSectionToggles(next);
  };

  const submitShare = async () => {
    if (!reportText) return;
    setSharing(true);
    try {
      // Only include the sections the user left enabled
      const filteredText = joinReportSections(reportSections, sectionToggles) || reportText;
      const data: any = {
        output_type: outputType,
        report_text: filteredText,
        target_type: shareTarget,
        message: shareMessage.trim() || undefined,
      };
      if (shareTarget === 'player' && selectedShareTarget) {
        data.player_user_id = selectedShareTarget.id;
      } else if (shareTarget === 'team' && selectedShareTarget) {
        data.team_id = selectedShareTarget.id;
      } else if (shareTarget === 'all_staff' && selectedShareTarget) {
        data.staff_coach_id = selectedShareTarget.id;
      }
      const result = await playerAPI.shareTeamReport(data);
      Alert.alert('Shared!', `Report shared with ${result.shared_count ?? 1} recipient(s).`);
      setShowShare(false);
      setSelectedShareTarget(null);
      setShareSearch('');
      setShareResults([]);
      setShareMessage('');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not share report');
    } finally {
      setSharing(false);
    }
  };

  const printPrevReport = async (report: any) => {
    if (!report?.report_text) return;
    const rType = (report.output_type ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    const html = buildReportHtml({
      title: rType,
      subject: coach?.program_name ?? 'Team',
      date: new Date(report.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      body: report.report_text,
    });
    try { await Print.printAsync({ html }); } catch {}
  };

  const exportPrevReport = async (report: any) => {
    if (!report?.report_text) return;
    setExportingPrevReport(true);
    try {
      const rDate = new Date(report.created_at);
      const rType = outputTypeLabel(report.output_type);
      const html = buildReportHtml({
        title: rType,
        subject: coach?.program_name ?? 'Team',
        date: rDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        body: report.report_text,
      });
      const fileName = buildPdfFileName(rType, coach?.program_name ?? 'Team', rDate);
      const { uri } = await Print.printToFileAsync({ html });
      // Copy to a properly-named file so the export keeps the standard convention
      // (Type - Subject - YYYY-MM-DD) instead of the random Print temp name.
      const dest = FileSystem.cacheDirectory + fileName + '.pdf';
      await FileSystem.copyAsync({ from: uri, to: dest });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: fileName });
      }
    } catch { Alert.alert('Error', 'Could not export report'); }
    setExportingPrevReport(false);
  };

  const searchStaff = async () => {
    if (!staffSearch.trim()) return;
    setStaffSearchLoading(true);
    try {
      const results = await staffSharingAPI.searchTargets(staffSearch.trim());
      setStaffResults(results);
    } catch {}
    setStaffSearchLoading(false);
  };

  const sendToStaff = async (target: any) => {
    if (!savedTeamReportId) return;
    setSendingStaff(true);
    try {
      // When regeneration is NOT allowed, send a frozen, section-filtered copy
      // so the recipient sees exactly the sections the sender chose to include.
      const frozenText = !allowRegen
        ? (joinReportSections(reportSections, sectionToggles) || reportText || undefined)
        : undefined;
      const res = await staffSharingAPI.shareGroup({
        report_type: 'team_report',
        report_id: savedTeamReportId,
        kind: target.kind ?? 'coach',
        coach_id: target.coach_id ?? undefined,
        team_id: target.team_id ?? undefined,
        program_name: target.program_name ?? undefined,
        allow_regenerate: allowRegen,
        frozen_text: frozenText ?? undefined,
      });
      Alert.alert('Shared!', `Report shared with ${res.shared_count ?? 1} staff member(s).`);
      setShowStaffShare(false);
      setStaffSearch('');
      setStaffResults([]);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not share report');
    } finally {
      setSendingStaff(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setReportText(null);
    setSavedTeamReportId(null);
    try {
      const result = await evalsAPI.teamReport({ output_type: outputType, focus_prompt: focusPrompt, team_id: selectedTeamId ?? undefined, video: videoAsset ?? undefined });
      setReportText(result.report_text);
      if (result.id) setSavedTeamReportId(result.id);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not generate team report');
    } finally {
      setGenerating(false);
    }
  };

  // Client-side filtering of the visible previous-reports list: output_type chip
  // filter (existing) plus a case-insensitive substring search over team/program
  // name, opponent, output type, and any title/date text on the item.
  const prevSearchQuery = prevSearchText.trim().toLowerCase();
  const filteredPrevReports = prevReports
    .filter(r => prevReportFilter === 'all' || r.output_type === prevReportFilter)
    .filter((r: any) => {
      if (!prevSearchQuery) return true;
      const typeLabelText = OUTPUT_TYPES.find(ot => ot.key === r.output_type)?.label ?? r.output_type ?? '';
      const dateText = r.created_at ? new Date(r.created_at).toLocaleDateString() : '';
      const haystack = [
        r.program_name,
        r.team_name,
        r.my_team_name,
        r.opponent_name,
        r.opponent_team_name,
        r.output_type,
        typeLabelText,
        r.title,
        dateText,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(prevSearchQuery);
    });

  return (
    <ScreenBackground>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={undefined}
    >
      <KeyboardAwareScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Team Reports</Text>
          </View>
          <TouchableOpacity style={styles.importBtn} onPress={() => navigation.navigate('Import')}>
            <Ionicons name="cloud-upload-outline" size={18} color={t.muted} />
            <Text style={styles.importText}>Import Excel</Text>
          </TouchableOpacity>
        </View>

        {/* Game Reports (packet builder) */}
        <View style={{ marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={styles.label}>Game Reports</Text>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
              onPress={() => navigation.navigate('GameReportBuilder')}
            >
              <Ionicons name="add" size={14} color={t.ctaText} />
              <Text style={{ color: t.ink, fontSize: 12, fontFamily: fonts[700] }}>New</Text>
            </TouchableOpacity>
          </View>
          {loadingGameReports ? (
            <ActivityIndicator color={t.accent} size="small" />
          ) : gameReports.length === 0 ? (
            <TouchableOpacity
              style={{ borderWidth: 1, borderColor: t.line, borderStyle: 'dashed', borderRadius: 12, padding: 20, alignItems: 'center', gap: 6 }}
              onPress={() => navigation.navigate('GameReportBuilder')}
            >
              <Ionicons name="albums-outline" size={28} color={t.line} />
              <Text style={{ color: t.muted, fontSize: 13 }}>Build your first game report packet</Text>
            </TouchableOpacity>
          ) : (
            gameReports.map((gr: any) => {
              const myName = gr.my_team_name;
              const oppName = gr.opponent_team_name ?? gr.opponent_name;
              let matchup = gr.title;
              if (!matchup) {
                if (gr.mode === 'vs_opponent' && oppName) matchup = `${myName ?? 'My Team'} vs ${oppName}`;
                else if (gr.mode === 'my_program') matchup = myName ?? 'My Team';
                else matchup = oppName ?? 'Opponent';
              }
              const deleteGameReport = () => {
                Alert.alert('Delete Game Report', `Delete "${matchup}"?`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: async () => {
                    try {
                      await gameReportsAPI.delete(gr.id);
                      setGameReports(prev => prev.filter(r => r.id !== gr.id));
                    } catch {
                      Alert.alert('Error', 'Could not delete report');
                    }
                  }},
                ]);
              };
              return (
                <TouchableOpacity
                  key={gr.id}
                  style={{ backgroundColor: t.card, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: gr.report_text ? t.accent : t.chip, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                  onPress={() => navigation.navigate('GameReportBuilder', { reportId: gr.id })}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[700] }} numberOfLines={1}>{matchup}</Text>
                    <Text style={{ color: t.muted, fontSize: 11, marginTop: 2 }}>
                      {gr.output_type.replace(/_/g, ' ')} · {new Date(gr.updated_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {gr.report_text ? (
                      <View style={{ backgroundColor: t.accentSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ color: t.accent, fontSize: 10, fontFamily: fonts[700] }}>REPORT READY</Text>
                      </View>
                    ) : (
                      <View style={{ backgroundColor: t.chip, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ color: t.muted, fontSize: 10, fontFamily: fonts[700] }}>IN PROGRESS</Text>
                      </View>
                    )}
                    <Text style={{ color: t.muted2, fontSize: 10 }}>{(gr.clips?.length ?? 0)} clip{gr.clips?.length !== 1 ? 's' : ''}</Text>
                  </View>
                  <TouchableOpacity onPress={deleteGameReport} style={{ padding: 4, marginLeft: 4 }}>
                    <Ionicons name="trash-outline" size={16} color={t.muted2} />
                  </TouchableOpacity>
                  <Ionicons name="chevron-forward" size={16} color={t.line} />
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* Quick Report (one-shot) */}
        <TouchableOpacity
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: showQuickReport ? 16 : 0 }}
          onPress={() => setShowQuickReport(v => !v)}
        >
          <Text style={styles.label}>Quick Report</Text>
          <Ionicons name={showQuickReport ? 'chevron-up' : 'chevron-down'} size={16} color={t.muted} />
        </TouchableOpacity>

        {showQuickReport && (<>

        <Text style={styles.label}>Select Team</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
          <TouchableOpacity
            style={[styles.chip, selectedTeamId === null && styles.chipActive]}
            onPress={() => setSelectedTeamId(null)}
          >
            <Text style={[styles.chipText, selectedTeamId === null && styles.chipTextActive]}>All Players</Text>
          </TouchableOpacity>
          {teams.map(t => (
            <TouchableOpacity
              key={t.id}
              style={[styles.chip, selectedTeamId === t.id && styles.chipActive]}
              onPress={() => setSelectedTeamId(t.id)}
            >
              <Text style={[styles.chipText, selectedTeamId === t.id && styles.chipTextActive]}>{t.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.label}>Report Type</Text>
        <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8, marginLeft: 2 }}>
          Tap multiple to combine them into one comprehensive report.
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
          {OUTPUT_TYPES.map(t => {
            const selected = outputType.split(',').filter(Boolean);
            const isOn = selected.includes(t.key);
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.chip, isOn && styles.chipActive]}
                onPress={() => {
                  const next = isOn ? selected.filter(k => k !== t.key) : [...selected, t.key];
                  setOutputType((next.length ? next : [t.key]).join(','));
                }}
              >
                <Text style={[styles.chipText, isOn && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Text style={styles.label}>Coach Focus (optional)</Text>
        <VoiceTextInput
          style={styles.input}
          placeholder="e.g. Upcoming tournament, defensive scheme, recruiting eval..."
          placeholderTextColor={t.muted2}
          value={focusPrompt}
          onChangeText={setFocusPrompt}
          multiline
          textAlignVertical="top"

        />

        <Text style={styles.label}>Upload Footage (optional)</Text>
        <TouchableOpacity style={styles.videoPickerBtn} onPress={pickVideo}>
          <Ionicons name={videoAsset ? 'videocam' : 'videocam-outline'} size={18} color={videoAsset ? t.positive : t.muted} />
          <Text style={[styles.videoPickerText, videoAsset && { color: t.positive }]}>
            {videoAsset ? videoAsset.name.slice(-30) : 'Pick a video for visual context...'}
          </Text>
          {videoAsset && (
            <TouchableOpacity onPress={() => setVideoAsset(null)}>
              <Ionicons name="close-circle" size={18} color={t.muted} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.generateBtn} onPress={generate} disabled={generating}>
          {generating
            ? <><ActivityIndicator color={t.ctaText} /><Text style={styles.generateText}>  Generating...</Text></>
            : <><Ionicons name="people" size={18} color={t.ctaText} /><Text style={styles.generateText}>  Generate Team Report</Text></>
          }
        </TouchableOpacity>

        {generating && (
          <Text style={styles.hint}>Analyzing roster and generating report. This may take 20–40 seconds.</Text>
        )}

        {reportText && (
          <View style={styles.reportSection}>
            <Text style={styles.label}>Team Report</Text>
            <View style={styles.reportBox}>
              {renderReport(reportText, { heading: t.ink, body: t.inkSoft })}
            </View>
            <View style={styles.actionGrid}>
              <TouchableOpacity style={styles.actionBtn} onPress={exportPdf} disabled={exporting}>
                {exporting
                  ? <ActivityIndicator color={t.muted} size="small" />
                  : <Ionicons name="share-outline" size={20} color={t.muted} />}
                <Text style={styles.actionText}>Export PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={printPdf}>
                <Ionicons name="print-outline" size={20} color={t.muted} />
                <Text style={styles.actionText}>Print</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { borderColor: t.positive }]} onPress={() => { setShareSourceReport(null); initSectionToggles(); setShowShare(true); }}>
                <Ionicons name="person-add-outline" size={20} color={t.positive} />
                <Text style={[styles.actionText, { color: t.positive }]}>Share</Text>
              </TouchableOpacity>
              {savedTeamReportId && (
                <TouchableOpacity style={[styles.actionBtn, { borderColor: t.accent }]} onPress={() => { setShareSourceReport(null); initSectionToggles(); setShowStaffShare(true); setStaffSearch(''); setStaffResults([]); }}>
                  <Ionicons name="people-outline" size={20} color={t.accent} />
                  <Text style={[styles.actionText, { color: t.accent }]}>Staff</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.actionBtn} onPress={() => { setReportText(null); setFocusPrompt(''); setSelectedTeamId(null); setVideoAsset(null); setSavedTeamReportId(null); }}>
                <Ionicons name="add-circle-outline" size={20} color={t.muted} />
                <Text style={styles.actionText}>New Report</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        </>)}

        {/* Previous Team Reports */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: showPrevReports ? 12 : 0 }}>
          <TouchableOpacity
            style={{ flex: 1 }}
            onPress={() => {
              if (!showPrevReports) loadPrevReports();
              setShowPrevReports(v => !v);
            }}
          >
            <Text style={styles.label}>Previous Reports</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            {showPrevReports && (
              <TouchableOpacity
                onPress={() => {
                  setShowPrevSearch(v => {
                    const next = !v;
                    if (!next) setPrevSearchText('');
                    return next;
                  });
                }}
              >
                <Ionicons name={showPrevSearch ? 'close' : 'search'} size={16} color={t.muted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => {
                if (!showPrevReports) loadPrevReports();
                setShowPrevReports(v => !v);
              }}
            >
              <Ionicons name={showPrevReports ? 'chevron-up' : 'chevron-down'} size={16} color={t.muted} />
            </TouchableOpacity>
          </View>
        </View>

        {showPrevReports && (
          <>
            {/* Filter by output_type */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {[{ key: 'all', label: 'All' }, ...OUTPUT_TYPES].map(t => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.chip, prevReportFilter === t.key && styles.chipActive]}
                  onPress={() => setPrevReportFilter(t.key)}
                >
                  <Text style={[styles.chipText, prevReportFilter === t.key && styles.chipTextActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {showPrevSearch && (
              <TextInput
                style={styles.searchInput}
                placeholder="Search team, opponent, type, or title..."
                placeholderTextColor={t.muted2}
                value={prevSearchText}
                onChangeText={setPrevSearchText}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
            {loadingPrevReports ? (
              <ActivityIndicator color={t.accent} size="small" />
            ) : filteredPrevReports.length === 0 ? (
              <Text style={{ color: t.muted2, fontSize: 13, textAlign: 'center', paddingVertical: 16 }}>
                {prevSearchText.trim() ? 'No matching reports.' : 'No team reports yet.'}
              </Text>
            ) : (
              filteredPrevReports
                .map((r: any) => (
                  <TouchableOpacity
                    key={r.id}
                    style={{ backgroundColor: t.card, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: t.chip }}
                    onPress={() => openPrevReport(r)}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ backgroundColor: t.accentSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ color: t.accent, fontSize: 10, fontFamily: fonts[700] }}>
                          {OUTPUT_TYPES.find(t => t.key === r.output_type)?.label ?? r.output_type}
                        </Text>
                      </View>
                      <Text style={{ color: t.muted2, fontSize: 11 }}>{new Date(r.created_at).toLocaleDateString()}</Text>
                    </View>
                    {r.report_text ? (
                      <Text style={{ color: t.muted, fontSize: 12, marginTop: 8, lineHeight: 18 }} numberOfLines={2}>
                        {r.report_text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim().slice(0, 100)}...
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                      <Ionicons name="chevron-forward" size={12} color={t.line} />
                      <Text style={{ color: t.line, fontSize: 11 }}>Tap to view full report</Text>
                    </View>
                  </TouchableOpacity>
                ))
            )}
          </>
        )}
      </KeyboardAwareScrollView>

      {/* Previous Report Detail Modal */}
      <Modal visible={!!selectedPrevReport} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, flex: 1, marginTop: 60 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 18, fontFamily: fonts[800] }}>
                  {OUTPUT_TYPES.find(t => t.key === selectedPrevReport?.output_type)?.label ?? selectedPrevReport?.output_type}
                </Text>
                <Text style={{ color: t.muted, fontSize: 11, marginTop: 2 }}>
                  {selectedPrevReport ? new Date(selectedPrevReport.created_at).toLocaleDateString() : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedPrevReport(null)}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            <KeyboardAwareScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
              {selectedPrevReport?.report_text ? (
                renderReport(selectedPrevReport.report_text, { heading: t.ink, body: t.inkSoft })
              ) : (
                <Text style={{ color: t.muted }}>No report content.</Text>
              )}

              {/* Share + Print/Export buttons */}
              <View style={{ gap: 8, marginTop: 20 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.positive, borderRadius: 10, paddingVertical: 12 }}
                    onPress={() => {
                      if (!selectedPrevReport?.report_text) return;
                      setShareSourceReport(selectedPrevReport);
                      setReportText(selectedPrevReport.report_text);
                      setSavedTeamReportId(selectedPrevReport.id);
                      const initial: Record<string, boolean> = {};
                      for (const s of splitReportSections(selectedPrevReport.report_text)) initial[s.heading] = true;
                      setSectionToggles(initial);
                      setSelectedPrevReport(null);
                      setTimeout(() => setShowShare(true), 200);
                    }}
                  >
                    <Ionicons name="person-outline" size={15} color="#16201A" />
                    <Text style={{ color: '#16201A', fontFamily: fonts[700], fontSize: 13 }}>Send to Player</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.ctaBg, borderRadius: 10, paddingVertical: 12 }}
                    onPress={() => {
                      if (!selectedPrevReport) return;
                      setShareSourceReport(selectedPrevReport);
                      setReportText(selectedPrevReport.report_text);
                      setSavedTeamReportId(selectedPrevReport.id);
                      const initial: Record<string, boolean> = {};
                      for (const s of splitReportSections(selectedPrevReport.report_text ?? '')) initial[s.heading] = true;
                      setSectionToggles(initial);
                      setSelectedPrevReport(null);
                      setTimeout(() => { setShowStaffShare(true); setStaffSearch(''); setStaffResults([]); }, 200);
                    }}
                  >
                    <Ionicons name="people-outline" size={15} color={t.ctaText} />
                    <Text style={{ color: t.ctaText, fontFamily: fonts[700], fontSize: 13 }}>Send to Staff</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.chip, borderRadius: 10, paddingVertical: 12, borderWidth: 1, borderColor: t.line }}
                    onPress={() => printPrevReport(selectedPrevReport)}
                  >
                    <Ionicons name="print-outline" size={15} color={t.inkSoft} />
                    <Text style={{ color: t.inkSoft, fontFamily: fonts[700], fontSize: 13 }}>Print</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.chip, borderRadius: 10, paddingVertical: 12, borderWidth: 1, borderColor: t.line }}
                    onPress={() => exportPrevReport(selectedPrevReport)}
                    disabled={exportingPrevReport}
                  >
                    {exportingPrevReport
                      ? <ActivityIndicator color={t.inkSoft} size="small" />
                      : <><Ionicons name="share-outline" size={15} color={t.inkSoft} /><Text style={{ color: t.inkSoft, fontFamily: fonts[700], fontSize: 13 }}>Export PDF</Text></>}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Corrections section */}
              {prevReportCorrections.length > 0 && (
                <View style={{ marginTop: 20 }}>
                  <Text style={styles.label}>Corrections ({prevReportCorrections.length})</Text>
                  {prevReportCorrections.map((c: any) => (
                    <View key={c.id} style={{ backgroundColor: t.chip, borderRadius: 8, padding: 12, marginBottom: 6, opacity: c.applied ? 0.55 : 1 }}>
                      <Text style={{ color: t.inkSoft, fontSize: 13 }}>{c.correction}</Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                        <Text style={{ color: t.muted2, fontSize: 11 }}>{new Date(c.created_at).toLocaleDateString()}</Text>
                        {c.applied && <Text style={{ color: t.positive, fontSize: 10, fontFamily: fonts[700] }}>APPLIED</Text>}
                      </View>
                    </View>
                  ))}
                  {prevReportCorrections.some((c: any) => !c.applied) && (
                    <TouchableOpacity
                      style={{ backgroundColor: t.ctaBg, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 }}
                      onPress={regeneratePrevReport}
                      disabled={regeneratingPrevReport}
                    >
                      {regeneratingPrevReport
                        ? <ActivityIndicator color={t.ctaText} />
                        : <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>Apply & Regenerate</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Add correction */}
              <View style={{ marginTop: 20 }}>
                <Text style={styles.label}>Add Correction</Text>
                <VoiceTextInput
                  style={{ backgroundColor: t.chip, borderRadius: 10, padding: 12, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 80, marginBottom: 8 }}
                  placeholder="What needs to be corrected in this report?"
                  placeholderTextColor={t.muted2}
                  value={prevReportCorrectionText}
                  onChangeText={setPrevReportCorrectionText}
                  multiline
                  textAlignVertical="top"
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: t.ctaBg, borderRadius: 10, padding: 14, alignItems: 'center' }}
                    onPress={() => addPrevReportCorrection(true)}
                    disabled={addingPrevCorrection || regeneratingPrevReport || !prevReportCorrectionText.trim()}
                  >
                    {addingPrevCorrection || regeneratingPrevReport
                      ? <ActivityIndicator color={t.ctaText} />
                      : <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>Apply & Regenerate</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: t.line, borderRadius: 10, padding: 14, alignItems: 'center' }}
                    onPress={() => addPrevReportCorrection(false)}
                    disabled={addingPrevCorrection || !prevReportCorrectionText.trim()}
                  >
                    <Text style={{ color: t.ink, fontFamily: fonts[700] }}>Save for Later</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>

      {/* Share with Staff Modal */}
      <Modal visible={showStaffShare} transparent animationType="slide">
        <KeyboardAvoidingView style={shareStyles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <KeyboardAwareScrollView style={shareStyles.modal} contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={shareStyles.title}>Share with Staff</Text>
            {/* Report preview */}
            {shareSourceReport && (
              <View style={{ backgroundColor: t.chip, borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <Text style={{ color: t.muted, fontSize: 11, fontFamily: fonts[700], marginBottom: 2 }}>SENDING REPORT</Text>
                <Text style={{ color: t.ink, fontSize: 13, fontFamily: fonts[700] }}>
                  {(shareSourceReport.output_type ?? outputType).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                </Text>
                <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>
                  {new Date(shareSourceReport.created_at ?? Date.now()).toLocaleDateString()}
                </Text>
              </View>
            )}
            {/* Allow regenerate — this is the mode switch:
                ON  = live, regenerable copy (recipient can regenerate; no filtering)
                OFF = frozen snapshot (you control which sections are included) */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, backgroundColor: t.chip, borderRadius: 8, padding: 10 }}>
              <Text style={{ color: t.inkSoft, fontSize: 13 }}>Allow recipient to regenerate</Text>
              <Switch value={allowRegen} onValueChange={setAllowRegen} trackColor={{ true: t.accent, false: t.line }} thumbColor="#fff" />
            </View>
            <Text style={{ color: t.muted, fontSize: 11, marginBottom: 12, marginLeft: 2 }}>
              {allowRegen
                ? 'Sends a live, regenerable copy — recipient sees the full report.'
                : 'Sends a frozen snapshot — choose which sections to include below.'}
            </Text>

            {/* Section toggles — only in frozen mode (regenerate OFF) */}
            {!allowRegen && reportSections.length > 1 && (
              <>
                <Text style={[shareStyles.label, { marginBottom: 6 }]}>Include Sections</Text>
                {reportSections.map(sec => (
                  <View key={sec.heading} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, backgroundColor: t.chip, borderRadius: 8, padding: 10 }}>
                    <Text style={{ color: t.inkSoft, fontSize: 13, flex: 1, marginRight: 8 }} numberOfLines={1}>{sec.heading}</Text>
                    <Switch
                      value={sectionToggles[sec.heading] !== false}
                      onValueChange={v => setSectionToggles(p => ({ ...p, [sec.heading]: v }))}
                      trackColor={{ true: t.accent, false: t.line }}
                      thumbColor="#fff"
                    />
                  </View>
                ))}
              </>
            )}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              <VoiceTextInput
                style={[shareStyles.input, { flex: 1 }]}
                placeholder="Search coach, team, or program name..."
                placeholderTextColor={t.muted2}
                value={staffSearch}
                onChangeText={setStaffSearch}
              />
              <TouchableOpacity
                style={{ backgroundColor: t.ctaBg, borderRadius: 10, padding: 12, justifyContent: 'center' }}
                onPress={searchStaff}
              >
                {staffSearchLoading ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="search" size={18} color={t.ctaText} />}
              </TouchableOpacity>
            </View>
            <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8, marginLeft: 2 }}>
              Search a team or program to reach every connected staff member at once.
            </Text>
            {staffResults.map((r: any, idx: number) => (
              <TouchableOpacity key={idx} style={[shareStyles.resultRow, { flexDirection: 'row', alignItems: 'center' }]} onPress={() => sendToStaff(r)} disabled={sendingStaff}>
                <View style={{ flex: 1 }}>
                  <Text style={shareStyles.resultName}>{r.label ?? r.name}</Text>
                  <Text style={shareStyles.resultMeta}>{r.sublabel ?? `${r.role} · ${r.program_name}`}</Text>
                </View>
                {r.kind && r.kind !== 'coach' && <Ionicons name="people" size={16} color={t.accent} />}
              </TouchableOpacity>
            ))}
            <View style={shareStyles.btnRow}>
              <TouchableOpacity style={shareStyles.cancelBtn} onPress={() => { setShowStaffShare(false); setShareSourceReport(null); }}>
                <Text style={shareStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Share Modal */}
      <Modal visible={showShare} transparent animationType="slide">
        <KeyboardAvoidingView style={shareStyles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <KeyboardAwareScrollView style={shareStyles.modal} contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={shareStyles.title}>Share Team Report</Text>
            {/* Report preview */}
            {shareSourceReport && (
              <View style={{ backgroundColor: t.chip, borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <Text style={{ color: t.muted, fontSize: 11, fontFamily: fonts[700], marginBottom: 2 }}>SENDING REPORT</Text>
                <Text style={{ color: t.ink, fontSize: 13, fontFamily: fonts[700] }}>
                  {(shareSourceReport.output_type ?? outputType).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                </Text>
                <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>
                  {new Date(shareSourceReport.created_at ?? Date.now()).toLocaleDateString()}
                </Text>
              </View>
            )}
            {/* Section toggles — derived from this report's actual headings */}
            {reportSections.length > 1 && (
              <>
                <Text style={[shareStyles.label, { marginBottom: 6 }]}>Include Sections</Text>
                {reportSections.map(sec => (
                  <View key={sec.heading} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, backgroundColor: t.chip, borderRadius: 8, padding: 10 }}>
                    <Text style={{ color: t.inkSoft, fontSize: 13, flex: 1, marginRight: 8 }} numberOfLines={1}>{sec.heading}</Text>
                    <Switch
                      value={sectionToggles[sec.heading] !== false}
                      onValueChange={v => setSectionToggles(p => ({ ...p, [sec.heading]: v }))}
                      trackColor={{ true: t.positive, false: t.line }}
                      thumbColor="#fff"
                    />
                  </View>
                ))}
              </>
            )}

            {/* Target type selector */}
            <Text style={shareStyles.label}>Send To</Text>
            <View style={shareStyles.targetRow}>
              {([['player', 'Individual Player'], ['team', 'Whole Team']] as const).map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  style={[shareStyles.targetChip, shareTarget === key && shareStyles.targetChipActive]}
                  onPress={() => { setShareTarget(key); setSelectedShareTarget(null); setShareResults([]); }}
                >
                  <Text style={[shareStyles.targetChipText, shareTarget === key && shareStyles.targetChipTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Player search */}
            {shareTarget === 'player' && !selectedShareTarget && (
              <View style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                  <VoiceTextInput
                    style={[shareStyles.input, { flex: 1 }]}
                    placeholder="Search player name..."
                    placeholderTextColor={t.muted2}
                    value={shareSearch}
                    onChangeText={setShareSearch}
                  />
                  <TouchableOpacity
                    style={{ backgroundColor: t.ctaBg, borderRadius: 10, padding: 12, justifyContent: 'center' }}
                    onPress={searchPlayers}
                  >
                    {shareSearchLoading ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="search" size={18} color={t.ctaText} />}
                  </TouchableOpacity>
                </View>
                {shareResults.map((r: any) => (
                  <TouchableOpacity key={r.id} style={shareStyles.resultRow} onPress={() => { setSelectedShareTarget(r); setShareResults([]); }}>
                    <Text style={shareStyles.resultName}>{r.name}</Text>
                    <Text style={shareStyles.resultMeta}>{r.email}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Team selector */}
            {shareTarget === 'team' && (
              <View style={{ marginBottom: 12 }}>
                {teams.map((tm: any) => (
                  <TouchableOpacity
                    key={tm.id}
                    style={[shareStyles.resultRow, selectedShareTarget?.id === tm.id && { borderColor: t.positive }]}
                    onPress={() => setSelectedShareTarget(tm)}
                  >
                    <Text style={shareStyles.resultName}>{tm.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Selected target badge */}
            {selectedShareTarget && (
              <View style={shareStyles.selectedBadge}>
                <Text style={shareStyles.selectedName}>{selectedShareTarget.name}</Text>
                <TouchableOpacity onPress={() => setSelectedShareTarget(null)}>
                  <Ionicons name="close-circle" size={18} color={t.muted} />
                </TouchableOpacity>
              </View>
            )}

            {shareTarget === 'all_staff' && !selectedShareTarget && (
              <View style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                  <VoiceTextInput
                    style={[shareStyles.input, { flex: 1 }]}
                    placeholder="Search coach/program name..."
                    placeholderTextColor={t.muted2}
                    value={shareSearch}
                    onChangeText={setShareSearch}
                  />
                  <TouchableOpacity
                    style={{ backgroundColor: t.ctaBg, borderRadius: 10, padding: 12, justifyContent: 'center' }}
                    onPress={searchPlayers}
                  >
                    {shareSearchLoading ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="search" size={18} color={t.ctaText} />}
                  </TouchableOpacity>
                </View>
                {shareResults.map((r: any) => (
                  <TouchableOpacity key={r.id} style={shareStyles.resultRow} onPress={() => { setSelectedShareTarget(r); setShareResults([]); }}>
                    <Text style={shareStyles.resultName}>{r.name}</Text>
                    <Text style={shareStyles.resultMeta}>{r.role} · {r.program_name}</Text>
                  </TouchableOpacity>
                ))}
                <Text style={{ color: t.muted2, fontSize: 11, marginTop: 4 }}>Search to find a specific staff member, or leave empty to notify all staff.</Text>
              </View>
            )}

            <VoiceTextInput
              style={[shareStyles.input, { marginTop: 8 }]}
              placeholder="Add a message (optional)..."
              placeholderTextColor={t.muted2}
              value={shareMessage}
              onChangeText={setShareMessage}
            />

            <View style={shareStyles.btnRow}>
              <TouchableOpacity style={shareStyles.cancelBtn} onPress={() => { setShowShare(false); setSelectedShareTarget(null); }}>
                <Text style={shareStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[shareStyles.shareBtn, { opacity: (shareTarget === 'all_staff' || selectedShareTarget) ? 1 : 0.4 }]}
                onPress={submitShare}
                disabled={sharing || (shareTarget !== 'all_staff' && !selectedShareTarget)}
              >
                {sharing ? <ActivityIndicator color={t.ctaText} /> : <Text style={shareStyles.shareBtnText}>Send</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
    </ScreenBackground>
  );
}


const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 56 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 28 },
  title: { fontFamily: fonts[800], fontSize: 30, letterSpacing: -0.6, color: t.ink, marginBottom: 4 },
  sub: { color: t.muted, fontSize: 13 },
  importBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: t.cta2Border, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 9, marginTop: 4,
  },
  importText: { color: t.cta2Text, fontSize: 12, fontFamily: fonts[700] },
  label: {
    color: t.label, fontSize: 11.5, fontFamily: fonts[700],
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12,
  },
  chip: {
    borderWidth: 1, borderColor: t.line, borderRadius: 999,
    paddingHorizontal: 16, height: 36, justifyContent: 'center', alignItems: 'center', marginRight: 8,
  },
  chipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  chipText: { color: t.muted, fontSize: 13, fontFamily: fonts[700] },
  chipTextActive: { color: t.ctaText },
  input: {
    backgroundColor: t.card, borderRadius: 14, padding: 14,
    color: t.ink, fontSize: 14, marginBottom: 16,
    borderWidth: 1, borderColor: t.line, minHeight: 80,
  },
  videoPickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: t.line, marginBottom: 16,
  },
  videoPickerText: { color: t.muted, fontSize: 13, flex: 1 },
  searchInput: {
    backgroundColor: t.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    color: t.ink, fontSize: 14, marginBottom: 12,
    borderWidth: 1, borderColor: t.line,
  },
  generateBtn: {
    backgroundColor: t.ctaBg, borderRadius: 999, padding: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  generateText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 15, marginLeft: 8 },
  hint: { color: t.muted2, fontSize: 12, textAlign: 'center', marginTop: 12 },
  reportSection: { marginTop: 28 },
  reportBox: { backgroundColor: t.card, borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: t.cardBorder },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionBtn: {
    width: '47%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, paddingHorizontal: 12,
    borderRadius: 999, borderWidth: 1, borderColor: t.cta2Border,
  },
  actionText: { color: t.cta2Text, fontFamily: fonts[700], fontSize: 14 },
});

const makeShareStyles = (t: ThemeTokens) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  modal: { backgroundColor: t.sheet, borderRadius: 20, padding: 24, margin: 12, borderWidth: 1, borderColor: t.cardBorder },
  title: { color: t.ink, fontSize: 20, fontFamily: fonts[800], marginBottom: 16 },
  label: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 },
  targetRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  targetChip: { flex: 1, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: t.line, alignItems: 'center' },
  targetChipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  targetChipText: { color: t.muted, fontSize: 12, fontFamily: fonts[700] },
  targetChipTextActive: { color: t.ctaText },
  input: { backgroundColor: t.chip, borderRadius: 14, padding: 12, color: t.ink, fontSize: 14, marginBottom: 8, borderWidth: 1, borderColor: t.line },
  resultRow: { backgroundColor: t.chip, borderRadius: 14, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: t.cardBorder },
  resultName: { color: t.ink, fontFamily: fonts[600], fontSize: 14 },
  resultMeta: { color: t.muted, fontSize: 11, marginTop: 2 },
  selectedBadge: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: t.accentSoft, borderRadius: 14, padding: 12, borderWidth: 1.5, borderColor: t.accent, marginBottom: 8 },
  selectedName: { color: t.ink, fontFamily: fonts[700] },
  staffNote: { color: t.muted, fontSize: 12, marginBottom: 12, lineHeight: 18 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 999, borderWidth: 1, borderColor: t.cta2Border, alignItems: 'center' },
  cancelText: { color: t.cta2Text, fontFamily: fonts[700] },
  shareBtn: { flex: 1, padding: 14, borderRadius: 999, backgroundColor: t.ctaBg, alignItems: 'center' },
  shareBtnText: { color: t.ctaText, fontFamily: fonts[800] },
});
