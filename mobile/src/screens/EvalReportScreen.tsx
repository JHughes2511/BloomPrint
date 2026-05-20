import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert, Modal, Switch, KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import Markdown from 'react-native-markdown-display';
import { evalsAPI, playersAPI, playerAPI } from '../api/client';
import { Evaluation, Correction, Player } from '../types';
import { GradeBadge } from '../components/GradeBadge';
import { PillarCard } from '../components/PillarCard';
import { mdToHtml, safeFileName } from '../utils/mdToHtml';

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

const PILLARS = [
  'offensive_skills', 'defensive_capabilities', 'physical_attributes',
  'intangibles', 'advanced_analysis', 'strategic_fit',
];

const PILLAR_LABELS: Record<string, string> = {
  offensive_skills: 'Offensive Skills',
  defensive_capabilities: 'Defense',
  physical_attributes: 'Physical',
  intangibles: 'Intangibles',
  advanced_analysis: 'Advanced',
  strategic_fit: 'Strategic Fit',
};

const EXPORT_CATEGORIES = [
  { key: 'grades',     label: 'Overall Grade + Pillar Grades' },
  { key: 'flags',      label: 'Green Flags & Watch Flags' },
  { key: 'questions',  label: 'Key Questions' },
  { key: 'report',     label: 'Full Report' },
  { key: 'corrections', label: 'Coach Corrections' },
];

