import React, { useState } from 'react';
import VoiceTextInput from '../../components/VoiceTextInput';
import KeyboardAwareScrollView from '../../components/KeyboardAwareScrollView';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { usePlayerAuth } from '../../context/PlayerAuthContext';
import { playerLinkAPI } from '../../api/playerClient';
import { useTheme } from '../../theme/ThemeProvider';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';

export default function PlayerRegisterScreen() {
  const { t } = useTheme();
  const styles = makeStyles(t);
  const { register, playerUser } = usePlayerAuth();
  const navigation = useNavigation<any>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);

  // Link profile state
  const [inviteCode, setInviteCode] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);

  const submit = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      await register({ name: name.trim(), email: email.trim(), password });
      setRegistered(true);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const useInvite = async () => {
    if (!inviteCode.trim()) return;
    setInviteLoading(true);
    try {
      const res = await playerLinkAPI.useInvite(inviteCode.trim());
      Alert.alert('Linked!', `Your account is now linked to ${res.player_name}'s profile.`);
      navigation.navigate('PlayerHome');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Invalid invite code');
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
      Alert.alert('Error', 'Search failed');
    } finally {
      setLinkLoading(false);
    }
  };

  const requestLink = async (playerId: number, playerName: string) => {
    try {
      await playerLinkAPI.requestLink(playerId);
      Alert.alert('Request Sent', `A link request has been sent to coaches for ${playerName}'s profile.`);
      setSearchResults([]);
      setSearchQ('');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Failed to send request');
    }
  };

  if (registered) {
    return (
      <ScreenBackground>
      <KeyboardAwareScrollView style={styles.container} contentContainerStyle={{ padding: 24, paddingTop: 60 }}>
        <Text style={styles.logo}>Welcome!</Text>
        <Text style={styles.sub}>Link your player profile</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Enter Invite Code</Text>
          <Text style={styles.sectionDesc}>If a coach gave you an invite code, enter it here.</Text>
          <VoiceTextInput
            style={styles.input}
            placeholder="Invite code (e.g. ABC12345)"
            placeholderTextColor={t.muted2}
            value={inviteCode}
            onChangeText={setInviteCode}
            autoCapitalize="characters"
          />
          <TouchableOpacity style={styles.btn} onPress={useInvite} disabled={inviteLoading}>
            {inviteLoading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Use Invite Code</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Find My Profile</Text>
          <Text style={styles.sectionDesc}>Search for your name in the roster and request to link.</Text>
          <View style={styles.searchRow}>
            <VoiceTextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Search your name..."
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
              <View style={{ flex: 1 }}>
                <Text style={styles.resultName}>{p.name}</Text>
                <Text style={styles.resultSub}>{p.position ?? '—'} · {p.team_name ?? '—'}</Text>
              </View>
              <TouchableOpacity
                style={styles.requestBtn}
                onPress={() => requestLink(p.id, p.name)}
              >
                <Text style={styles.requestBtnText}>Request Link</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.skipBtn} onPress={() => navigation.navigate('PlayerHome')}>
          <Text style={styles.skipText}>Skip for now →</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: 'transparent' }}
    >
      <KeyboardAwareScrollView
        contentContainerStyle={styles.formContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.logo}>BloomPrint</Text>
        <Text style={styles.sub}>Create Player Account</Text>

        <VoiceTextInput
          style={styles.input}
          placeholder="Full Name"
          placeholderTextColor={t.muted2}
          value={name}
          onChangeText={setName}
        />
        <VoiceTextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={t.muted2}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <VoiceTextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={t.muted2}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity style={styles.btn} onPress={submit} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>Create Account</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('PlayerLogin')}>
          <Text style={styles.toggle}>Already have an account? Sign In</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
    </KeyboardAvoidingView>
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
  logo: { fontSize: 32, fontFamily: fonts[900], fontWeight: '900', color: t.ink, letterSpacing: 1, marginBottom: 4 },
  sub: { fontSize: 13, color: t.positive, marginBottom: 32, fontWeight: '600' },
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
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  toggle: { color: t.positive, marginTop: 20, fontSize: 13 },
  section: { marginBottom: 24 },
  sectionTitle: { color: t.ink, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  sectionDesc: { color: t.muted, fontSize: 12, marginBottom: 12 },
  divider: { height: 1, backgroundColor: t.divider, marginVertical: 24 },
  searchRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchBtn: {
    backgroundColor: t.positive,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
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
  resultName: { color: t.ink, fontSize: 14, fontWeight: '600' },
  resultSub: { color: t.muted, fontSize: 12, marginTop: 2 },
  requestBtn: {
    backgroundColor: t.positiveSoft,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: t.positive,
  },
  requestBtnText: { color: t.positive, fontSize: 12, fontWeight: '600' },
  skipBtn: { alignItems: 'center', marginTop: 8, marginBottom: 40 },
  skipText: { color: t.muted, fontSize: 13 },
});
