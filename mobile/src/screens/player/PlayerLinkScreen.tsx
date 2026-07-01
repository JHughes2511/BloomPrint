import React, { useCallback, useState } from 'react';
import VoiceTextInput from '../../components/VoiceTextInput';
import KeyboardAwareScrollView from '../../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Modal, Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { usePlayerAuth } from '../../context/PlayerAuthContext';
import { playerLinkAPI, playerProfileAPI, playerApi, playerAuthAPI } from '../../api/playerClient';
import { useTheme } from '../../theme/ThemeProvider';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';

const ROLE_LABELS: Record<string, string> = { coach: 'Coach', scout: 'Scout', trainer: 'Trainer' };

type Link = { player_id: number; player_name: string; program_name?: string | null; team_name?: string | null; coach_name?: string | null; is_primary?: boolean };

export default function PlayerLinkScreen() {
  const { playerUser, logout, refreshUser } = usePlayerAuth();
  const { t, mode, toggle } = useTheme();
  const styles = makeStyles(t);

  const [profile, setProfile] = useState<any | null>(null);
  const [links, setLinks] = useState<Link[]>([]);

  // Link modal
  const [showLink, setShowLink] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [requestingId, setRequestingId] = useState<number | null>(null);

  // Edit profile modal
  const [showEdit, setShowEdit] = useState(false);
  const [eName, setEName] = useState('');
  const [eAvatar, setEAvatar] = useState<string | null>(null);
  const [eP, setEP] = useState('');     // position
  const [eH, setEH] = useState('');     // height
  const [eW, setEW] = useState('');     // wingspan
  const [eWt, setEWt] = useState('');   // weight
  const [eSr, setESr] = useState('');   // standing reach
  const [eSchool, setESchool] = useState('');
  const [saving, setSaving] = useState(false);

  // QR scanner
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  const load = useCallback(() => {
    playerLinkAPI.listLinks().then((l: Link[]) => setLinks(Array.isArray(l) ? l : [])).catch(() => {});
    if (playerUser?.player_id) {
      playerProfileAPI.get().then((p: any) => setProfile(p)).catch(() => {});
    } else {
      setProfile(null);
    }
  }, [playerUser?.player_id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const initials = (playerUser?.name ?? '').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || 'P';

  const submitInvite = async (codeArg?: string) => {
    const code = (codeArg ?? inviteCode).trim();
    if (!code) return;
    setInviteLoading(true);
    try {
      const res = await playerLinkAPI.useInvite(code);
      await refreshUser();
      setInviteCode('');
      setShowLink(false);
      load();
      Alert.alert('Linked!', `Your account is now linked to ${res?.player_name ?? 'a profile'}.`);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Invalid invite code');
    } finally {
      setInviteLoading(false);
    }
  };

  const searchStaff = async () => {
    if (!searchQ.trim()) return;
    setSearchLoading(true);
    try {
      const results = await playerApi.get('/player/search-staff', { params: { q: searchQ.trim() } }).then(r => r.data);
      setSearchResults(results);
    } catch {
      Alert.alert('Error', 'Search failed. Please try again.');
    } finally {
      setSearchLoading(false);
    }
  };

  const requestLink = async (coachId: number, coachName: string) => {
    setRequestingId(coachId);
    try {
      await playerApi.post(`/player/link-request/coach/${coachId}`).then(r => r.data);
      Alert.alert('Request Sent', `A link request was sent to ${coachName}.`);
      setSearchResults([]); setSearchQ('');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Failed to send request');
    } finally {
      setRequestingId(null);
    }
  };

  const unlink = (link: Link) => {
    Alert.alert('Unlink', `Unlink from ${link.team_name || link.program_name || link.player_name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink', style: 'destructive', onPress: async () => {
          try { await playerLinkAPI.unlink(link.player_id); await refreshUser(); load(); }
          catch { Alert.alert('Error', 'Could not unlink.'); }
        },
      },
    ]);
  };

  const openEdit = () => {
    setEName(playerUser?.name ?? '');
    setEAvatar((playerUser as any)?.avatar ?? null);
    setEP(profile?.position ?? ''); setEH(profile?.height ?? ''); setEW(profile?.wingspan ?? '');
    setEWt(profile?.weight ?? ''); setESr(profile?.standing_reach ?? ''); setESchool(profile?.school_name ?? '');
    setShowEdit(true);
  };

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to set a profile picture.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.4, base64: true,
    });
    if (!res.canceled && res.assets[0]?.base64) {
      setEAvatar(`data:image/jpeg;base64,${res.assets[0].base64}`);
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      // Account-level: name + avatar
      await playerAuthAPI.updateMe({ name: eName.trim() || undefined, avatar: eAvatar });
      // Profile-level: athletic fields (only when linked)
      if (playerUser?.player_id) {
        const updated = await playerProfileAPI.update({
          position: eP.trim() || undefined, height: eH.trim() || undefined,
          wingspan: eW.trim() || undefined, weight: eWt.trim() || undefined,
          standing_reach: eSr.trim() || undefined, school_name: eSchool.trim() || undefined,
        });
        setProfile(updated);
      }
      await refreshUser();
      setShowEdit(false);
    } catch { Alert.alert('Error', 'Failed to save profile.'); }
    finally { setSaving(false); }
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) { Alert.alert('Camera needed', 'Enable camera access to scan a QR code.'); return; }
    }
    setScanned(false);
    setShowScanner(true);
  };

  const onScan = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    setShowScanner(false);
    submitInvite((data || '').trim());
  };

  return (
    <ScreenBackground>
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Profile</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.circleBtn} onPress={toggle} accessibilityLabel="Toggle theme">
            <Ionicons name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'} size={18} color={t.inkSoft} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.circleBtn} onPress={logout} accessibilityLabel="Sign out">
            <Ionicons name="log-out-outline" size={18} color={t.muted2} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Avatar + name */}
      <TouchableOpacity style={styles.avatarWrap} onPress={openEdit} activeOpacity={0.85}>
        <View>
          <View style={styles.avatar}>
            {(playerUser as any)?.avatar
              ? <Image source={{ uri: (playerUser as any).avatar }} style={styles.avatarImg} />
              : <Text style={styles.avatarText}>{initials}</Text>}
          </View>
          <View style={styles.avatarCam}><Ionicons name="camera" size={15} color={t.ctaText} /></View>
        </View>
        <Text style={styles.name}>{playerUser?.name}</Text>
        {(profile?.position || profile?.school_name) ? (
          <Text style={styles.nameSub}>
            {[profile?.position, profile?.school_name].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </TouchableOpacity>

      {/* Athletic profile */}
      {profile && (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel}>Athletic Profile</Text>
            <TouchableOpacity style={styles.editBtn} onPress={openEdit}>
              <Ionicons name="pencil-outline" size={14} color={t.accent} />
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.statsCard}>
            {[['Position', profile.position], ['Height', profile.height], ['Wingspan', profile.wingspan], ['Weight', profile.weight]].map(([label, val], i) => (
              <View key={label as string} style={[styles.stat, i < 3 && styles.statBorder]}>
                <Text style={styles.statVal}>{(val as string) || '—'}</Text>
                <Text style={styles.statLabel}>{label as string}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Linked coaches & teams */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Linked Coaches & Teams</Text>
        {links.length === 0 ? (
          <Text style={styles.emptyLinks}>You're not linked to any coaches yet. Link with a coach to receive reports and training.</Text>
        ) : (
          links.map(link => (
            <View key={link.player_id} style={styles.linkCard}>
              <View style={styles.linkIcon}><Ionicons name="shield-checkmark" size={20} color={t.accent} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.linkName}>{link.team_name || link.program_name || link.player_name}</Text>
                <Text style={styles.linkSub}>
                  Linked{link.coach_name ? ` · Coach ${link.coach_name}` : ''}{link.is_primary ? ' · Primary' : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => unlink(link)}><Text style={styles.unlinkText}>Unlink</Text></TouchableOpacity>
            </View>
          ))
        )}
        <TouchableOpacity style={styles.linkCta} onPress={() => setShowLink(true)}>
          <Ionicons name="link" size={18} color={t.ctaText} />
          <Text style={styles.linkCtaText}>Link to Coach</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>

    {/* Edit profile modal */}
    <Modal visible={showEdit} transparent animationType="slide" onRequestClose={() => setShowEdit(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Edit Profile</Text>
            <TouchableOpacity onPress={() => setShowEdit(false)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
          </View>
          <KeyboardAwareScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
            {/* Avatar picker */}
            <TouchableOpacity style={styles.editAvatarWrap} onPress={pickAvatar}>
              <View style={styles.avatar}>
                {eAvatar
                  ? <Image source={{ uri: eAvatar }} style={styles.avatarImg} />
                  : <Text style={styles.avatarText}>{initials}</Text>}
              </View>
              <View style={styles.avatarCam}><Ionicons name="camera" size={15} color={t.ctaText} /></View>
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>Full Name</Text>
            <VoiceTextInput style={styles.input} value={eName} onChangeText={setEName} placeholder="Your name" placeholderTextColor={t.muted2} />

            {(playerUser?.player_id
              ? ([
                  ['Position', eP, setEP, 'e.g. SF'],
                  ['Height', eH, setEH, `e.g. 6'6"`],
                  ['Wingspan', eW, setEW, `e.g. 6'9"`],
                  ['Weight', eWt, setEWt, 'e.g. 200 lbs'],
                  ['Standing Reach', eSr, setESr, `e.g. 8'6"`],
                  ['School / Org', eSchool, setESchool, 'e.g. Creator Academy'],
                ] as [string, string, (v: string) => void, string][])
              : []
            ).map(([label, val, setter, ph]) => (
              <View key={label}>
                <Text style={styles.fieldLabel}>{label}</Text>
                <VoiceTextInput style={styles.input} value={val} onChangeText={setter} placeholder={ph} placeholderTextColor={t.muted2} />
              </View>
            ))}
            <TouchableOpacity style={[styles.btn, saving && { opacity: 0.6 }]} onPress={saveProfile} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save Changes</Text>}
            </TouchableOpacity>
          </KeyboardAwareScrollView>
        </View>
      </View>
    </Modal>

    {/* Link to Coach modal */}
    <Modal visible={showLink} transparent animationType="slide" onRequestClose={() => setShowLink(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Link to Coach</Text>
            <TouchableOpacity onPress={() => setShowLink(false)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
          </View>
          <KeyboardAwareScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={styles.linkHero}>
              <View style={styles.linkHeroIcon}><Ionicons name="link" size={30} color={t.accent} /></View>
              <Text style={styles.linkHeroTitle}>Connect with your coach</Text>
              <Text style={styles.linkHeroDesc}>Enter the code your coach shared, or scan their QR to link your portal to the team. You can link to more than one.</Text>
            </View>

            <Text style={styles.fieldLabel}>Enter Link Code</Text>
            <VoiceTextInput style={styles.input} placeholder="Invite code (e.g. ABC12345)" placeholderTextColor={t.muted2}
              value={inviteCode} onChangeText={setInviteCode} autoCapitalize="characters" />

            <TouchableOpacity style={styles.scanBtn} onPress={openScanner}>
              <Ionicons name="qr-code-outline" size={20} color={t.ink} />
              <Text style={styles.scanBtnText}>Scan QR Code</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.btn, { backgroundColor: t.ctaBg, marginTop: 14 }, (!inviteCode.trim() || inviteLoading) && { opacity: 0.5 }]}
              onPress={() => submitInvite()} disabled={!inviteCode.trim() || inviteLoading}>
              {inviteLoading ? <ActivityIndicator color={t.ctaText} /> : <Text style={[styles.btnText, { color: t.ctaText }]}>Link Account</Text>}
            </TouchableOpacity>

            <View style={styles.orRow}>
              <View style={styles.orLine} /><Text style={styles.orText}>OR</Text><View style={styles.orLine} />
            </View>

            <Text style={styles.fieldLabel}>Find a Coach or Trainer</Text>
            <View style={styles.searchRow}>
              <VoiceTextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder="Search by name or program..." placeholderTextColor={t.muted2}
                value={searchQ} onChangeText={setSearchQ} />
              <TouchableOpacity style={styles.searchBtn} onPress={searchStaff} disabled={searchLoading}>
                {searchLoading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="search" size={18} color="#fff" />}
              </TouchableOpacity>
            </View>
            {searchResults.map((c: any) => (
              <View key={c.id} style={styles.resultCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultName}>{c.name}</Text>
                  <Text style={styles.resultSub}>{ROLE_LABELS[c.role] ?? c.role} · {c.program_name}</Text>
                </View>
                <TouchableOpacity style={styles.requestBtn} onPress={() => requestLink(c.id, c.name)} disabled={requestingId === c.id}>
                  {requestingId === c.id ? <ActivityIndicator color={t.accent} size="small" /> : <Text style={styles.requestBtnText}>Request</Text>}
                </TouchableOpacity>
              </View>
            ))}
            {searchResults.length === 0 && searchQ.trim().length > 0 && !searchLoading && (
              <Text style={{ color: t.muted, fontSize: 12, marginTop: 8 }}>No staff found. Try a different search.</Text>
            )}
          </KeyboardAwareScrollView>
        </View>
      </View>
    </Modal>

    {/* QR scanner */}
    <Modal visible={showScanner} animationType="slide" onRequestClose={() => setShowScanner(false)}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScan}
        />
        <View style={styles.scanOverlay} pointerEvents="box-none">
          <View style={styles.scanFrame} />
          <Text style={styles.scanHint}>Point at your coach's QR code</Text>
        </View>
        <TouchableOpacity style={styles.scanClose} onPress={() => setShowScanner(false)}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingTop: 56 },
  title: { color: t.ink, fontSize: 28, fontFamily: fonts[800], letterSpacing: -0.6 },
  headerActions: { flexDirection: 'row', gap: 8 },
  circleBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder },

  avatarWrap: { alignItems: 'center', marginTop: 12, marginBottom: 8 },
  editAvatarWrap: { alignSelf: 'center', marginBottom: 8 },
  avatar: { width: 92, height: 92, borderRadius: 46, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: 92, height: 92, borderRadius: 46 },
  avatarCam: { position: 'absolute', bottom: 0, right: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: t.ctaBg, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: t.sheet },
  avatarText: { color: t.accent, fontSize: 30, fontFamily: fonts[800] },
  name: { color: t.ink, fontSize: 22, fontFamily: fonts[800], marginTop: 12 },
  nameSub: { color: t.muted, fontSize: 13.5, marginTop: 3 },

  section: { paddingHorizontal: 22, marginTop: 24 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionLabel: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 12 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.accentSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 12 },
  editBtnText: { color: t.accent, fontSize: 12, fontFamily: fonts[700] },
  statsCard: { flexDirection: 'row', backgroundColor: t.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: t.cardBorder },
  stat: { flex: 1, alignItems: 'center' },
  statBorder: { borderRightWidth: 1, borderRightColor: t.divider },
  statVal: { color: t.ink, fontSize: 16, fontFamily: fonts[800] },
  statLabel: { color: t.muted, fontSize: 10.5, marginTop: 3 },

  emptyLinks: { color: t.muted, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  linkCard: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: t.card, borderRadius: 15, padding: 15, borderWidth: 1, borderColor: t.cardBorder, marginBottom: 10 },
  linkIcon: { width: 42, height: 42, borderRadius: 11, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' },
  linkName: { color: t.ink, fontSize: 16, fontFamily: fonts[800] },
  linkSub: { color: t.positive, fontSize: 12.5, fontFamily: fonts[700], marginTop: 1 },
  unlinkText: { color: t.negative, fontSize: 13, fontFamily: fonts[700] },
  linkCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.ctaBg, borderRadius: 14, paddingVertical: 15, marginTop: 6 },
  linkCtaText: { color: t.ctaText, fontSize: 15.5, fontFamily: fonts[800] },

  modalOverlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: t.sheet, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 24, paddingBottom: 36, maxHeight: '88%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  sheetTitle: { color: t.ink, fontSize: 20, fontFamily: fonts[800] },
  fieldLabel: { color: t.muted2, fontSize: 10.5, fontFamily: fonts[700], letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 8, marginTop: 14 },
  input: { backgroundColor: t.card, borderRadius: 12, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.cardBorder, marginBottom: 4 },
  btn: { backgroundColor: t.positive, borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 24 },
  btnText: { color: '#fff', fontFamily: fonts[800], fontSize: 15 },

  linkHero: { alignItems: 'center', marginBottom: 8 },
  linkHeroIcon: { width: 70, height: 70, borderRadius: 20, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' },
  linkHeroTitle: { color: t.ink, fontSize: 19, fontFamily: fonts[800], marginTop: 14 },
  linkHeroDesc: { color: t.muted, fontSize: 13.5, textAlign: 'center', marginTop: 8, lineHeight: 20, paddingHorizontal: 8 },
  scanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: t.cta2Border, borderRadius: 14, paddingVertical: 15, marginTop: 12 },
  scanBtnText: { color: t.ink, fontSize: 15, fontFamily: fonts[800] },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 22 },
  orLine: { flex: 1, height: 1, backgroundColor: t.divider },
  orText: { color: t.muted2, fontSize: 12, fontFamily: fonts[700], letterSpacing: 1 },
  searchRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchBtn: { backgroundColor: t.positive, borderRadius: 12, padding: 14, alignItems: 'center', justifyContent: 'center' },
  resultCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 12, padding: 12, marginTop: 8, borderWidth: 1, borderColor: t.cardBorder },
  resultName: { color: t.ink, fontSize: 14, fontFamily: fonts[700] },
  resultSub: { color: t.muted, fontSize: 12, marginTop: 2 },
  requestBtn: { backgroundColor: t.accentSoft, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  requestBtnText: { color: t.accent, fontSize: 12, fontFamily: fonts[700] },

  scanOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanFrame: { width: 230, height: 230, borderRadius: 24, borderWidth: 3, borderColor: '#fff' },
  scanHint: { color: '#fff', fontSize: 14, fontFamily: fonts[700], marginTop: 20 },
  scanClose: { position: 'absolute', top: 56, right: 24, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
});