export default function EvalReportScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { evalId } = route.params;

  const [ev, setEv] = useState<Evaluation | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);

  // Correction modal
  const [showCorrect, setShowCorrect] = useState(false);
  const [selectedPillar, setSelectedPillar] = useState('');
  const [correctionText, setCorrectionText] = useState('');
  const [saving, setSaving] = useState(false);

  // Player detail popup
  const [showPlayerDetail, setShowPlayerDetail] = useState(false);

  // Export modal
  const [showExport, setShowExport] = useState(false);
  const [exportCats, setExportCats] = useState<Record<string, boolean>>({
    grades: true, flags: true, questions: true, report: true, corrections: false,
  });
  const [exporting, setExporting] = useState(false);

  // Share with player modal
  const [showShare, setShowShare] = useState(false);
  const [shareSearch, setShareSearch] = useState('');
  const [shareResults, setShareResults] = useState<any[]>([]);
  const [selectedPlayerUser, setSelectedPlayerUser] = useState<any | null>(null);
  const [shareMessage, setShareMessage] = useState('');
  const [shareCats, setShareCats] = useState({
    share_report_text: true, share_grades: false,
    share_flags: false, share_questions: false,
  });
  const [sharing, setSharing] = useState(false);
  const [shareSearchLoading, setShareSearchLoading] = useState(false);

  useEffect(() => {
    Promise.all([evalsAPI.get(evalId), evalsAPI.corrections(evalId)])
      .then(async ([e, c]) => {
        setEv(e);
        setCorrections(c);
        try { setPlayer(await playersAPI.get(e.player_id)); } catch {}
      })
      .finally(() => setLoading(false));
  }, [evalId]);

  const searchPlayerUsers = async () => {
    if (!shareSearch.trim()) return;
    setShareSearchLoading(true);
    try {
      const results = await playerAPI.searchPlayerUsers(shareSearch.trim());
      setShareResults(results);
    } catch {}
    setShareSearchLoading(false);
  };

  const submitShare = async () => {
    if (!selectedPlayerUser) return;
    setSharing(true);
    try {
      await playerAPI.share(evalId, {
        player_user_id: selectedPlayerUser.id,
        share_report_text: shareCats.share_report_text,
        share_grades: shareCats.share_grades,
        share_flags: shareCats.share_flags,
        share_questions: shareCats.share_questions,
        message: shareMessage.trim() || null,
      });
      Alert.alert('Shared!', `Report shared with ${selectedPlayerUser.name}.`);
      setShowShare(false);
      setSelectedPlayerUser(null);
      setShareSearch('');
      setShareResults([]);
      setShareMessage('');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not share report');
    } finally {
      setSharing(false);
    }
  };

  const buildFileName = () => {
    if (!ev) return 'Evaluation Report';
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9 \-]/g, '').trim();
    const type = ev.output_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const name = sanitize(player?.name ?? 'Player');
    const team = sanitize(player?.team_name ?? player?.program_name ?? '');
    const pos  = sanitize(player?.position ?? '');
    return ['Evaluation Report', name, team, pos, type].filter(Boolean).join(' - ');
  };

  const submitCorrection = async () => {
    if (!correctionText.trim()) return;
    setSaving(true);
    try {
      const c = await evalsAPI.addCorrection(evalId, {
        pillar: selectedPillar || undefined,
        correction: correctionText,
      });
      setCorrections(prev => [...prev, c]);
      setShowCorrect(false);
      setCorrectionText(''); setSelectedPillar('');
      // Apply all corrections to update the report text via AI
      try {
        const updated = await evalsAPI.applyCorrections(evalId);
        setEv((prev: any) => prev ? { ...prev, report_text: updated.report_text } : prev);
      } catch {}
      Alert.alert('Updated', 'Evaluation sharpened based on your correction.');
    } catch {
      Alert.alert('Error', 'Could not save correction');
    } finally {
      setSaving(false);
    }
  };

  const buildHtml = (cats: Record<string, boolean>) => {
    if (!ev) return '<html><body><p>No data</p></body></html>';
    const date = new Date(ev.created_at).toLocaleDateString();
    const type = ev.output_type.replace(/_/g, ' ').toUpperCase();
    const sanitize = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let body = `<h1>BloomPrint &mdash; ${type}</h1>
      <p style="color:#555;margin-top:0">${sanitize(ev.competition_level ?? '')} &bull; ${date}</p>`;

    if (cats.grades && ev.overall_grade != null) {
      body += `<h3>Overall Grade</h3><div class="grade">${ev.overall_grade.toFixed(1)} / 10</div>`;
      if (ev.pillar_grades) {
        body += `<h3>Pillar Grades</h3>`;
        PILLARS.filter(k => ev.pillar_grades![k] != null).forEach(k => {
          const g = ev.pillar_grades![k];
          const pct = Math.round((g / 10) * 100);
          body += `<table width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0">
            <tr><td style="font-size:13px">${PILLAR_LABELS[k]}</td><td align="right" style="font-size:13px"><strong>${g.toFixed(1)}</strong></td></tr>
            <tr><td colspan="2"><div style="background:#eee;border-radius:4px;height:8px;margin-top:3px">
              <div style="background:#2563eb;border-radius:4px;height:8px;width:${pct}%"></div></div></td></tr>
          </table>`;
        });
      }
    }

    if (cats.flags) {
      if (ev.green_flags?.length) {
        body += `<h3>Green Flags</h3>`;
        ev.green_flags.forEach(f => { body += `<p style="color:#16a34a;margin:3px 0">&#10003; ${sanitize(f)}</p>`; });
      }
      if (ev.watch_flags?.length) {
        body += `<h3>Watch Flags</h3>`;
        ev.watch_flags.forEach(f => { body += `<p style="color:#dc2626;margin:3px 0">&#9888; ${sanitize(f)}</p>`; });
      }
    }

    if (cats.questions && ev.key_questions?.length) {
      body += `<h3>Key Questions</h3><ol>`;
      ev.key_questions.forEach(q => { body += `<li style="font-size:13px;margin:4px 0">${sanitize(q)}</li>`; });
      body += `</ol>`;
    }

    if (cats.report && ev.report_text) {
      body += `<h3>Full Report</h3><div style="margin-top:8px">${mdToHtml(ev.report_text)}</div>`;
    }

    if (cats.corrections && corrections.length) {
      body += `<h3>Coach Corrections</h3>`;
      corrections.forEach(c => {
        const pillarLabel = c.pillar ? `<strong>${c.pillar.replace(/_/g, ' ').toUpperCase()}</strong><br/>` : '';
        body += `<div style="background:#f9fafb;border-left:3px solid #2563eb;padding:8px 12px;margin:6px 0;font-size:12px">${pillarLabel}${sanitize(c.correction)}</div>`;
      });
    }

    // Ensure body has content
    if (!body.includes('<h3>') && !body.includes('<div class="grade">')) {
      body += `<p style="color:#555">No sections selected for export.</p>`;
    }

    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
      body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 32px; color: #111; }
      h1 { font-size: 22px; margin-bottom: 4px; }
      h3 { font-size: 14px; border-bottom: 1px solid #eee; padding-bottom: 4px; margin-top: 24px; color: #333; }
      .grade { font-size: 48px; font-weight: 900; color: #2563eb; }
      p { margin: 6px 0; }
      ol { padding-left: 20px; }
    </style></head><body>${body}
      <div style="margin-top:40px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px">
        Generated by BloomPrint Basketball Intelligence Model
      </div>
    </body></html>`;
  };

  const exportReport = async () => {
    setExporting(true);
    try {
      const html = buildHtml(exportCats);
      const { uri } = await Print.printToFileAsync({ html });
      const dest = FileSystem.cacheDirectory + safeFileName(buildFileName()) + '.pdf';
      await FileSystem.copyAsync({ from: uri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: 'Share BIM Report' });
    } catch (e: any) {
      Alert.alert('Export Error', e?.message ?? 'Could not generate report');
    } finally {
      setExporting(false);
      setShowExport(false);
    }
  };

  const printPdf = async () => {
    try {
      await Print.printAsync({ html: buildHtml(exportCats) });
    } catch (e: any) {
      Alert.alert('Print Error', e?.message ?? 'Could not print report');
    } finally {
      setShowExport(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#2563eb" size="large" /></View>;
  if (!ev) return null;

  const hasPillars = ev.pillar_grades && Object.keys(ev.pillar_grades).length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>{ev.output_type.replace(/_/g, ' ').toUpperCase()}</Text>
          <Text style={styles.sub}>{new Date(ev.created_at).toLocaleDateString()}</Text>
        </View>
        <GradeBadge grade={ev.overall_grade} size="lg" />
      </View>

      {/* Player name — tap to see profile popup */}
      {player && (
        <TouchableOpacity
          style={styles.playerNameRow}
          onPress={() => setShowPlayerDetail(true)}
        >
          <Ionicons name="person-circle-outline" size={18} color="#2563eb" />
          <Text style={styles.playerNameLink}>{player.name}</Text>
          {player.position ? <Text style={styles.playerPos}>{player.position}</Text> : null}
          <Ionicons name="chevron-forward" size={13} color="#2563eb" />
        </TouchableOpacity>
      )}

      {/* Player detail modal */}
      <Modal visible={showPlayerDetail} animationType="slide" transparent>
        <View style={styles.pdOverlay}>
          <View style={styles.pdBox}>
            <View style={styles.pdHeader}>
              <Text style={styles.pdName}>{player?.name}</Text>
              <TouchableOpacity onPress={() => setShowPlayerDetail(false)}>
                <Ionicons name="close" size={22} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <View style={styles.pdRow}>
              {player?.position ? (
                <View style={styles.pdChip}><Text style={styles.pdChipText}>{player.position}</Text></View>
              ) : null}
              {player?.competition_level ? (
                <View style={styles.pdChip}><Text style={styles.pdChipText}>{player.competition_level}</Text></View>
              ) : null}
            </View>

            {(player?.height || player?.wingspan) ? (
              <View style={styles.pdMeasurements}>
                {player.height ? (
                  <View style={styles.pdStat}>
                    <Text style={styles.pdStatVal}>{player.height}</Text>
                    <Text style={styles.pdStatLabel}>Height</Text>
                  </View>
                ) : null}
                {player.wingspan ? (
                  <View style={styles.pdStat}>
                    <Text style={styles.pdStatVal}>{player.wingspan}</Text>
                    <Text style={styles.pdStatLabel}>Wingspan</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {(player?.program_name) ? (
              <Text style={styles.pdProgram}>{player.program_name}</Text>
            ) : null}

            <TouchableOpacity
              style={styles.pdProfileBtn}
              onPress={() => { setShowPlayerDetail(false); navigation.navigate('PlayerProfile', { playerId: ev!.player_id }); }}
            >
              <Ionicons name="person" size={15} color="#fff" />
              <Text style={styles.pdProfileBtnText}>View Full Profile</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Pillar grades */}
      {hasPillars && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Pillar Grades</Text>
          {PILLARS.filter(k => ev.pillar_grades![k] !== undefined).map(k => (
            <PillarCard key={k} pillarKey={k} grade={ev.pillar_grades![k]} />
          ))}
        </View>
      )}

      {/* Flags */}
      {(ev.green_flags?.length || ev.watch_flags?.length) ? (
        <View style={styles.flagRow}>
          {ev.green_flags && ev.green_flags.length > 0 && (
            <View style={[styles.flagBox, { borderColor: '#16a34a' }]}>
              <Text style={[styles.flagTitle, { color: '#22c55e' }]}>Green Flags</Text>
              {ev.green_flags.map((f, i) => <Text key={i} style={styles.flagItem}>· {f}</Text>)}
            </View>
          )}
          {ev.watch_flags && ev.watch_flags.length > 0 && (
            <View style={[styles.flagBox, { borderColor: '#dc2626' }]}>
              <Text style={[styles.flagTitle, { color: '#ef4444' }]}>Watch Flags</Text>
              {ev.watch_flags.map((f, i) => <Text key={i} style={styles.flagItem}>· {f}</Text>)}
            </View>
          )}
        </View>
      ) : null}

      {/* Key questions */}
      {ev.key_questions && ev.key_questions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Key Questions</Text>
          {ev.key_questions.map((q, i) => (
            <View key={i} style={styles.questionRow}>
              <Text style={styles.questionNum}>{i + 1}</Text>
              <Text style={styles.questionText}>{q}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Full report — rendered markdown */}
      {ev.report_text && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Full Report</Text>
          <View style={styles.reportBox}>
            <Markdown style={markdownStyles}>{cleanMarkdown(ev.report_text)}</Markdown>
          </View>
        </View>
      )}

      {/* Corrections */}
      {corrections.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Coach Corrections ({corrections.length})</Text>
          {corrections.map(c => (
            <View key={c.id} style={styles.correctionCard}>
              {c.pillar && <Text style={styles.correctionPillar}>{c.pillar.replace(/_/g, ' ').toUpperCase()}</Text>}
              <Text style={styles.correctionText}>{c.correction}</Text>
              <Text style={styles.correctionMeta}>{new Date(c.created_at).toLocaleDateString()}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowCorrect(true)}>
          <Ionicons name="create-outline" size={18} color="#9ca3af" />
          <Text style={styles.actionText}>Correct</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowExport(true)}>
          <Ionicons name="share-outline" size={18} color="#9ca3af" />
          <Text style={styles.actionText}>Export</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowExport(true)}>
          <Ionicons name="print-outline" size={18} color="#9ca3af" />
          <Text style={styles.actionText}>Print</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { borderColor: '#16a34a' }]} onPress={() => setShowShare(true)}>
          <Ionicons name="person-add-outline" size={18} color="#16a34a" />
          <Text style={[styles.actionText, { color: '#16a34a' }]}>Player</Text>
        </TouchableOpacity>
      </View>

      {/* Export modal */}
      <Modal visible={showExport} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Export Report</Text>
            <Text style={styles.modalSub}>Choose what to include:</Text>
            {EXPORT_CATEGORIES.map(cat => (
              <View key={cat.key} style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>{cat.label}</Text>
                <Switch
                  value={exportCats[cat.key]}
                  onValueChange={v => setExportCats(prev => ({ ...prev, [cat.key]: v }))}
                  trackColor={{ true: '#2563eb' }}
                  thumbColor="#fff"
                />
              </View>
            ))}
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowExport(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#374151' }]} onPress={printPdf} disabled={exporting}>
                <Text style={styles.saveText}>Print</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={exportReport} disabled={exporting}>
                {exporting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.saveText}>Share PDF</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Share with Player modal */}
      <Modal visible={showShare} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Share with Player</Text>
            <Text style={styles.modalSub}>Search for a player account and share this report.</Text>

            {selectedPlayerUser ? (
              <View style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#16a34a22', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#16a34a' }}>
                  <View>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>{selectedPlayerUser.name}</Text>
                    {selectedPlayerUser.linked_player && <Text style={{ color: '#16a34a', fontSize: 11 }}>→ {selectedPlayerUser.linked_player}</Text>}
                  </View>
                  <TouchableOpacity onPress={() => setSelectedPlayerUser(null)}>
                    <Ionicons name="close-circle" size={20} color="#9ca3af" />
                  </TouchableOpacity>
                </View>
                <Text style={[styles.label, { marginTop: 12 }]}>Include in Share</Text>
                {[
                  { key: 'share_report_text', label: 'Full Report' },
                  { key: 'share_grades', label: 'Grades' },
                  { key: 'share_flags', label: 'Flags' },
                  { key: 'share_questions', label: 'Key Questions' },
                ].map(cat => (
                  <View key={cat.key} style={styles.toggleRow}>
                    <Text style={styles.toggleLabel}>{cat.label}</Text>
                    <Switch
                      value={shareCats[cat.key as keyof typeof shareCats]}
                      onValueChange={v => setShareCats(prev => ({ ...prev, [cat.key]: v }))}
                      trackColor={{ true: '#16a34a' }}
                      thumbColor="#fff"
                    />
                  </View>
                ))}
                <Text style={styles.label}>Message (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Add a message to the player..."
                  placeholderTextColor="#4b5563"
                  value={shareMessage}
                  onChangeText={setShareMessage}
                  multiline
                />
              </View>
            ) : (
              <View style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder="Search player name..."
                    placeholderTextColor="#4b5563"
                    value={shareSearch}
                    onChangeText={setShareSearch}
                  />
                  <TouchableOpacity
                    style={{ backgroundColor: '#2563eb', borderRadius: 10, padding: 14, alignItems: 'center', justifyContent: 'center' }}
                    onPress={searchPlayerUsers}
                    disabled={shareSearchLoading}
                  >
                    {shareSearchLoading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="search" size={18} color="#fff" />}
                  </TouchableOpacity>
                </View>
                {shareResults.map((pu: any) => (
                  <TouchableOpacity
                    key={pu.id}
                    style={{ backgroundColor: '#1f2937', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#374151' }}
                    onPress={() => { setSelectedPlayerUser(pu); setShareResults([]); }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '600' }}>{pu.name}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 11 }}>{pu.email}{pu.linked_player ? ` · ${pu.linked_player}` : ''}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowShare(false); setSelectedPlayerUser(null); setShareResults([]); }}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              {selectedPlayerUser && (
                <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#16a34a' }]} onPress={submitShare} disabled={sharing}>
                  {sharing ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Share</Text>}
                </TouchableOpacity>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Correction modal */}
      <Modal visible={showCorrect} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Add Correction</Text>
            <Text style={styles.modalSub}>Sharpen this evaluation by noting what needs to be corrected.</Text>
            <Text style={styles.label}>Pillar (optional)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {['', ...PILLARS].map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.pillarChip, selectedPillar === p && styles.pillarChipActive]}
                  onPress={() => setSelectedPillar(p)}
                >
                  <Text style={[styles.pillarChipText, selectedPillar === p && { color: '#fff' }]}>
                    {p ? PILLAR_LABELS[p] : 'General'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.label}>Your Correction</Text>
            <TextInput
              style={[styles.input, { height: 100 }]}
              placeholder="What needs to be corrected in this report?"
              placeholderTextColor="#4b5563"
              value={correctionText}
              onChangeText={setCorrectionText}
              multiline
              textAlignVertical="top"
              autoFocus
            />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCorrect(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={submitCorrection} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const markdownStyles = {
  body: { color: '#d1d5db', fontSize: 13, lineHeight: 22 },
  heading1: { color: '#ffffff', fontSize: 16, fontWeight: '800' as const, marginTop: 16, marginBottom: 4 },
  heading2: { color: '#e5e7eb', fontSize: 14, fontWeight: '700' as const, marginTop: 14, marginBottom: 4 },
  heading3: { color: '#9ca3af', fontSize: 13, fontWeight: '700' as const, marginTop: 12, marginBottom: 2 },
  strong: { color: '#ffffff', fontWeight: '700' as const },
  em: { color: '#93c5fd' },
  bullet_list: { marginLeft: 8 },
  list_item: { color: '#d1d5db', fontSize: 13 },
  hr: { backgroundColor: '#1f2937', height: 1, marginVertical: 12 },
  blockquote: { backgroundColor: '#1f2937', borderLeftColor: '#2563eb', paddingLeft: 12 },
  code_inline: { backgroundColor: '#1f2937', color: '#93c5fd', borderRadius: 4, paddingHorizontal: 4 },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56 },
  playerNameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginBottom: 12, backgroundColor: '#111827',
    borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#1f2937',
  },
  playerNameLink: { color: '#60a5fa', fontWeight: '700', fontSize: 15, flex: 1 },
  playerPos: { color: '#6b7280', fontSize: 12 },
  // Player detail modal
  pdOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  pdBox: { backgroundColor: '#111827', borderRadius: 20, padding: 24, margin: 8, paddingBottom: 36 },
  pdHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  pdName: { color: '#fff', fontSize: 22, fontWeight: '900', flex: 1 },
  pdRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  pdChip: { backgroundColor: '#1f2937', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  pdChipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  pdMeasurements: { flexDirection: 'row', gap: 16, marginBottom: 16 },
  pdStat: { alignItems: 'center', backgroundColor: '#1f2937', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20 },
  pdStatVal: { color: '#fff', fontSize: 20, fontWeight: '800' },
  pdStatLabel: { color: '#6b7280', fontSize: 11, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  pdProgram: { color: '#4b5563', fontSize: 13, marginBottom: 16 },
  pdProfileBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#2563eb', borderRadius: 12, padding: 14, marginTop: 4,
  },
  pdProfileBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  title: { color: '#fff', fontSize: 16, fontWeight: '900' },
  sub: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionLabel: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  flagRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 20 },
  flagBox: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 12 },
  flagTitle: { fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase' },
  flagItem: { color: '#d1d5db', fontSize: 12, marginBottom: 3 },
  questionRow: { flexDirection: 'row', marginBottom: 10, gap: 10 },
  questionNum: { color: '#2563eb', fontWeight: '800', fontSize: 14, width: 20 },
  questionText: { color: '#d1d5db', fontSize: 13, flex: 1, lineHeight: 20 },
  reportBox: { backgroundColor: '#111827', borderRadius: 12, padding: 16 },
  correctionCard: { backgroundColor: '#111827', borderRadius: 10, padding: 14, marginBottom: 8 },
  correctionPillar: { color: '#2563eb', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  correctionText: { color: '#fff', fontSize: 13 },
  correctionMeta: { color: '#4b5563', fontSize: 11, marginTop: 6 },
  actionRow: { flexDirection: 'row', margin: 20, gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#374151',
  },
  actionText: { color: '#9ca3af', fontWeight: '600', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#111827', borderRadius: 20, padding: 24, margin: 12 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 4 },
  modalSub: { color: '#6b7280', fontSize: 12, marginBottom: 16 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  toggleLabel: { color: '#d1d5db', fontSize: 14 },
  label: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  pillarChip: { borderWidth: 1, borderColor: '#374151', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 6 },
  pillarChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  pillarChipText: { color: '#9ca3af', fontSize: 12 },
  input: { backgroundColor: '#1f2937', borderRadius: 10, padding: 14, color: '#fff', fontSize: 14, marginBottom: 12 },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#374151', alignItems: 'center' },
  cancelText: { color: '#9ca3af', fontWeight: '600' },
  saveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#2563eb', alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700' },
});
