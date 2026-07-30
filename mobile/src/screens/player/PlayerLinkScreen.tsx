import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceTextInput from '../../components/VoiceTextInput';
import LanguagePicker from '../../components/LanguagePicker';
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
import CountryField from '../../components/CountryField';

const ROLE_LABELS: Record<string, string> = { coach: 'Coach', scout: 'Scout', trainer: 'Trainer' };

type Link = { player_id: number; player_name: string; program_name?: string | null; team_name?: string | null; coach_name?: string | null; is_primary?: boolean };

export default function PlayerLinkScreen() {
  const { t: tr } = useTranslation();
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
  const [eCountry, setECountry] = useState('');
  const [eCity, setECity] = useState('');
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
      Alert.alert(tr('playerApp.link.linkedTitle'), tr('playerApp.link.linkedMsg', { name: res?.player_name ?? tr('playerApp.link.aProfile') }));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerApp.link.invalidInviteCode'));
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
      Alert.alert(tr('common.error'), tr('playerApp.link.searchFailed'));
    } finally {
      setSearchLoading(false);
    }
  };

  const requestLink = async (coachId: number, coachName: string) => {
    setRequestingId(coachId);
    try {
      await playerApi.post(`/player/link-request/coach/${coachId}`).then(r => r.data);
      Alert.alert(tr('playerApp.link.requestSentTitle'), tr('playerApp.link.requestSentMsg', { name: coachName }));
      setSearchResults([]); setSearchQ('');
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerApp.link.failedToSendRequest'));
    } finally {
      setRequestingId(null);
    }
  };

  const unlink = (link: Link) => {
    Alert.alert(tr('playerApp.link.unlink'), tr('playerApp.link.unlinkConfirm', { name: link.team_name || link.program_name || link.player_name }), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('playerApp.link.unlink'), style: 'destructive', onPress: async () => {
          try { await playerLinkAPI.unlink(link.player_id); await refreshUser(); load(); }
          catch { Alert.alert(tr('common.error'), tr('playerApp.link.couldNotUnlink')); }
        },
      },
    ]);
  };

  const openEdit = () => {
    setEName(playerUser?.name ?? '');
    setEAvatar((playerUser as any)?.avatar ?? null);
    setECountry((playerUser as any)?.country ?? '');
    setECity((playerUser as any)?.city ?? '');
    setEP(profile?.position ?? ''); setEH(profile?.height ?? ''); setEW(profile?.wingspan ?? '');
    setEWt(profile?.weight ?? ''); setESr(profile?.standing_reach ?? ''); setESchool(profile?.school_name ?? '');
    setShowEdit(true);
  };

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert(tr('playerApp.link.permissionNeeded'), tr('playerApp.link.photoAccessMsg')); return; }
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
      await playerAuthAPI.updateMe({ name: eName.trim() || undefined, avatar: eAvatar, country: eCountry || undefined, city: eCity.trim() || undefined });
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
    } catch { Alert.alert(tr('common.error'), tr('playerApp.link.failedToSaveProfile')); }
    finally { setSaving(false); }
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) { Alert.alert(tr('playerApp.link.cameraNeeded'), tr('playerApp.link.cameraMsg')); return; }
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
        {/* Translated headers run 20-40% longer, so the title shrinks and clips. */}
        <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {tr('playerApp.link.title')}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.circleBtn} onPress={toggle} accessibilityLabel={tr('playerApp.link.toggleTheme')}>
            <Ionicons name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'} size={18} color={t.inkSoft} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.circleBtn} onPress={logout} accessibilityLabel={tr('playerApp.link.signOut')}>
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
        <Text style={styles.name} numberOfLines={1}>{playerUser?.name}</Text>
        {(profile?.position || profile?.school_name) ? (
          <Text style={styles.nameSub} numberOfLines={1}>
            {[profile?.position, profile?.school_name].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </TouchableOpacity>

      {/* Athletic profile */}
      {profile && (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel} numberOfLines={1}>{tr('playerApp.link.athleticProfile')}</Text>
            <TouchableOpacity style={styles.editBtn} onPress={openEdit}>
              <Ionicons name="pencil-outline" size={14} color={t.accent} />
              <Text style={styles.editBtnText} numberOfLines={1}>{tr('playerApp.link.edit')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.statsCard}>
            {[[tr('playerApp.link.position'), profile.position], [tr('playerApp.link.height'), profile.height], [tr('playerApp.link.wingspan'), profile.wingspan], [tr('playerApp.link.weight'), profile.weight]].map(([label, val], i) => (
              <View key={label as string} style={[styles.stat, i < 3 && styles.statBorder]}>
                <Text style={styles.statVal} numberOfLines={1}>{(val as string) || '—'}</Text>
                <Text style={styles.statLabel} numberOfLines={1}>{label as string}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Linked coaches & teams */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel} numberOfLines={1}>{tr('playerApp.link.linkedCoachesTeams')}</Text>
        {links.length === 0 ? (
          <Text style={styles.emptyLinks}>{tr('playerApp.link.notLinkedYet')}</Text>
        ) : (
          links.map(link => (
            <View key={link.player_id} style={styles.linkCard}>
              <View style={styles.linkIcon}><Ionicons name="shield-checkmark" size={20} color={t.accent} /></View>
              <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
                <Text style={styles.linkName} numberOfLines={1}>{link.team_name || link.program_name || link.player_name}</Text>
                <Text style={styles.linkSub} numberOfLines={1}>
                  {tr('playerApp.link.linked')}{link.coach_name ? ` · ${tr('playerApp.link.coach')} ${link.coach_name}` : ''}{link.is_primary ? ` · ${tr('playerApp.link.primary')}` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => unlink(link)}><Text style={styles.unlinkText} numberOfLines={1}>{tr('playerApp.link.unlink')}</Text></TouchableOpacity>
            </View>
          ))
        )}
        <TouchableOpacity style={styles.linkCta} onPress={() => setShowLink(true)}>
          <Ionicons name="link" size={18} color={t.ctaText} />
          <Text style={styles.linkCtaText} numberOfLines={1}>{tr('playerApp.link.linkToCoach')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>

    {/* Edit profile modal */}
    <Modal visible={showEdit} transparent animationType="slide" onRequestClose={() => setShowEdit(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{tr('playerApp.link.editProfile')}</Text>
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

            <Text style={styles.fieldLabel} numberOfLines={1}>{tr('auth.fullName')}</Text>
            <VoiceTextInput style={styles.input} value={eName} onChangeText={setEName} placeholder={tr('playerApp.link.yourName')} placeholderTextColor={t.muted2} />

            <Text style={styles.fieldLabel} numberOfLines={1}>{tr('playerApp.link.country')}</Text>
            <CountryField value={eCountry} onChange={setECountry} placeholder={tr('playerApp.link.selectCountry')} />
            <Text style={styles.fieldLabel} numberOfLines={1}>{tr('playerApp.link.cityRegion')}</Text>
            <VoiceTextInput style={styles.input} value={eCity} onChangeText={setECity} placeholder={tr('auth.cityRegionOptional')} placeholderTextColor={t.muted2} />

            {(playerUser?.player_id
              ? ([
                  [tr('playerApp.link.position'), eP, setEP, tr('playerApp.link.phPosition')],
                  [tr('playerApp.link.height'), eH, setEH, tr('playerApp.link.phHeight')],
                  [tr('playerApp.link.wingspan'), eW, setEW, tr('playerApp.link.phWingspan')],
                  [tr('playerApp.link.weight'), eWt, setEWt, tr('playerApp.link.phWeight')],
                  [tr('playerApp.link.standingReach'), eSr, setESr, tr('playerApp.link.phStandingReach')],
                  [tr('playerApp.link.schoolOrg'), eSchool, setESchool, tr('playerApp.link.phSchool')],
                ] as [string, string, (v: string) => void, string][])
              : []
            ).map(([label, val, setter, ph]) => (
              <View key={label}>
                <Text style={styles.fieldLabel} numberOfLines={1}>{label}</Text>
                <VoiceTextInput style={styles.input} value={val} onChangeText={setter} placeholder={ph} placeholderTextColor={t.muted2} />
              </View>
            ))}
            <View style={{ marginTop: 20 }}>
              <LanguagePicker />
            </View>
            <TouchableOpacity style={[styles.btn, saving && { opacity: 0.6 }]} onPress={saveProfile} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText} numberOfLines={1}>{tr('playerApp.link.saveChanges')}</Text>}
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
            <Text style={styles.sheetTitle} numberOfLines={1}>{tr('playerApp.link.linkToCoach')}</Text>
            <TouchableOpacity onPress={() => setShowLink(false)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
          </View>
          <KeyboardAwareScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={styles.linkHero}>
              <View style={styles.linkHeroIcon}><Ionicons name="link" size={30} color={t.accent} /></View>
              <Text style={styles.linkHeroTitle} numberOfLines={2}>{tr('playerApp.link.connectTitle')}</Text>
              <Text style={styles.linkHeroDesc}>{tr('playerApp.link.connectDesc')}</Text>
            </View>

            <Text style={styles.fieldLabel} numberOfLines={1}>{tr('playerApp.link.enterLinkCode')}</Text>
            <VoiceTextInput style={styles.input} placeholder={tr('playerApp.link.inviteCodePlaceholder')} placeholderTextColor={t.muted2}
              value={inviteCode} onChangeText={setInviteCode} autoCapitalize="characters" />

            <TouchableOpacity style={styles.scanBtn} onPress={openScanner}>
              <Ionicons name="qr-code-outline" size={20} color={t.ink} />
              <Text style={styles.scanBtnText} numberOfLines={1}>{tr('playerApp.link.scanQrCode')}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.btn, { backgroundColor: t.ctaBg, marginTop: 14 }, (!inviteCode.trim() || inviteLoading) && { opacity: 0.5 }]}
              onPress={() => submitInvite()} disabled={!inviteCode.trim() || inviteLoading}>
              {inviteLoading ? <ActivityIndicator color={t.ctaText} /> : <Text style={[styles.btnText, { color: t.ctaText }]} numberOfLines={1}>{tr('playerApp.link.linkAccount')}</Text>}
            </TouchableOpacity>

            <View style={styles.orRow}>
              <View style={styles.orLine} /><Text style={styles.orText} numberOfLines={1}>{tr('playerApp.link.or')}</Text><View style={styles.orLine} />
            </View>

            <Text style={styles.fieldLabel} numberOfLines={1}>{tr('playerApp.link.findCoachTrainer')}</Text>
            <View style={styles.searchRow}>
              <VoiceTextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder={tr('playerApp.link.searchByNameProgram')} placeholderTextColor={t.muted2}
                value={searchQ} onChangeText={setSearchQ} />
              <TouchableOpacity style={styles.searchBtn} onPress={searchStaff} disabled={searchLoading}>
                {searchLoading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="search" size={18} color="#fff" />}
              </TouchableOpacity>
            </View>
            {searchResults.map((c: any) => (
              <View key={c.id} style={styles.resultCard}>
                <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
                  <Text style={styles.resultName} numberOfLines={1}>{c.name}</Text>
                  <Text style={styles.resultSub} numberOfLines={1}>{tr(`auth.role${(c.role ?? '').charAt(0).toUpperCase()}${(c.role ?? '').slice(1)}`, ROLE_LABELS[c.role] ?? c.role)} · {c.program_name}</Text>
                </View>
                <TouchableOpacity style={styles.requestBtn} onPress={() => requestLink(c.id, c.name)} disabled={requestingId === c.id}>
                  {requestingId === c.id ? <ActivityIndicator color={t.accent} size="small" /> : <Text style={styles.requestBtnText} numberOfLines={1}>{tr('playerApp.link.request')}</Text>}
                </TouchableOpacity>
              </View>
            ))}
            {searchResults.length === 0 && searchQ.trim().length > 0 && !searchLoading && (
              <Text style={{ color: t.muted, fontSize: 12, marginTop: 8 }}>{tr('playerApp.link.noStaffFound')}</Text>
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
          <Text style={styles.scanHint} numberOfLines={2}>{tr('playerApp.link.pointAtQr')}</Text>
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
  title: { color: t.ink, fontSize: 28, fontFamily: fonts[800], letterSpacing: -0.6, flexShrink: 1 },
  headerActions: { flexDirection: 'row', gap: 8, flexShrink: 0 },
  circleBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, flexShrink: 0 },

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
  sectionLabel: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 12, flexShrink: 1, marginRight: 8 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.accentSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 12, flexShrink: 0 },
  editBtnText: { color: t.accent, fontSize: 12, fontFamily: fonts[700], flexShrink: 1 },
  statsCard: { flexDirection: 'row', backgroundColor: t.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: t.cardBorder },
  stat: { flex: 1, flexShrink: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 3 },
  statBorder: { borderRightWidth: 1, borderRightColor: t.divider },
  statVal: { color: t.ink, fontSize: 16, fontFamily: fonts[800] },
  statLabel: { color: t.muted, fontSize: 10.5, marginTop: 3 },

  emptyLinks: { color: t.muted, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  linkCard: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: t.card, borderRadius: 15, padding: 15, borderWidth: 1, borderColor: t.cardBorder, marginBottom: 10 },
  linkIcon: { width: 42, height: 42, borderRadius: 11, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  linkName: { color: t.ink, fontSize: 16, fontFamily: fonts[800], flexShrink: 1 },
  linkSub: { color: t.positive, fontSize: 12.5, fontFamily: fonts[700], marginTop: 1, flexShrink: 1 },
  unlinkText: { color: t.negative, fontSize: 13, fontFamily: fonts[700], flexShrink: 0 },
  linkCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.ctaBg, borderRadius: 14, paddingVertical: 15, marginTop: 6 },
  linkCtaText: { color: t.ctaText, fontSize: 15.5, fontFamily: fonts[800], flexShrink: 1 },

  modalOverlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: t.sheet, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 24, paddingBottom: 36, maxHeight: '88%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  sheetTitle: { color: t.ink, fontSize: 20, fontFamily: fonts[800], flexShrink: 1, minWidth: 0, marginRight: 10 },
  fieldLabel: { color: t.muted2, fontSize: 10.5, fontFamily: fonts[700], letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 8, marginTop: 14 },
  input: { backgroundColor: t.card, borderRadius: 12, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.cardBorder, marginBottom: 4 },
  btn: { backgroundColor: t.positive, borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 24 },
  btnText: { color: '#fff', fontFamily: fonts[800], fontSize: 15, flexShrink: 1 },

  linkHero: { alignItems: 'center', marginBottom: 8 },
  linkHeroIcon: { width: 70, height: 70, borderRadius: 20, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' },
  linkHeroTitle: { color: t.ink, fontSize: 19, fontFamily: fonts[800], marginTop: 14 },
  linkHeroDesc: { color: t.muted, fontSize: 13.5, textAlign: 'center', marginTop: 8, lineHeight: 20, paddingHorizontal: 8 },
  scanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: t.cta2Border, borderRadius: 14, paddingVertical: 15, marginTop: 12 },
  scanBtnText: { color: t.ink, fontSize: 15, fontFamily: fonts[800], flexShrink: 1 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 22 },
  orLine: { flex: 1, height: 1, backgroundColor: t.divider },
  orText: { color: t.muted2, fontSize: 12, fontFamily: fonts[700], letterSpacing: 1 },
  searchRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchBtn: { backgroundColor: t.positive, borderRadius: 12, padding: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  resultCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 12, padding: 12, marginTop: 8, borderWidth: 1, borderColor: t.cardBorder },
  resultName: { color: t.ink, fontSize: 14, fontFamily: fonts[700], flexShrink: 1 },
  resultSub: { color: t.muted, fontSize: 12, marginTop: 2, flexShrink: 1 },
  requestBtn: { backgroundColor: t.accentSoft, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, flexShrink: 0 },
  requestBtnText: { color: t.accent, fontSize: 12, fontFamily: fonts[700], flexShrink: 1 },

  scanOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanFrame: { width: 230, height: 230, borderRadius: 24, borderWidth: 3, borderColor: '#fff' },
  scanHint: { color: '#fff', fontSize: 14, fontFamily: fonts[700], marginTop: 20 },
  scanClose: { position: 'absolute', top: 56, right: 24, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
});
