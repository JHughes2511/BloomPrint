import React, { useState } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
  Modal, FlatList, SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import CountryField from '../components/CountryField';
import GoogleSignInButton from '../components/GoogleSignInButton';

const ROLES = [
  { key: 'coach',   label: 'Coach' },
  { key: 'scout',   label: 'Scout' },
  { key: 'trainer', label: 'Trainer' },
];

const COMPETITION_LEVELS = [
  'Youth',
  'Middle School',
  'HS JV',
  'HS Varsity',
  'AAU',
  'College',
  'Pro',
];

// Conferences shown for each competition level
const CONFERENCES_BY_LEVEL: Record<string, string[]> = {
  College: [
    // NCAA Division I — Power Conferences
    'ACC',
    'Big East',
    'Big Ten',
    'Big 12',
    'SEC',
    'Pac-12',
    // NCAA Division I — Mid-Major
    'American Athletic (AAC)',
    'Atlantic 10 (A-10)',
    'Mountain West (MWC)',
    'West Coast (WCC)',
    'Missouri Valley (MVC)',
    'Colonial Athletic (CAA)',
    'Mid-American (MAC)',
    'Sun Belt',
    'Conference USA (CUSA)',
    'Horizon League',
    'Big West',
    'Big Sky',
    'Big South',
    'Southern (SoCon)',
    'Southland',
    'Patriot League',
    'Ivy League',
    'MAAC',
    'Northeast (NEC)',
    'Ohio Valley (OVC)',
    'Summit League',
    'WAC',
    'America East',
    'ASUN',
    'Southwestern Athletic (SWAC)',
    'Mid-Eastern Athletic (MEAC)',
    'JUCO',
    'NAIA',
    'D2',
    'D3',
    'Independent',
  ],
  Pro: [
    'NBA',
    'G League',
    'NBA G League',
    'EuroLeague',
    'EuroCup',
    'Liga ACB (Spain)',
    'Lega Basket (Italy)',
    'Bundesliga (Germany)',
    'Pro A (France)',
    'Turkish BSL',
    'VTB United League',
    'LNB Pro A',
    'NBL (Australia)',
    'CBA (China)',
    'KBL (South Korea)',
    'Super League (Greece)',
    'Adriatic League (ABA)',
    'FIBA Champions League',
    'FIBA Europe Cup',
  ],
  AAU: [
    'Nike EYBL',
    'Adidas 3SSB',
    'Under Armour Association',
    'Overtime Elite',
    'Independent AAU',
  ],
  'HS Varsity': [
    'State Association',
    'Independent',
  ],
  'HS JV': [
    'State Association',
    'Independent',
  ],
  'Middle School': [],
  'Youth': [],
};

