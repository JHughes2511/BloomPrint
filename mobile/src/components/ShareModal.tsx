import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, Alert, KeyboardAvoidingView, Platform, Switch, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import VoiceTextInput from './VoiceTextInput';
import { playerAPI, teamsAPI, staffSharingAPI, teamStaffAPI } from '../api/client';
import { splitReportSections, joinReportSections } from '../utils/mdToHtml';
import KeyboardAwareScrollView from './KeyboardAwareScrollView';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

type Target = 'player' | 'team' | 'all_staff';

export type ShareModalProps = {
  visible: boolean;
  onClose: () => void;
  reportType: string;   // staff-share report_type: eval | game | team_report | training | team_training
  reportId: number;
  outputType: string;   // label for player-facing copy, e.g. coaching_report
  reportText: string;   // full report text (section filtering + player payload)
  title?: string;       // optional heading label shown in the modal subtitle
  subjectPlayerId?: number;    // the player this report is ABOUT (enables consent flow)
  subjectPlayerName?: string;  // shown first + used in consent messaging
};

export default function ShareModal({
  visible, onClose, reportType, reportId, outputType, reportText, title,
  subjectPlayerId, subjectPlayerName,
}: ShareModalProps) {
  const { t } = useTheme();
  const styles = makeStyles(t);
  const [target, setTarget] = useState<Target>('player');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [teams, setTeams] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null); // selected player user / team / staff target
  const [myGroups, setMyGroups] = useState<any[]>([]); // staff teams + sub-teams I'm in
  const [allowRegen, setAllowRegen] = useState(false);
  const [sectionToggles, setSectionToggles] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);

  const sections = splitReportSections(reportText ?? '');

  // Reset state whenever the modal is (re)opened
  useEffect(() => {
    if (visible) {
      setTarget('player');
      setSelected(null);
      setAllowRegen(false);
      setSectionToggles(Object.fromEntries(splitReportSections(reportText ?? '').map(s => [s.heading, true])));
      teamsAPI.list().then(setTeams).catch(() => {});
      teamStaffAPI.myTeams().then(setMyGroups).catch(() => setMyGroups([]));
      // Surface the subject player first so they're the default recipient.
      if (subjectPlayerName) {
        setSearch(subjectPlayerName);
        setSearchLoading(true);
        playerAPI.searchPlayerUsers(subjectPlayerName)
          .then((r: any[]) => setResults(r ?? []))
          .catch(() => setResults([]))
          .finally(() => setSearchLoading(false));
      } else {
        setSearch('');
        setResults([]);
      }
    }
  }, [visible, reportText]);

  // Clear selection/results when switching target tab; re-surface the subject
  // player when returning to the Player tab.
  useEffect(() => {
    setSelected(null);
    if (target === 'player' && subjectPlayerName) {
      setSearch(subjectPlayerName);
      setSearchLoading(true);
      playerAPI.searchPlayerUsers(subjectPlayerName)
        .then((r: any[]) => setResults(r ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearchLoading(false));
    } else {
      setResults([]);
      setSearch('');
    }
  }, [target]);

  const runSearch = async () => {
    if (!search.trim()) return;
    Keyboard.dismiss();  // so results aren't hidden behind the keyboard
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
  // The document header (title / model banner / opponent line) is pinned and
  // always included — only real content sections get toggles.
  const toggleSections = sections.filter(s => !s.pinned);
  const showSectionToggles = toggleSections.length > 1 && !(target === 'all_staff' && allowRegen);

  const canSend = () => {
    if (target === 'team') return !!selected;
    return !!selected;
  };

  const doSend = async (consentOverride = false) => {
    if (!canSend()) return;
    setSending(true);
    try {
      if (target === 'all_staff') {
        const frozen = !allowRegen ? filteredText() : undefined;
        if (selected?.__group) {
          // A team / sub-team from My Groups — staff members only.
          const res = await staffSharingAPI.shareTeam({
            report_type: reportType, report_id: reportId, team_id: selected.id,
            allow_regenerate: allowRegen, frozen_text: frozen,
          });
          Alert.alert('Shared!', `Report shared with ${res.shared_count ?? 0} staff member(s) in ${res.team_name ?? selected.name}.`);
        } else {
          const res = await staffSharingAPI.shareGroup({
            report_type: reportType, report_id: reportId, kind: selected.kind,
            coach_id: selected.coach_id ?? undefined, team_id: selected.team_id ?? undefined,
            program_name: selected.program_name ?? undefined,
            allow_regenerate: allowRegen, frozen_text: frozen,
          });
          Alert.alert('Shared!', `Report shared with ${res.shared_count ?? 1} staff member(s).`);
        }
      } else if (target === 'team') {
        // Whole team: players AND the team's staff coaches.
        const playersRes = await playerAPI.shareTeamReport({
          output_type: outputType, report_text: filteredText(), target_type: 'team', team_id: selected.id,
        });
        let staffCount = 0;
        try {
          const staffRes = await staffSharingAPI.shareTeam({
            report_type: reportType, report_id: reportId, team_id: selected.id,
            allow_regenerate: false, frozen_text: filteredText(),
          });
          staffCount = staffRes.shared_count ?? 0;
        } catch {}
        const p = playersRes.shared_count ?? 0;
        Alert.alert('Shared!', `Report shared with ${p} player(s) and ${staffCount} staff on ${selected.name}.`);
      } else {
        // Individual player (consent flow).
        const res = await playerAPI.shareTeamReport({
          output_type: outputType, report_text: filteredText(), target_type: 'player',
          player_user_id: selected.id,
          subject_player_id: subjectPlayerId,
          require_consent: !!subjectPlayerId,
          consent_override: consentOverride,
        });
        if (res.status === 'pending_approval') {
          setSending(false);
          Alert.alert('Pending approval',
            `This report is about ${res.subject_name}. We sent ${res.subject_name} a request to approve sharing it with ${res.recipient_name}. It will send automatically once they approve.`);
          onClose();
          return;
        }
        if (res.status === 'needs_override') {
          setSending(false);
          Alert.alert('No account to approve',
            `${res.subject_name} doesn't have an account to approve this yet. Their report is not about ${res.recipient_name}. Send it to ${res.recipient_name} anyway?`,
            [{ text: 'Cancel', style: 'cancel' }, { text: 'Send anyway', style: 'destructive', onPress: () => doSend(true) }]);
          return;
        }
        Alert.alert('Shared!', `Report shared with ${selected.name ?? 'player'}.`);
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
        behavior={Platform.OS === 'android' ? 'height' : undefined}
      >
        <View style={styles.box}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Share Report</Text>
              {!!title && <Text style={styles.headerSub} numberOfLines={1}>{title}</Text>}
            </View>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={t.muted} />
            </TouchableOpacity>
          </View>

          {/* Target selector */}
          <View style={styles.targetRow}>
            {([['player', 'Player'], ['team', 'Team'], ['all_staff', 'Staff']] as const).map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.targetChip, target === key && styles.targetChipActive]}
                onPress={() => setTarget(key)}
              >
                <Text style={[styles.targetChipText, target === key && styles.targetChipTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <KeyboardAwareScrollView style={{ maxHeight: 420 }}>
            {/* Whole Team — pick from your teams */}
            {target === 'team' ? (
              <>
                <Text style={styles.label}>Select a Team</Text>
                <Text style={styles.hint}>Sends to the team's players and its staff coaches.</Text>
                {/* Top-level teams I own OR am a staff member of (sub-teams live
                    under the Staff tab). Searchable by name. */}
                <VoiceTextInput
                  style={[styles.input, { marginBottom: 8 }]}
                  placeholder="Search a team you're on..."
                  placeholderTextColor={t.muted2}
                  value={search}
                  onChangeText={setSearch}
                />
                {(() => {
                  const q = search.trim().toLowerCase();
                  const topTeams = myGroups
                    .filter((tm: any) => !tm.parent_team_id)
                    .filter((tm: any) => !q || (tm.name ?? '').toLowerCase().includes(q));
                  if (topTeams.length === 0) {
                    return <Text style={styles.empty}>{q ? 'No teams match.' : "You're not on any teams yet."}</Text>;
                  }
                  return topTeams.map((tm: any) => (
                    <TouchableOpacity
                      key={tm.id}
                      style={[styles.row, selected?.id === tm.id && !selected?.__group && styles.rowActive]}
                      onPress={() => setSelected(tm)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>{tm.name}</Text>
                        {tm.is_owner === false && <Text style={styles.rowSub}>Staff member</Text>}
                      </View>
                      {selected?.id === tm.id && !selected?.__group && <Ionicons name="checkmark-circle" size={18} color={t.accent} />}
                    </TouchableOpacity>
                  ));
                })()}
              </>
            ) : (
              <>
                {/* Allow regenerate — staff only, above the targets */}
                {target === 'all_staff' && (
                  <>
                    <View style={styles.toggleRow}>
                      <Text style={styles.toggleLabel}>Allow recipient to regenerate</Text>
                      <Switch
                        value={allowRegen}
                        onValueChange={setAllowRegen}
                        trackColor={{ false: t.line, true: t.accent }}
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
                {/* Consent note for individual player reports */}
                {target === 'player' && !!subjectPlayerName && (
                  <Text style={styles.hint}>
                    This report is about {subjectPlayerName}. Sending it to {subjectPlayerName} is instant;
                    sending to a different player needs {subjectPlayerName}'s approval first.
                  </Text>
                )}
                {/* Player or Staff — search */}
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                  <VoiceTextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder={target === 'all_staff'
                      ? 'Search coach, team, or program name...'
                      : 'Search player name...'}
                    placeholderTextColor={t.muted2}
                    value={search}
                    onChangeText={setSearch}
                  />
                  <TouchableOpacity style={styles.searchBtn} onPress={runSearch} disabled={searchLoading}>
                    {searchLoading ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="search" size={18} color={t.ctaText} />}
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
                        <Ionicons name="people" size={15} color={t.accent} style={{ marginRight: 6 }} />
                      )}
                      {isSel && <Ionicons name="checkmark-circle" size={18} color={t.accent} />}
                    </TouchableOpacity>
                  );
                })}

                {/* My groups — teams & sub-teams I'm in (staff only) */}
                {target === 'all_staff' && myGroups.length > 0 && (() => {
                  const ids = new Set(myGroups.map((g: any) => g.id));
                  const byParent: Record<number, any[]> = {};
                  myGroups.forEach((g: any) => { const p = g.parent_team_id ?? 0; (byParent[p] = byParent[p] || []).push(g); });
                  const roots = myGroups.filter((g: any) => !g.parent_team_id || !ids.has(g.parent_team_id));
                  const renderNode = (g: any, depth: number): any => {
                    const sel = selected?.__group && selected.id === g.id;
                    return (
                      <View key={g.id}>
                        <TouchableOpacity
                          style={[styles.row, sel && styles.rowActive, depth ? { marginLeft: depth * 14, borderLeftWidth: 3, borderLeftColor: t.accent } : null]}
                          onPress={() => setSelected({ ...g, __group: true })}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle}>{g.name}</Text>
                            <Text style={styles.rowSub}>{g.member_count ?? 1} staff{g.parent_team_id ? ' · sub-team' : ''}</Text>
                          </View>
                          {sel && <Ionicons name="checkmark-circle" size={18} color={t.accent} />}
                        </TouchableOpacity>
                        {(byParent[g.id] || []).map((c: any) => renderNode(c, depth + 1))}
                      </View>
                    );
                  };
                  return (
                    <>
                      <Text style={[styles.label, { marginTop: 14 }]}>My Groups — staff only</Text>
                      {roots.map((r: any) => renderNode(r, 0))}
                    </>
                  );
                })()}
              </>
            )}

            {/* Section toggles — available on every target (frozen filtering) */}
            {showSectionToggles && (
              <>
                <Text style={[styles.label, { marginTop: 8 }]}>Include Sections</Text>
                {toggleSections.map((sec, i) => (
                  <View key={`${sec.heading}-${i}`} style={styles.toggleRow}>
                    <Text style={[styles.toggleLabel, { flex: 1, marginRight: 8 }]} numberOfLines={1}>{sec.heading}</Text>
                    <Switch
                      value={sectionToggles[sec.heading] !== false}
                      onValueChange={v => setSectionToggles(p => ({ ...p, [sec.heading]: v }))}
                      trackColor={{ false: t.line, true: t.accent }}
                      thumbColor="#fff"
                    />
                  </View>
                ))}
              </>
            )}
          </KeyboardAwareScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendBtn, { opacity: canSend() ? 1 : 0.4 }]}
              onPress={() => doSend()}
              disabled={sending || !canSend()}
            >
              {sending ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.sendText}>Share</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  box: { backgroundColor: t.sheet, borderRadius: 20, padding: 20, maxHeight: '90%', margin: 8, borderWidth: 1, borderColor: t.cardBorder },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  headerTitle: { color: t.ink, fontSize: 18, fontFamily: fonts[800] },
  headerSub: { color: t.muted, fontSize: 12, marginTop: 4 },
  targetRow: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  targetChip: { flex: 1, paddingVertical: 10, borderRadius: 999, backgroundColor: t.chip, alignItems: 'center', borderWidth: 1, borderColor: t.line },
  targetChipActive: { backgroundColor: t.accentSoft, borderColor: t.accent },
  targetChipText: { color: t.muted, fontSize: 12, fontFamily: fonts[700] },
  targetChipTextActive: { color: t.accent },
  label: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 },
  empty: { color: t.muted, fontSize: 13, marginBottom: 8 },
  hint: { color: t.muted, fontSize: 11, marginBottom: 12, marginLeft: 2 },
  input: { backgroundColor: t.chip, borderRadius: 14, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line, minHeight: 48 },
  searchBtn: { backgroundColor: t.ctaBg, borderRadius: 14, padding: 12, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.chip, borderRadius: 14, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: t.cardBorder },
  rowActive: { borderColor: t.accent },
  rowTitle: { color: t.ink, fontFamily: fonts[600], fontSize: 14 },
  rowSub: { color: t.muted, fontSize: 11, marginTop: 2 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, backgroundColor: t.chip, borderRadius: 10, padding: 10 },
  toggleLabel: { color: t.inkSoft, fontSize: 13 },
  footer: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 999, backgroundColor: t.chip, alignItems: 'center' },
  cancelText: { color: t.cta2Text, fontFamily: fonts[700] },
  sendBtn: { flex: 2, paddingVertical: 14, borderRadius: 999, backgroundColor: t.ctaBg, alignItems: 'center' },
  sendText: { color: t.ctaText, fontFamily: fonts[700] },
});
