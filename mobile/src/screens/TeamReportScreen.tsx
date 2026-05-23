import React, { useState, useEffect } from 'react';
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
import { mdToHtml, safeFileName } from '../utils/mdToHtml';
import { useFocusEffect } from '@react-navigation/native';
import { renderReport } from '../utils/renderReport';

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

  const buildFileName = () => {
    const typeLabel = outputType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return safeFileName(['Team Report', coach?.program_name ?? '', typeLabel].filter(Boolean).join(' - '));
  };

  const buildHtml = () => {
    if (!reportText) return '';
    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const typeLabel = outputType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<html><head><meta charset="utf-8"/><style>
      body { font-family: -apple-system, Helvetica, sans-serif; padding: 32px; color: #111; }
      h1 { font-size: 20px; margin-bottom: 4px; }
      p.meta { font-size: 13px; color: #555; margin-top: 0; }
      .footer { margin-top: 40px; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 12px; }
    </style></head><body>
      <h1>Team Report &mdash; ${escape(typeLabel)}</h1>
      <p class="meta">${escape(coach?.program_name ?? '')} &bull; ${new Date().toLocaleDateString()}</p>
      <div style="margin-top:12px">${mdToHtml(reportText)}</div>
      <div class="footer">Generated by BloomPrint Basketball Intelligence Model</div>
    </body></html>`;
  };

  const exportPdf = async () => {
    if (!reportText) return;
    setExporting(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: buildHtml() });
      const dest = FileSystem.cacheDirectory + buildFileName() + '.pdf';
      await FileSystem.copyAsync({ from: uri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: 'Share Team Report' });
    } catch (e: any) {
      Alert.alert('Export Error', e?.message ?? 'Could not export');
    } finally {
      setExporting(false);
    }
  };

  const printPdf = async () => {
    if (!reportText) return;
    try {
      await Print.printAsync({ html: buildHtml() });
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

  const submitShare = async () => {
    if (!reportText) return;
    setSharing(true);
    try {
      const data: any = {
        output_type: outputType,
        report_text: reportText,
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

  const searchStaff = async () => {
    if (!staffSearch.trim()) return;
    setStaffSearchLoading(true);
    try {
      const results = await coachesAPI.search(staffSearch.trim());
      setStaffResults(results);
    } catch {}
    setStaffSearchLoading(false);
  };

  const sendToStaff = async (target: any) => {
    if (!savedTeamReportId) return;
    setSendingStaff(true);
    try {
      await staffSharingAPI.share({
        report_type: 'team_report',
        report_id: savedTeamReportId,
        recipient_id: target.id,
        allow_regenerate: allowRegen,
      });
      Alert.alert('Shared!', `Report shared with ${target.name}.`);
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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0a0a0a' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Team Reports</Text>
          </View>
          <TouchableOpacity style={styles.importBtn} onPress={() => navigation.navigate('Import')}>
            <Ionicons name="cloud-upload-outline" size={18} color="#9ca3af" />
            <Text style={styles.importText}>Import Excel</Text>
          </TouchableOpacity>
        </View>

        {/* Game Reports (packet builder) */}
        <View style={{ marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={styles.label}>Game Reports</Text>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
              onPress={() => navigation.navigate('GameReportBuilder')}
            >
              <Ionicons name="add" size={14} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>New</Text>
            </TouchableOpacity>
          </View>
          {loadingGameReports ? (
            <ActivityIndicator color="#2563eb" size="small" />
          ) : gameReports.length === 0 ? (
            <TouchableOpacity
              style={{ borderWidth: 1, borderColor: '#374151', borderStyle: 'dashed', borderRadius: 12, padding: 20, alignItems: 'center', gap: 6 }}
              onPress={() => navigation.navigate('GameReportBuilder')}
            >
              <Ionicons name="albums-outline" size={28} color="#374151" />
              <Text style={{ color: '#6b7280', fontSize: 13 }}>Build your first game report packet</Text>
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
                  style={{ backgroundColor: '#111827', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: gr.report_text ? '#2563eb33' : '#1f2937', flexDirection: 'row', alignItems: 'center', gap: 12 }}
                  onPress={() => navigation.navigate('GameReportBuilder', { reportId: gr.id })}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{matchup}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>
                      {gr.output_type.replace(/_/g, ' ')} · {new Date(gr.updated_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {gr.report_text ? (
                      <View style={{ backgroundColor: '#1e3a5f', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ color: '#60a5fa', fontSize: 10, fontWeight: '700' }}>REPORT READY</Text>
                      </View>
                    ) : (
                      <View style={{ backgroundColor: '#1f2937', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ color: '#6b7280', fontSize: 10, fontWeight: '700' }}>IN PROGRESS</Text>
                      </View>
                    )}
                    <Text style={{ color: '#4b5563', fontSize: 10 }}>{(gr.clips?.length ?? 0)} clip{gr.clips?.length !== 1 ? 's' : ''}</Text>
                  </View>
                  <TouchableOpacity onPress={deleteGameReport} style={{ padding: 4, marginLeft: 4 }}>
                    <Ionicons name="trash-outline" size={16} color="#4b5563" />
                  </TouchableOpacity>
                  <Ionicons name="chevron-forward" size={16} color="#374151" />
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
          <Ionicons name={showQuickReport ? 'chevron-up' : 'chevron-down'} size={16} color="#6b7280" />
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
          {OUTPUT_TYPES.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[styles.chip, outputType === t.key && styles.chipActive]}
              onPress={() => setOutputType(t.key)}
            >
              <Text style={[styles.chipText, outputType === t.key && styles.chipTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.label}>Coach Focus (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Upcoming tournament, defensive scheme, recruiting eval..."
          placeholderTextColor="#4b5563"
          value={focusPrompt}
          onChangeText={setFocusPrompt}
          multiline
          textAlignVertical="top"
          onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)}
        />

        <Text style={styles.label}>Upload Footage (optional)</Text>
        <TouchableOpacity style={styles.videoPickerBtn} onPress={pickVideo}>
          <Ionicons name={videoAsset ? 'videocam' : 'videocam-outline'} size={18} color={videoAsset ? '#16a34a' : '#9ca3af'} />
          <Text style={[styles.videoPickerText, videoAsset && { color: '#16a34a' }]}>
            {videoAsset ? videoAsset.name.slice(-30) : 'Pick a video for visual context...'}
          </Text>
          {videoAsset && (
            <TouchableOpacity onPress={() => setVideoAsset(null)}>
              <Ionicons name="close-circle" size={18} color="#6b7280" />
            </TouchableOpacity>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.generateBtn} onPress={generate} disabled={generating}>
          {generating
            ? <><ActivityIndicator color="#fff" /><Text style={styles.generateText}>  Generating...</Text></>
            : <><Ionicons name="people" size={18} color="#fff" /><Text style={styles.generateText}>  Generate Team Report</Text></>
          }
        </TouchableOpacity>

        {generating && (
          <Text style={styles.hint}>Analyzing roster and generating report. This may take 20–40 seconds.</Text>
        )}

        {reportText && (
          <View style={styles.reportSection}>
            <Text style={styles.label}>Team Report</Text>
            <View style={styles.reportBox}>
              {renderReport(reportText)}
            </View>
            <View style={styles.actionGrid}>
              <TouchableOpacity style={styles.actionBtn} onPress={exportPdf} disabled={exporting}>
                {exporting
                  ? <ActivityIndicator color="#9ca3af" size="small" />
                  : <Ionicons name="share-outline" size={20} color="#9ca3af" />}
                <Text style={styles.actionText}>Export PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={printPdf}>
                <Ionicons name="print-outline" size={20} color="#9ca3af" />
                <Text style={styles.actionText}>Print</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { borderColor: '#16a34a' }]} onPress={() => setShowShare(true)}>
                <Ionicons name="person-add-outline" size={20} color="#16a34a" />
                <Text style={[styles.actionText, { color: '#16a34a' }]}>Share</Text>
              </TouchableOpacity>
              {savedTeamReportId && (
                <TouchableOpacity style={[styles.actionBtn, { borderColor: '#7c3aed' }]} onPress={() => { setShowStaffShare(true); setStaffSearch(''); setStaffResults([]); }}>
                  <Ionicons name="people-outline" size={20} color="#7c3aed" />
                  <Text style={[styles.actionText, { color: '#7c3aed' }]}>Staff</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.actionBtn} onPress={() => { setReportText(null); setFocusPrompt(''); setSelectedTeamId(null); setVideoAsset(null); setSavedTeamReportId(null); }}>
                <Ionicons name="add-circle-outline" size={20} color="#9ca3af" />
                <Text style={styles.actionText}>New Report</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        </>)}

        {/* Previous Team Reports */}
        <TouchableOpacity
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: showPrevReports ? 12 : 0 }}
          onPress={() => {
            if (!showPrevReports) loadPrevReports();
            setShowPrevReports(v => !v);
          }}
        >
          <Text style={styles.label}>Previous Reports</Text>
          <Ionicons name={showPrevReports ? 'chevron-up' : 'chevron-down'} size={16} color="#6b7280" />
        </TouchableOpacity>

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
            {loadingPrevReports ? (
              <ActivityIndicator color="#2563eb" size="small" />
            ) : prevReports.filter(r => prevReportFilter === 'all' || r.output_type === prevReportFilter).length === 0 ? (
              <Text style={{ color: '#4b5563', fontSize: 13, textAlign: 'center', paddingVertical: 16 }}>No team reports yet.</Text>
            ) : (
              prevReports
                .filter(r => prevReportFilter === 'all' || r.output_type === prevReportFilter)
                .map((r: any) => (
                  <TouchableOpacity
                    key={r.id}
                    style={{ backgroundColor: '#111827', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#1f2937' }}
                    onPress={() => openPrevReport(r)}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ backgroundColor: '#1e3a5f', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ color: '#60a5fa', fontSize: 10, fontWeight: '700' }}>
                          {OUTPUT_TYPES.find(t => t.key === r.output_type)?.label ?? r.output_type}
                        </Text>
                      </View>
                      <Text style={{ color: '#4b5563', fontSize: 11 }}>{new Date(r.created_at).toLocaleDateString()}</Text>
                    </View>
                    {r.report_text ? (
                      <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 8, lineHeight: 18 }} numberOfLines={2}>
                        {r.report_text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim().slice(0, 100)}...
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                      <Ionicons name="chevron-forward" size={12} color="#374151" />
                      <Text style={{ color: '#374151', fontSize: 11 }}>Tap to view full report</Text>
                    </View>
                  </TouchableOpacity>
                ))
            )}
          </>
        )}
      </ScrollView>

      {/* Previous Report Detail Modal */}
      <Modal visible={!!selectedPrevReport} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={{ backgroundColor: '#111827', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, flex: 1, marginTop: 60 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>
                  {OUTPUT_TYPES.find(t => t.key === selectedPrevReport?.output_type)?.label ?? selectedPrevReport?.output_type}
                </Text>
                <Text style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>
                  {selectedPrevReport ? new Date(selectedPrevReport.created_at).toLocaleDateString() : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedPrevReport(null)}>
                <Ionicons name="close" size={22} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
              {selectedPrevReport?.report_text ? (
                renderReport(selectedPrevReport.report_text)
              ) : (
                <Text style={{ color: '#6b7280' }}>No report content.</Text>
              )}

              {/* Corrections section */}
              {prevReportCorrections.length > 0 && (
                <View style={{ marginTop: 20 }}>
                  <Text style={styles.label}>Corrections ({prevReportCorrections.length})</Text>
                  {prevReportCorrections.map((c: any) => (
                    <View key={c.id} style={{ backgroundColor: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 6, opacity: c.applied ? 0.55 : 1 }}>
                      <Text style={{ color: '#d1d5db', fontSize: 13 }}>{c.correction}</Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                        <Text style={{ color: '#4b5563', fontSize: 11 }}>{new Date(c.created_at).toLocaleDateString()}</Text>
                        {c.applied && <Text style={{ color: '#16a34a', fontSize: 10, fontWeight: '700' }}>APPLIED</Text>}
                      </View>
                    </View>
                  ))}
                  {prevReportCorrections.some((c: any) => !c.applied) && (
                    <TouchableOpacity
                      style={{ backgroundColor: '#2563eb', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 }}
                      onPress={regeneratePrevReport}
                      disabled={regeneratingPrevReport}
                    >
                      {regeneratingPrevReport
                        ? <ActivityIndicator color="#fff" />
                        : <Text style={{ color: '#fff', fontWeight: '700' }}>Apply & Regenerate</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Add correction */}
              <View style={{ marginTop: 20 }}>
                <Text style={styles.label}>Add Correction</Text>
                <TextInput
                  style={{ backgroundColor: '#1f2937', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, borderWidth: 1, borderColor: '#374151', minHeight: 80, marginBottom: 8 }}
                  placeholder="What needs to be corrected in this report?"
                  placeholderTextColor="#4b5563"
                  value={prevReportCorrectionText}
                  onChangeText={setPrevReportCorrectionText}
                  multiline
                  textAlignVertical="top"
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#2563eb', borderRadius: 10, padding: 14, alignItems: 'center' }}
                    onPress={() => addPrevReportCorrection(true)}
                    disabled={addingPrevCorrection || regeneratingPrevReport || !prevReportCorrectionText.trim()}
                  >
                    {addingPrevCorrection || regeneratingPrevReport
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={{ color: '#fff', fontWeight: '700' }}>Apply & Regenerate</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#374151', borderRadius: 10, padding: 14, alignItems: 'center' }}
                    onPress={() => addPrevReportCorrection(false)}
                    disabled={addingPrevCorrection || !prevReportCorrectionText.trim()}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Save for Later</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Share with Staff Modal */}
      <Modal visible={showStaffShare} transparent animationType="slide">
        <KeyboardAvoidingView style={shareStyles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={shareStyles.modal}>
            <Text style={shareStyles.title}>Share with Staff</Text>
            <Text style={shareStyles.label}>Allow Regenerate</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, backgroundColor: '#1f2937', borderRadius: 8, padding: 12 }}>
              <Text style={{ color: '#d1d5db', fontSize: 13 }}>Allow recipient to regenerate</Text>
              <TouchableOpacity
                onPress={() => setAllowRegen(v => !v)}
                style={{ width: 40, height: 22, borderRadius: 11, backgroundColor: allowRegen ? '#7c3aed' : '#374151', justifyContent: 'center', paddingHorizontal: 2 }}
              >
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignSelf: allowRegen ? 'flex-end' : 'flex-start' }} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              <TextInput
                style={[shareStyles.input, { flex: 1 }]}
                placeholder="Search coach/program name..."
                placeholderTextColor="#4b5563"
                value={staffSearch}
                onChangeText={setStaffSearch}
              />
              <TouchableOpacity
                style={{ backgroundColor: '#7c3aed', borderRadius: 10, padding: 12, justifyContent: 'center' }}
                onPress={searchStaff}
              >
                {staffSearchLoading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="search" size={18} color="#fff" />}
              </TouchableOpacity>
            </View>
            {staffResults.map((r: any) => (
              <TouchableOpacity key={r.id} style={shareStyles.resultRow} onPress={() => sendToStaff(r)} disabled={sendingStaff}>
                <Text style={shareStyles.resultName}>{r.name}</Text>
                <Text style={shareStyles.resultMeta}>{r.role} · {r.program_name}</Text>
              </TouchableOpacity>
            ))}
            <View style={shareStyles.btnRow}>
              <TouchableOpacity style={shareStyles.cancelBtn} onPress={() => setShowStaffShare(false)}>
                <Text style={shareStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Share Modal */}
      <Modal visible={showShare} transparent animationType="slide">
        <KeyboardAvoidingView style={shareStyles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={shareStyles.modal}>
            <Text style={shareStyles.title}>Share Team Report</Text>

            {/* Target type selector */}
            <Text style={shareStyles.label}>Send To</Text>
            <View style={shareStyles.targetRow}>
              {([['player', 'Individual Player'], ['team', 'Whole Team'], ['all_staff', 'All Staff']] as const).map(([key, label]) => (
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
                  <TextInput
                    style={[shareStyles.input, { flex: 1 }]}
                    placeholder="Search player name..."
                    placeholderTextColor="#4b5563"
                    value={shareSearch}
                    onChangeText={setShareSearch}
                  />
                  <TouchableOpacity
                    style={{ backgroundColor: '#2563eb', borderRadius: 10, padding: 12, justifyContent: 'center' }}
                    onPress={searchPlayers}
                  >
                    {shareSearchLoading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="search" size={18} color="#fff" />}
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
                {teams.map((t: any) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[shareStyles.resultRow, selectedShareTarget?.id === t.id && { borderColor: '#16a34a' }]}
                    onPress={() => setSelectedShareTarget(t)}
                  >
                    <Text style={shareStyles.resultName}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Selected target badge */}
            {selectedShareTarget && (
              <View style={shareStyles.selectedBadge}>
                <Text style={shareStyles.selectedName}>{selectedShareTarget.name}</Text>
                <TouchableOpacity onPress={() => setSelectedShareTarget(null)}>
                  <Ionicons name="close-circle" size={18} color="#9ca3af" />
                </TouchableOpacity>
              </View>
            )}

            {shareTarget === 'all_staff' && !selectedShareTarget && (
              <View style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                  <TextInput
                    style={[shareStyles.input, { flex: 1 }]}
                    placeholder="Search coach/program name..."
                    placeholderTextColor="#4b5563"
                    value={shareSearch}
                    onChangeText={setShareSearch}
                  />
                  <TouchableOpacity
                    style={{ backgroundColor: '#2563eb', borderRadius: 10, padding: 12, justifyContent: 'center' }}
                    onPress={searchPlayers}
                  >
                    {shareSearchLoading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="search" size={18} color="#fff" />}
                  </TouchableOpacity>
                </View>
                {shareResults.map((r: any) => (
                  <TouchableOpacity key={r.id} style={shareStyles.resultRow} onPress={() => { setSelectedShareTarget(r); setShareResults([]); }}>
                    <Text style={shareStyles.resultName}>{r.name}</Text>
                    <Text style={shareStyles.resultMeta}>{r.role} · {r.program_name}</Text>
                  </TouchableOpacity>
                ))}
                <Text style={{ color: '#4b5563', fontSize: 11, marginTop: 4 }}>Search to find a specific staff member, or leave empty to notify all staff.</Text>
              </View>
            )}

            <TextInput
              style={[shareStyles.input, { marginTop: 8 }]}
              placeholder="Add a message (optional)..."
              placeholderTextColor="#4b5563"
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
                {sharing ? <ActivityIndicator color="#fff" /> : <Text style={shareStyles.shareBtnText}>Send</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 20, paddingTop: 56 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 28 },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', marginBottom: 4 },
  sub: { color: '#6b7280', fontSize: 13 },
  importBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: '#374151', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, marginTop: 4,
  },
  importText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  label: {
    color: '#9ca3af', fontSize: 11, fontWeight: '700',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10,
  },
  chip: {
    borderWidth: 1, borderColor: '#374151', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, marginRight: 8,
  },
  chipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  input: {
    backgroundColor: '#111827', borderRadius: 10, padding: 14,
    color: '#fff', fontSize: 14, marginBottom: 16,
    borderWidth: 1, borderColor: '#1f2937', minHeight: 80,
  },
  videoPickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#111827', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#1f2937', marginBottom: 16,
  },
  videoPickerText: { color: '#9ca3af', fontSize: 13, flex: 1 },
  generateBtn: {
    backgroundColor: '#2563eb', borderRadius: 12, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  generateText: { color: '#fff', fontWeight: '700', fontSize: 16, marginLeft: 8 },
  hint: { color: '#4b5563', fontSize: 12, textAlign: 'center', marginTop: 12 },
  reportSection: { marginTop: 28 },
  reportBox: { backgroundColor: '#111827', borderRadius: 12, padding: 16, marginBottom: 12 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionBtn: {
    width: '47%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1, borderColor: '#374151',
  },
  actionText: { color: '#9ca3af', fontWeight: '600', fontSize: 14 },
});

const shareStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#111827', borderRadius: 20, padding: 24, margin: 12 },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 16 },
  label: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  targetRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  targetChip: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#374151', alignItems: 'center' },
  targetChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  targetChipText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  targetChipTextActive: { color: '#fff' },
  input: { backgroundColor: '#1f2937', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, marginBottom: 8 },
  resultRow: { backgroundColor: '#1f2937', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#374151' },
  resultName: { color: '#fff', fontWeight: '600', fontSize: 14 },
  resultMeta: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  selectedBadge: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#16a34a22', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#16a34a', marginBottom: 8 },
  selectedName: { color: '#fff', fontWeight: '700' },
  staffNote: { color: '#6b7280', fontSize: 12, marginBottom: 12, lineHeight: 18 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#374151', alignItems: 'center' },
  cancelText: { color: '#9ca3af', fontWeight: '600' },
  shareBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#16a34a', alignItems: 'center' },
  shareBtnText: { color: '#fff', fontWeight: '700' },
});
