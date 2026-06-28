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
              <Ionicons name="close" size={22} color="#9ca3af" />
            </TouchableOpacity>
          </View>
          <VoiceTextInput
            style={pickerModalStyles.search}
            placeholder="Search..."
            placeholderTextColor="#6b7280"
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
                <Text style={[pickerModalStyles.optionText, selected === item && { color: '#fff', fontWeight: '700' }]}>
                  {item}
                </Text>
                {selected === item && <Ionicons name="checkmark" size={16} color="#2563eb" />}
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export default function LoginScreen() {
  const { login, register } = useAuth();
  const navigation = useNavigation<any>();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [program, setProgram] = useState('');
  const [role, setRole] = useState('coach');
  const [competitionLevel, setCompetitionLevel] = useState('');
  const [conference, setConference] = useState('');
  const [showLevelPicker, setShowLevelPicker] = useState(false);
  const [showConferencePicker, setShowConferencePicker] = useState(false);
  const [loading, setLoading] = useState(false);

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
      } else {
        await register({
          name, email, password,
          program_name: program || name,
          role,
          competition_level: competitionLevel || undefined,
          conference: competitionLevel === 'College' ? conference : undefined,
        } as any);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={undefined}
      style={{ flex: 1, backgroundColor: '#0a0a0a' }}
    >
      <KeyboardAwareScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.navigate('RoleSelect')}>
          <Ionicons name="chevron-back" size={18} color="#6b7280" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.logo}>BloomPrint</Text>
        <Text style={styles.sub}>Coach · Scout · Trainer</Text>

        {mode === 'register' && (
          <>
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
            <VoiceTextInput style={styles.input} placeholder="Full Name" placeholderTextColor="#6b7280"
              value={name} onChangeText={setName} />
            <VoiceTextInput style={styles.input} placeholder="Program / Organization Name" placeholderTextColor="#6b7280"
              value={program} onChangeText={setProgram} />

            {/* Competition Level picker */}
            <Text style={styles.sectionLabel}>Competition Level</Text>
            <TouchableOpacity
              style={styles.pickerBtn}
              onPress={() => setShowLevelPicker(true)}
            >
              <Text style={[styles.pickerBtnText, !competitionLevel && { color: '#6b7280' }]}>
                {competitionLevel || 'Select level...'}
              </Text>
              <Ionicons name="chevron-down" size={14} color="#6b7280" />
            </TouchableOpacity>

            {/* Conference / League picker — shown when the selected level has options */}
            {competitionLevel && (CONFERENCES_BY_LEVEL[competitionLevel]?.length ?? 0) > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 8 }]}>
                  {competitionLevel === 'College' ? 'Conference' : 'League / Association'}
                  {competitionLevel === 'College' && <Text style={{ color: '#ef4444' }}> *</Text>}
                </Text>
                <TouchableOpacity
                  style={[styles.pickerBtn, competitionLevel === 'College' && !conference && { borderColor: '#ef4444' }]}
                  onPress={() => setShowConferencePicker(true)}
                >
                  <Text style={[styles.pickerBtnText, !conference && { color: '#6b7280' }]}>
                    {conference || (competitionLevel === 'College' ? 'Select conference (required)...' : 'Select league (optional)...')}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color="#6b7280" />
                </TouchableOpacity>
              </>
            )}
          </>
        )}

        <VoiceTextInput
          style={[styles.input, mode === 'register' && { marginTop: 16 }]}
          placeholder="Email"
          placeholderTextColor="#6b7280"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <VoiceTextInput style={styles.input} placeholder="Password" placeholderTextColor="#6b7280"
          value={password} onChangeText={setPassword} secureTextEntry />

        <TouchableOpacity style={styles.btn} onPress={submit} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>{mode === 'login' ? 'Sign In' : 'Create Account'}</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
          <Text style={styles.toggle}>
            {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign In'}
          </Text>
        </TouchableOpacity>
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
  );
}

const pickerModalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#111827', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '80%', paddingBottom: 20,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: '#1f2937',
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  search: {
    backgroundColor: '#1f2937', borderRadius: 10, margin: 16, padding: 12,
    color: '#fff', fontSize: 14, borderWidth: 1, borderColor: '#374151',
  },
  option: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: '#1f2937',
  },
  optionActive: { backgroundColor: '#1e3a5f' },
  optionText: { color: '#d1d5db', fontSize: 15 },
});

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', padding: 24, paddingTop: 60 },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: 24, gap: 4 },
  backText: { color: '#6b7280', fontSize: 14 },
  logo: { fontSize: 36, fontWeight: '900', color: '#ffffff', letterSpacing: 1 },
  sub: { fontSize: 13, color: '#6b7280', marginBottom: 40, marginTop: 4 },
  sectionLabel: {
    alignSelf: 'flex-start', color: '#9ca3af', fontSize: 11,
    fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8,
  },
  roleRow: { flexDirection: 'row', gap: 8, width: '100%', marginBottom: 16 },
  roleChip: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: '#374151', alignItems: 'center',
  },
  roleChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  roleText: { color: '#9ca3af', fontWeight: '600', fontSize: 14 },
  roleTextActive: { color: '#fff' },
  input: {
    width: '100%', backgroundColor: '#111827', borderRadius: 10, padding: 14,
    color: '#fff', fontSize: 15, marginBottom: 12, borderWidth: 1, borderColor: '#1f2937',
  },
  btn: {
    width: '100%', backgroundColor: '#2563eb', borderRadius: 10,
    padding: 16, alignItems: 'center', marginTop: 8,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  toggle: { color: '#6b7280', marginTop: 20, fontSize: 13 },
  pickerBtn: {
    width: '100%', backgroundColor: '#111827', borderRadius: 10, padding: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4, borderWidth: 1, borderColor: '#1f2937',
  },
  pickerBtnText: { color: '#fff', fontSize: 15 },
});
