import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceTextInput from '../../components/VoiceTextInput';
import KeyboardAwareScrollView from '../../components/KeyboardAwareScrollView';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { usePlayerAuth } from '../../context/PlayerAuthContext';
import { playerLinkAPI, playerAuthAPI } from '../../api/playerClient';
import { useTheme } from '../../theme/ThemeProvider';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';
import AuthLayout from '../../responsive/AuthLayout';
import CountryField from '../../components/CountryField';
import GoogleSignInButton from '../../components/GoogleSignInButton';

export default function PlayerRegisterScreen() {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const { register, playerUser, applyAuth } = usePlayerAuth();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const gp = route.params ?? {};
  const [name, setName] = useState(gp.name ?? '');
  const [email, setEmail] = useState(gp.email ?? '');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(gp.googleIdToken ?? null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);

  const handleGoogleIdToken = async (idToken: string) => {
    setGoogleBusy(true);
    try {
      const res = await playerAuthAPI.google({ id_token: idToken, mode: 'login' });
      if (res.status === 'ok') {
        await applyAuth(res.access_token, res.player_user);
      } else {
        setGoogleIdToken(idToken);
        setName(res.name ?? '');
        setEmail(res.email ?? '');
      }
    } catch (e: any) {
      Alert.alert(tr('auth.googleSignInTitle'), e?.response?.data?.detail ?? tr('auth.googleSignInFailed'));
    } finally {
      setGoogleBusy(false);
    }
  };

  // Link profile state
  const [inviteCode, setInviteCode] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);

  const submit = async () => {
    if (googleIdToken) {
      setLoading(true);
      try {
        const res = await playerAuthAPI.google({ id_token: googleIdToken, mode: 'register', name: name.trim() || undefined, country: country || undefined, city: city.trim() || undefined });
        if (res.status === 'ok') { await applyAuth(res.access_token, res.player_user); setRegistered(true); }
        else throw new Error(tr('playerApp.register.couldNotCreate'));
      } catch (e: any) {
        Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerApp.register.registrationFailed'));
      } finally { setLoading(false); }
      return;
    }
    if (!name.trim() || !email.trim() || !password.trim()) {
      Alert.alert(tr('common.error'), tr('playerApp.register.fillAllFields'));
      return;
    }
    setLoading(true);
    try {
      await register({ name: name.trim(), email: email.trim(), password, country: country || undefined, city: city.trim() || undefined });
      setRegistered(true);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerApp.register.registrationFailed'));
    } finally {
      setLoading(false);
    }
  };

  const useInvite = async () => {
    if (!inviteCode.trim()) return;
    setInviteLoading(true);
    try {
      const res = await playerLinkAPI.useInvite(inviteCode.trim());
      Alert.alert(tr('playerApp.register.linkedTitle'), tr('playerApp.register.linkedToProfile', { name: res.player_name }));
      navigation.navigate('PlayerHome');
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerApp.register.invalidInviteCode'));
    } finally {
      setInviteLoading(false);
    }
  };

  const searchPlayers = async () => {
    if (!searchQ.trim()) return;
    setLinkLoading(true);
    try {
      const results = await playerLinkAPI.searchPlayers(searchQ.trim());
      setSearchResults(results);
    } catch {
      Alert.alert(tr('common.error'), tr('playerApp.register.searchFailed'));
    } finally {
      setLinkLoading(false);
    }
  };

  const requestLink = async (playerId: number, playerName: string) => {
    try {
      await playerLinkAPI.requestLink(playerId);
      Alert.alert(tr('playerApp.register.requestSentTitle'), tr('playerApp.register.requestSentMsg', { name: playerName }));
      setSearchResults([]);
      setSearchQ('');
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerApp.register.failedToSendRequest'));
    }
  };

  if (registered) {
    return (
      <ScreenBackground>
      <KeyboardAwareScrollView style={styles.container} contentContainerStyle={{ padding: 24, paddingTop: 60 }}>
        <Text style={styles.logo} numberOfLines={1}>{tr('playerApp.register.welcome')}</Text>
        <Text style={styles.sub} numberOfLines={1}>{tr('playerApp.register.linkYourProfile')}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle} numberOfLines={1}>{tr('playerApp.register.enterInviteCode')}</Text>
          <Text style={styles.sectionDesc}>{tr('playerApp.register.enterInviteCodeDesc')}</Text>
          <VoiceTextInput
            style={styles.input}
            placeholder={tr('playerApp.register.inviteCodePlaceholder')}
            placeholderTextColor={t.muted2}
            value={inviteCode}
            onChangeText={setInviteCode}
            autoCapitalize="characters"
          />
          <TouchableOpacity style={styles.btn} onPress={useInvite} disabled={inviteLoading}>
            {inviteLoading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText} numberOfLines={1}>{tr('playerApp.register.useInviteCode')}</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle} numberOfLines={1}>{tr('playerApp.register.findMyProfile')}</Text>
          <Text style={styles.sectionDesc}>{tr('playerApp.register.findMyProfileDesc')}</Text>
          <View style={styles.searchRow}>
            <VoiceTextInput
              style={[styles.input, { flex: 1 }]}
              placeholder={tr('playerApp.register.searchYourName')}
              placeholderTextColor={t.muted2}
              value={searchQ}
              onChangeText={setSearchQ}
            />
            <TouchableOpacity style={styles.searchBtn} onPress={searchPlayers} disabled={linkLoading}>
              {linkLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="search" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
          {searchResults.map((p: any) => (
            <View key={p.id} style={styles.resultCard}>
              <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
                <Text style={styles.resultName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.resultSub} numberOfLines={1}>{p.position ?? '—'} · {p.team_name ?? '—'}</Text>
              </View>
              <TouchableOpacity
                style={styles.requestBtn}
                onPress={() => requestLink(p.id, p.name)}
              >
                <Text style={styles.requestBtnText} numberOfLines={1}>{tr('playerApp.register.requestLink')}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.skipBtn} onPress={() => navigation.navigate('PlayerHome')}>
          <Text style={styles.skipText} numberOfLines={1}>{tr('playerApp.register.skipForNow')}</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
    <AuthLayout>
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: 'transparent' }}
    >
      <KeyboardAwareScrollView
        contentContainerStyle={styles.formContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.logo} numberOfLines={1}>BloomPrint</Text>
        <Text style={styles.sub} numberOfLines={1}>{tr('playerApp.register.createPlayerAccount')}</Text>

        {!!googleIdToken && (
          <View style={styles.googleBanner}>
            <Ionicons name="logo-google" size={16} color={t.positive} />
            <Text style={styles.googleBannerText} numberOfLines={2}>{tr('auth.googleComplete')}</Text>
          </View>
        )}

        <VoiceTextInput
          style={styles.input}
          placeholder={tr('auth.fullName')}
          placeholderTextColor={t.muted2}
          value={name}
          onChangeText={setName}
        />
        <VoiceTextInput
          style={[styles.input, !!googleIdToken && { opacity: 0.6 }]}
          placeholder={tr('auth.email')}
          placeholderTextColor={t.muted2}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!googleIdToken}
        />
        {!googleIdToken && (
          <VoiceTextInput
            style={styles.input}
            placeholder={tr('auth.password')}
            placeholderTextColor={t.muted2}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        )}
        {!!googleIdToken && (
          <Text style={{ color: t.muted, fontSize: 12, marginBottom: 8 }}>
            {tr('auth.googleNoPassword')}
          </Text>
        )}
        <CountryField value={country} onChange={setCountry} placeholder={tr('playerApp.register.countryOptional')} />
        <VoiceTextInput
          style={styles.input}
          placeholder={tr('auth.cityRegionOptional')}
          placeholderTextColor={t.muted2}
          value={city}
          onChangeText={setCity}
        />

        <TouchableOpacity style={styles.btn} onPress={submit} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText} numberOfLines={1}>{tr('auth.createAccount')}</Text>}
        </TouchableOpacity>

        {!googleIdToken && (
          <>
            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <Text style={styles.orText} numberOfLines={1}>{tr('auth.or')}</Text>
              <View style={styles.orLine} />
            </View>
            <GoogleSignInButton onIdToken={handleGoogleIdToken} busy={googleBusy} color={t.positive} />
          </>
        )}

        <TouchableOpacity onPress={() => navigation.navigate('PlayerLogin')}>
          <Text style={styles.toggle} numberOfLines={2}>{tr('auth.haveAccountSignIn')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.navigate('RoleSelect')}>
          <Text style={styles.backText} numberOfLines={2}>{tr('auth.backToRoleSelect')}</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
    </KeyboardAvoidingView>
    </AuthLayout>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  formContainer: {
    flexGrow: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  logo: { fontSize: 32, fontFamily: fonts[900], color: t.ink, letterSpacing: 1, marginBottom: 4, flexShrink: 1, textAlign: 'center' },
  sub: { fontSize: 13, color: t.positive, marginBottom: 32, fontFamily: fonts[600], flexShrink: 1 },
  input: {
    width: '100%',
    backgroundColor: t.card,
    borderRadius: 10,
    padding: 14,
    color: t.ink,
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  btn: {
    width: '100%',
    backgroundColor: t.positive,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnText: { color: '#fff', fontFamily: fonts[700], fontSize: 16, flexShrink: 1 },
  toggle: { color: t.positive, marginTop: 20, fontSize: 13, textAlign: 'center' },
  backBtn: { marginTop: 32 },
  backText: { color: t.muted2, fontSize: 12, textAlign: 'center' },
  orRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginTop: 16, marginBottom: 4, gap: 10 },
  orLine: { flex: 1, flexShrink: 1, minWidth: 0, height: 1, backgroundColor: t.divider },
  orText: { color: t.muted2, fontSize: 12, flexShrink: 0 },
  googleBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.positiveSoft, borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: t.positive, width: '100%' },
  googleBannerText: { color: t.positive, fontSize: 12.5, fontFamily: fonts[700], flex: 1 },
  section: { marginBottom: 24 },
  sectionTitle: { color: t.ink, fontSize: 16, fontFamily: fonts[700], marginBottom: 4, flexShrink: 1 },
  sectionDesc: { color: t.muted, fontSize: 12, marginBottom: 12 },
  divider: { height: 1, backgroundColor: t.divider, marginVertical: 24 },
  searchRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchBtn: {
    backgroundColor: t.positive,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  resultName: { color: t.ink, fontSize: 14, fontFamily: fonts[600], flexShrink: 1 },
  resultSub: { color: t.muted, fontSize: 12, marginTop: 2, flexShrink: 1 },
  requestBtn: {
    backgroundColor: t.positiveSoft,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: t.positive,
    flexShrink: 0,
  },
  requestBtnText: { color: t.positive, fontSize: 12, fontFamily: fonts[600], flexShrink: 1 },
  skipBtn: { alignItems: 'center', marginTop: 8, marginBottom: 40 },
  skipText: { color: t.muted, fontSize: 13 },
});
