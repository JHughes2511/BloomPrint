import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, Alert, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import VoiceTextInput from './VoiceTextInput';
import { playerAPI, teamsAPI, staffSharingAPI } from '../api/client';
import { splitReportSections, joinReportSections } from '../utils/mdToHtml';

type Target = 'player' | 'team' | 'all_staff';

export type ShareModalProps = {
  visible: boolean;
  onClose: () => void;
  reportType: string;   // staff-share report_type: eval | game | team_report | training | team_training
  reportId: number;
  outputType: string;   // label for player-facing copy, e.g. coaching_report
  reportText: string;   // full report text (section filtering + player payload)
  title?: string;       // optional heading label shown in the modal subtitle
};

export default function ShareModal({
  visible, onClose, reportType, reportId, outputType, reportText, title,
}: ShareModalProps) {
  const [target, setTarget] = useState<Target>('player');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [teams, setTeams] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null); // selected player user / team / staff target
  const [allowRegen, setAllowRegen] = useState(false);
  const [sectionToggles, setSectionToggles] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);

  const sections = splitReportSections(reportText ?? '');

  // Reset state whenever the modal is (re)opened
  useEffect(() => {
    if (visible) {
      setTarget('player');
      setSearch('');
      setResults([]);
      setSelected(null);
      setAllowRegen(false);
      setSectionToggles(Object.fromEntries(splitReportSections(reportText ?? '').map(s => [s.heading, true])));
      teamsAPI.list().then(setTeams).catch(() => {});
    }
  }, [visible, reportText]);

  // Clear selection/results when switching target tab
  useEffect(() => {
    setSelected(null);
    setResults([]);
    setSearch('');
  }, [target]);

  const runSearch = async () => {
    if (!search.trim()) return;
    setSearchLoading(true);
    try {
      if (target === 'all_staff') {
        setResults(await staffSharingAPI.searchTargets(search.trim()));
      } else {
        setResults(await playerAPI.searchPlayerUsers(search.trim()));
      }
    } catch {}
    setSearchLoading(false);
  };

  const filteredText = () => joinReportSections(sections, sectionToggles) || reportText;

  // Section toggles are available on every target; for staff they only apply in
  // frozen mode (regenerate OFF — a regenerable copy is always the full report).
  const showSectionToggles = sections.length > 1 && !(target === 'all_staff' && allowRegen);

  const canSend = () => {
    if (target === 'team') return !!selected;
    return !!selected;
  };

  const doSend = async () => {
    if (!canSend()) return;
    setSending(true);
    try {
      if (target === 'all_staff') {
        const frozen = !allowRegen ? filteredText() : undefined;
        const res = await staffSharingAPI.shareGroup({
          report_type: reportType,
          report_id: reportId,
          kind: selected.kind,
          coach_id: selected.coach_id ?? undefined,
          team_id: selected.team_id ?? undefined,
          program_name: selected.program_name ?? undefined,
          allow_regenerate: allowRegen,
          frozen_text: frozen,
        });
        Alert.alert('Shared!', `Report shared with ${res.shared_count ?? 1} staff member(s).`);
      } else {
        const res = await playerAPI.shareTeamReport({
          output_type: outputType,
          report_text: filteredText(),
          target_type: target,
          player_user_id: target === 'player' ? selected.id : undefined,
          team_id: target === 'team' ? selected.id : undefined,
        });
        const n = res.shared_count ?? 1;
        Alert.alert('Shared!', target === 'team'
          ? `Report shared with ${n} player(s) on ${selected.name}.`
          : `Report shared with ${selected.name ?? 'player'}.`);
      }
      onClose();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not share report');
    } finally {
      setSending(false);
    }
  };

  const targetLabel = (s: any): string => {
    if (target === 'all_staff') return s.label;
    if (target === 'team') return s.name;
    return s.name ?? s.linked_player_name ?? 'Player';
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
      >
        <View style={styles.box}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Share Report</Text>
              {!!title && <Text style={styles.headerSub} numberOfLines={1}>{title}</Text>}
            </View>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          {/* Target selector */}
          <View style={styles.targetRow}>
            {([['player', 'Individual Player'], ['team', 'Whole Team'], ['all_staff', 'All Staff']] as const).map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.targetChip, target === key && styles.targetChipActive]}
                onPress={() => setTarget(key)}
              >
                <Text style={[styles.targetChipText, target === key && styles.targetChipTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Whole Team — pick from your teams */}
            {target === 'team' ? (
              <>
                <Text style={styles.label}>Select a Team</Text>
                {teams.length === 0 && <Text style={styles.empty}>No teams found.</Text>}
                {teams.map(t => (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.row, selected?.id === t.id && styles.rowActive]}
                    onPress={() => setSelected(t)}
                  >
                    <Text style={styles.rowTitle}>{t.name}</Text>
                    {selected?.id === t.id && <Ionicons name="checkmark-circle" size={18} color="#7c3aed" />}
                  </TouchableOpacity>
                ))}
              </>
            ) : (
              <>
                {/* Player or Staff — search */}
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                  <VoiceTextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder={target === 'all_staff'
                      ? 'Search coach, team, or program name...'
                      : 'Search player name...'}
                    placeholderTextColor="#6b7280"
                    value={search}
                    onChangeText={setSearch}
                  />
                  <TouchableOpacity style={styles.searchBtn} onPress={runSearch} disabled={searchLoading}>
                    {searchLoading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="search" size={18} color="#fff" />}
                  </TouchableOpacity>
                </View>
                {target === 'all_staff' && (
                  <Text style={styles.hint}>
                    Search a team or program name to reach every connected staff member at once.
                  </Text>
                )}
                {results.map((r: any, i: number) => {
                  const isSel = target === 'all_staff'
                    ? selected && selected.kind === r.kind && selected.coach_id === r.coach_id && selected.team_id === r.team_id && selected.program_name === r.program_name
                    : selected?.id === r.id;
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[styles.row, isSel && styles.rowActive]}
                      onPress={() => setSelected(r)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>{targetLabel(r)}</Text>
                        {target === 'all_staff'
                          ? !!r.sublabel && <Text style={styles.rowSub}>{r.sublabel}</Text>
                          : !!(r.linked_player || r.email) && <Text style={styles.rowSub}>{r.linked_player ?? r.email}</Text>}
                      </View>
                      {target === 'all_staff' && r.kind !== 'coach' && (
                        <Ionicons name="people" size={15} color="#7c3aed" style={{ marginRight: 6 }} />
                      )}
                      {isSel && <Ionicons name="checkmark-circle" size={18} color="#7c3aed" />}
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            {/* Allow regenerate — staff only */}
            {target === 'all_staff' && (
              <>
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Allow recipient to regenerate</Text>
                  <Switch
                    value={allowRegen}
                    onValueChange={setAllowRegen}
                    trackColor={{ false: '#374151', true: '#7c3aed' }}
                    thumbColor="#fff"
                  />
                </View>
                <Text style={styles.hint}>
                  {allowRegen
                    ? 'Sends a live, regenerable copy — recipient sees the full report.'
                    : 'Sends a frozen snapshot — choose which sections to include below.'}
                </Text>
              </>
            )}

            {/* Section toggles — available on every target (frozen filtering) */}
            {showSectionToggles && (
              <>
                <Text style={[styles.label, { marginTop: 8 }]}>Include Sections</Text>
                {sections.map(sec => (
                  <View key={sec.heading} style={styles.toggleRow}>
                    <Text style={[styles.toggleLabel, { flex: 1, marginRight: 8 }]} numberOfLines={1}>{sec.heading}</Text>
                    <Switch
                      value={sectionToggles[sec.heading] !== false}
                      onValueChange={v => setSectionToggles(p => ({ ...p, [sec.heading]: v }))}
                      trackColor={{ false: '#374151', true: '#7c3aed' }}
                      thumbColor="#fff"
                    />
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendBtn, { opacity: canSend() ? 1 : 0.4 }]}
              onPress={doSend}
              disabled={sending || !canSend()}
            >
              {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>Share</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  box: { backgroundColor: '#111827', borderRadius: 20, padding: 20, maxHeight: '90%', margin: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSub: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  targetRow: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  targetChip: { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: '#1f2937', alignItems: 'center', borderWidth: 1, borderColor: '#374151' },
  targetChipActive: { backgroundColor: '#7c3aed22', borderColor: '#7c3aed' },
  targetChipText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  targetChipTextActive: { color: '#fff' },
  label: { color: '#9ca3af', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  empty: { color: '#6b7280', fontSize: 13, marginBottom: 8 },
  hint: { color: '#6b7280', fontSize: 11, marginBottom: 12, marginLeft: 2 },
  input: { backgroundColor: '#1f2937', borderRadius: 10, padding: 14, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#374151', minHeight: 48 },
  searchBtn: { backgroundColor: '#7c3aed', borderRadius: 10, padding: 12, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1f2937', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#374151' },
  rowActive: { borderColor: '#7c3aed' },
  rowTitle: { color: '#fff', fontWeight: '600', fontSize: 14 },
  rowSub: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, backgroundColor: '#1f2937', borderRadius: 8, padding: 10 },
  toggleLabel: { color: '#d1d5db', fontSize: 13 },
  footer: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, backgroundColor: '#1f2937', alignItems: 'center' },
  cancelText: { color: '#9ca3af', fontWeight: '600' },
  sendBtn: { flex: 2, paddingVertical: 14, borderRadius: 10, backgroundColor: '#7c3aed', alignItems: 'center' },
  sendText: { color: '#fff', fontWeight: '700' },
});
