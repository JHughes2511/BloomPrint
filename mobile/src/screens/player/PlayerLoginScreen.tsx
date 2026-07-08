import React, { useState } from 'react';
import VoiceTextInput from '../../components/VoiceTextInput';
import KeyboardAwareScrollView from '../../components/KeyboardAwareScrollView';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { usePlayerAuth } from '../../context/PlayerAuthContext';
import { playerAuthAPI } from '../../api/playerClient';
import { useTheme } from '../../theme/ThemeProvider';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';
import GoogleSignInButton from '../../components/GoogleSignInButton';

export default function PlayerLoginScreen() {
  const { login, applyAuth } = usePlayerAuth();
  const navigation = useNavigation<any>();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleGoogleIdToken = async (idToken: string) => {
    setGoogleBusy(true);
    try {
      const res = await playerAuthAPI.google({ id_token: idToken, mode: 'login' });
      if (res.status === 'ok') {
        await applyAuth(res.access_token, res.player_user);
      } else {
        // No account — go finish signup (prefilled) then complete the link flow.
        navigation.navigate('PlayerRegister', { googleIdToken: idToken, email: res.email, name: res.name });
      }
    } catch (e: any) {
      Alert.alert('Google sign-in', e?.response?.data?.detail ?? 'Could not sign in with Google.');
    } finally {
      setGoogleBusy(false);
    }
  };

  const submit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter your email and password');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenBackground>
      <KeyboardAvoidingView
        behavior={undefined}
        style={{ flex: 1, backgroundColor: 'transparent' }}
      >
        <KeyboardAwareScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.logo}>BloomPrint</Text>
          <Text style={styles.sub}>Player Portal</Text>

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
              : <Text style={styles.btnText}>Sign In</Text>}
          </TouchableOpacity>

          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>or</Text>
            <View style={styles.orLine} />
          </View>
          <GoogleSignInButton onIdToken={handleGoogleIdToken} busy={googleBusy} color={t.positive} />

          <TouchableOpacity onPress={() => navigation.navigate('PlayerRegister')}>
            <Text style={styles.toggle}>Don't have an account? Register</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.navigate('RoleSelect')}
          >
            <Text style={styles.backText}>← Back to Role Select</Text>
          </TouchableOpacity>
        </KeyboardAwareScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  logo: { fontSize: 36, fontFamily: fonts[900], color: t.ink, letterSpacing: 1 },
  sub: { fontSize: 13, color: t.positive, marginBottom: 40, marginTop: 4, fontFamily: fonts[600] },
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
  btnText: { color: '#fff', fontFamily: fonts[700], fontSize: 16 },
  toggle: { color: t.positive, marginTop: 20, fontSize: 13 },
  backBtn: { marginTop: 32 },
  backText: { color: t.muted2, fontSize: 12 },
  orRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginTop: 16, marginBottom: 4, gap: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: t.divider },
  orText: { color: t.muted2, fontSize: 12 },
});