function PickerModal({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: string[];
  selected: string;
  onSelect: (val: string) => void;
  onClose: () => void;
}) {
  const { t } = useTheme();
  const pickerModalStyles = makePickerStyles(t);
  const [search, setSearch] = useState('');
  const filtered = search.trim()
    ? options.filter(o => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={pickerModalStyles.overlay}>
        <SafeAreaView style={pickerModalStyles.sheet}>
          <View style={pickerModalStyles.header}>
            <Text style={pickerModalStyles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={t.muted} />
            </TouchableOpacity>
          </View>
          <VoiceTextInput
            style={pickerModalStyles.search}
            placeholder="Search..."
            placeholderTextColor={t.muted2}
            value={search}
            onChangeText={setSearch}
          />
          <FlatList
            data={filtered}
            keyExtractor={item => item}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[pickerModalStyles.option, selected === item && pickerModalStyles.optionActive]}
                onPress={() => { onSelect(item); onClose(); setSearch(''); }}
              >
                <Text style={[pickerModalStyles.optionText, selected === item && { color: t.ink, fontFamily: fonts[700] }]}>
                  {item}
                </Text>
                {selected === item && <Ionicons name="checkmark" size={16} color={t.accent} />}
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export default function LoginScreen() {
  const { login, register, applyAuth } = useAuth();
  const navigation = useNavigation<any>();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [program, setProgram] = useState('');
  const [role, setRole] = useState('coach');
  const [competitionLevel, setCompetitionLevel] = useState('');
  const [conference, setConference] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [showLevelPicker, setShowLevelPicker] = useState(false);
  const [showConferencePicker, setShowConferencePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(null);

  // Google returns identity only; a NEW user still completes the required
  // fields (role, level, conference, location) before the account is created.
  const handleGoogleIdToken = async (idToken: string) => {
    setGoogleBusy(true);
    try {
      const res = await authAPI.google({ id_token: idToken, mode: 'login' });
      if (res.status === 'ok') {
        await applyAuth(res.access_token, res.coach);
      } else {
        // No account yet — switch to the signup form, prefilled, and finish there.
        setGoogleIdToken(idToken);
        setName(res.name ?? '');
        setEmail(res.email ?? '');
        setMode('register');
        Alert.alert('Almost there', 'Finish setting up your account, then tap Create Account.');
      }
    } catch (e: any) {
      Alert.alert('Google sign-in', e?.response?.data?.detail ?? 'Could not sign in with Google.');
    } finally {
      setGoogleBusy(false);
    }
  };

  const submit = async () => {
    if (mode === 'register') {
      if (competitionLevel === 'College' && !conference) {
        Alert.alert('Conference Required', 'Please select your conference to continue.');
        return;
      }
    }
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else if (googleIdToken) {
        // Google-based signup: create the account with the required fields.
        const res = await authAPI.google({
          id_token: googleIdToken, mode: 'register',
          role,
          program_name: program || name,
          competition_level: competitionLevel || undefined,
          conference: competitionLevel === 'College' ? conference : undefined,
          country: country || undefined,
          city: city.trim() || undefined,
        });
        if (res.status === 'ok') await applyAuth(res.access_token, res.coach);
        else throw new Error('Could not create the account.');
      } else {
        await register({
          name, email, password,
          program_name: program || name,
          role,
          competition_level: competitionLevel || undefined,
          conference: competitionLevel === 'College' ? conference : undefined,
          country: country || undefined,
          city: city.trim() || undefined,
        } as any);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenBackground>
    <KeyboardAvoidingView
      behavior={undefined}
      style={{ flex: 1 }}
    >
      <KeyboardAwareScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {mode === 'register' && (
          <TouchableOpacity style={styles.backBtn} onPress={() => { setGoogleIdToken(null); setMode('login'); }}>
            <Ionicons name="chevron-back" size={18} color={t.muted} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.logo}>BloomPrint</Text>
        <Text style={styles.sub}>Coach · Scout · Trainer</Text>

        {mode === 'register' && (
          <>
            {!!googleIdToken && (
              <View style={styles.googleBanner}>
                <Ionicons name="logo-google" size={16} color={t.accent} />
                <Text style={styles.googleBannerText}>Complete your account to finish signing up with Google</Text>
              </View>
            )}
            <Text style={styles.sectionLabel}>I am a</Text>
            <View style={styles.roleRow}>
              {ROLES.map(r => (
                <TouchableOpacity
                  key={r.key}
                  style={[styles.roleChip, role === r.key && styles.roleChipActive]}
                  onPress={() => setRole(r.key)}
                >
                  <Text style={[styles.roleText, role === r.key && styles.roleTextActive]}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <VoiceTextInput style={styles.input} placeholder="Full Name" placeholderTextColor={t.muted2}
              value={name} onChangeText={setName} />
            <VoiceTextInput style={styles.input} placeholder="Program / Organization Name" placeholderTextColor={t.muted2}
              value={program} onChangeText={setProgram} />

            {/* Competition Level picker */}
            <Text style={styles.sectionLabel}>Competition Level</Text>
            <TouchableOpacity
              style={styles.pickerBtn}
              onPress={() => setShowLevelPicker(true)}
            >
              <Text style={[styles.pickerBtnText, !competitionLevel && { color: t.muted2 }]}>
                {competitionLevel || 'Select level...'}
              </Text>
              <Ionicons name="chevron-down" size={14} color={t.muted} />
            </TouchableOpacity>

            {/* Conference / League picker — shown when the selected level has options */}
            {competitionLevel && (CONFERENCES_BY_LEVEL[competitionLevel]?.length ?? 0) > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 8 }]}>
                  {competitionLevel === 'College' ? 'Conference' : 'League / Association'}
                  {competitionLevel === 'College' && <Text style={{ color: t.negative }}> *</Text>}
                </Text>
                <TouchableOpacity
                  style={[styles.pickerBtn, competitionLevel === 'College' && !conference && { borderColor: t.negative }]}
                  onPress={() => setShowConferencePicker(true)}
                >
                  <Text style={[styles.pickerBtnText, !conference && { color: t.muted2 }]}>
                    {conference || (competitionLevel === 'College' ? 'Select conference (required)...' : 'Select league (optional)...')}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={t.muted} />
                </TouchableOpacity>
              </>
            )}

            {/* Location */}
            <Text style={[styles.sectionLabel, { marginTop: 8 }]}>Location</Text>
            <CountryField value={country} onChange={setCountry} />
            <VoiceTextInput
              style={styles.input}
              placeholder="City / Region (optional)"
              placeholderTextColor={t.muted2}
              value={city}
              onChangeText={setCity}
            />
          </>
        )}

        <VoiceTextInput
          style={[styles.input, mode === 'register' && { marginTop: 16 }, !!googleIdToken && { opacity: 0.6 }]}
          placeholder="Email"
          placeholderTextColor={t.muted2}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!googleIdToken}
        />
        {!googleIdToken && (
          <VoiceTextInput style={styles.input} placeholder="Password" placeholderTextColor={t.muted2}
            value={password} onChangeText={setPassword} secureTextEntry />
        )}
        {!!googleIdToken && (
          <Text style={{ color: t.muted, fontSize: 12, alignSelf: 'flex-start', marginBottom: 8 }}>
            Signing up with Google — no password needed.
          </Text>
        )}

        <TouchableOpacity style={styles.btn} onPress={submit} disabled={loading}>
          {loading
            ? <ActivityIndicator color={t.ctaText} />
            : <Text style={styles.btnText}>{mode === 'login' ? 'Sign In' : 'Create Account'}</Text>}
        </TouchableOpacity>

        {!googleIdToken && (
          <>
            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>or</Text>
              <View style={styles.orLine} />
            </View>
            <GoogleSignInButton onIdToken={handleGoogleIdToken} busy={googleBusy} color={t.accent} />
          </>
        )}

        <TouchableOpacity onPress={() => { if (mode === 'register') setGoogleIdToken(null); setMode(mode === 'login' ? 'register' : 'login'); }}>
          <Text style={styles.toggle}>
            {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign In'}
          </Text>
        </TouchableOpacity>

        {mode === 'login' && (
          <TouchableOpacity style={styles.roleSelectBtn} onPress={() => navigation.navigate('RoleSelect')}>
            <Text style={styles.roleSelectText}>← Back to Role Select</Text>
          </TouchableOpacity>
        )}
      </KeyboardAwareScrollView>

      <PickerModal
        visible={showLevelPicker}
        title="Competition Level"
        options={COMPETITION_LEVELS}
        selected={competitionLevel}
        onSelect={(val) => { setCompetitionLevel(val); if (val !== 'College') setConference(''); }}
        onClose={() => setShowLevelPicker(false)}
      />

      <PickerModal
        visible={showConferencePicker}
        title={competitionLevel === 'College' ? 'Conference' : 'League / Association'}
        options={CONFERENCES_BY_LEVEL[competitionLevel] ?? []}
        selected={conference}
        onSelect={setConference}
        onClose={() => setShowConferencePicker(false)}
      />
    </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const makePickerStyles = (t: ThemeTokens) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '80%', paddingBottom: 20,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: t.divider,
  },
  title: { color: t.ink, fontSize: 18, fontFamily: fonts[800] },
  search: {
    backgroundColor: t.chip, borderRadius: 10, margin: 16, padding: 12,
    color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line,
  },
  option: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: t.divider,
  },
  optionActive: { backgroundColor: t.accentSoft },
  optionText: { color: t.inkSoft, fontSize: 15 },
});

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, paddingTop: 60 },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: 24, gap: 4 },
  backText: { color: t.muted, fontSize: 14 },
  logo: { fontSize: 36, fontFamily: fonts[900], color: t.ink, letterSpacing: 1 },
  sub: { fontSize: 13, color: t.muted, marginBottom: 40, marginTop: 4 },
  sectionLabel: {
    alignSelf: 'flex-start', color: t.label, fontSize: 11,
    fontFamily: fonts[700], letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8,
  },
  roleRow: { flexDirection: 'row', gap: 8, width: '100%', marginBottom: 16 },
  roleChip: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: t.line, alignItems: 'center',
  },
  roleChipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  roleText: { color: t.muted, fontFamily: fonts[600], fontSize: 14 },
  roleTextActive: { color: t.ctaText },
  input: {
    width: '100%', backgroundColor: t.card, borderRadius: 10, padding: 14,
    color: t.ink, fontSize: 15, marginBottom: 12, borderWidth: 1, borderColor: t.line,
  },
  btn: {
    width: '100%', backgroundColor: t.ctaBg, borderRadius: 10,
    padding: 16, alignItems: 'center', marginTop: 8,
  },
  btnText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 16 },
  toggle: { color: t.muted, marginTop: 20, fontSize: 13 },
  roleSelectBtn: { marginTop: 32 },
  roleSelectText: { color: t.muted2, fontSize: 12 },
  orRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginTop: 16, marginBottom: 4, gap: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: t.divider },
  orText: { color: t.muted2, fontSize: 12 },
  googleBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.accentSoft, borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: t.accent },
  googleBannerText: { color: t.accent, fontSize: 12.5, fontFamily: fonts[700], flex: 1 },
  pickerBtn: {
    width: '100%', backgroundColor: t.card, borderRadius: 10, padding: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4, borderWidth: 1, borderColor: t.line,
  },
  pickerBtnText: { color: t.ink, fontSize: 15 },
});
