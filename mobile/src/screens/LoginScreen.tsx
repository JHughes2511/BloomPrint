import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';

const ROLES = [
  { key: 'coach',   label: 'Coach' },
  { key: 'scout',   label: 'Scout' },
  { key: 'trainer', label: 'Trainer' },
];

const COMPETITION_LEVELS = ['Pro', 'College', 'AAU', 'HS Varsity', 'HS JV', 'Middle School', 'Other'];

const CONFERENCES = [
  'ACC', 'Big East', 'Big Ten', 'Big 12', 'SEC',
  'American', 'Atlantic 10', 'Mountain West', 'Missouri Valley', 'WCC',
  'MAC', 'Sun Belt', 'CUSA', 'Southland', 'Patriot', 'Ivy League',
  'MAAC', 'Big South', 'NEC', 'OVC', 'Big Sky', 'WAC', 'Horizon',
  'Summit', 'CAA', 'SoCon', 'SWAC', 'MEAC', 'Independent',
];

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
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: '#0a0a0a' }}
    >
      <ScrollView
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
            <TextInput style={styles.input} placeholder="Full Name" placeholderTextColor="#6b7280"
              value={name} onChangeText={setName} />
            <TextInput style={styles.input} placeholder="Program / Organization Name" placeholderTextColor="#6b7280"
              value={program} onChangeText={setProgram} />

            {/* Competition Level picker */}
            <Text style={styles.sectionLabel}>Competition Level</Text>
            <TouchableOpacity
              style={styles.pickerBtn}
              onPress={() => { setShowLevelPicker(v => !v); setShowConferencePicker(false); }}
            >
              <Text style={[styles.pickerBtnText, !competitionLevel && { color: '#6b7280' }]}>
                {competitionLevel || 'Select level...'}
              </Text>
              <Ionicons name={showLevelPicker ? 'chevron-up' : 'chevron-down'} size={14} color="#6b7280" />
            </TouchableOpacity>
            {showLevelPicker && (
              <View style={styles.pickerDropdown}>
                {COMPETITION_LEVELS.map(lvl => (
                  <TouchableOpacity
                    key={lvl}
                    style={[styles.pickerOption, competitionLevel === lvl && styles.pickerOptionActive]}
                    onPress={() => { setCompetitionLevel(lvl); setShowLevelPicker(false); if (lvl !== 'College') setConference(''); }}
                  >
                    <Text style={[styles.pickerOptionText, competitionLevel === lvl && { color: '#fff', fontWeight: '700' }]}>{lvl}</Text>
                    {competitionLevel === lvl && <Ionicons name="checkmark" size={14} color="#2563eb" />}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Conference picker — shown only when College is selected */}
            {competitionLevel === 'College' && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 8 }]}>
                  Conference <Text style={{ color: '#ef4444' }}>*</Text>
                </Text>
                <TouchableOpacity
                  style={[styles.pickerBtn, !conference && { borderColor: '#ef4444' }]}
                  onPress={() => { setShowConferencePicker(v => !v); setShowLevelPicker(false); }}
                >
                  <Text style={[styles.pickerBtnText, !conference && { color: '#6b7280' }]}>
                    {conference || 'Select conference (required)...'}
                  </Text>
                  <Ionicons name={showConferencePicker ? 'chevron-up' : 'chevron-down'} size={14} color="#6b7280" />
                </TouchableOpacity>
                {showConferencePicker && (
                  <View style={styles.pickerDropdown}>
                    {CONFERENCES.map(conf => (
                      <TouchableOpacity
                        key={conf}
                        style={[styles.pickerOption, conference === conf && styles.pickerOptionActive]}
                        onPress={() => { setConference(conf); setShowConferencePicker(false); }}
                      >
                        <Text style={[styles.pickerOptionText, conference === conf && { color: '#fff', fontWeight: '700' }]}>{conf}</Text>
                        {conference === conf && <Ionicons name="checkmark" size={14} color="#2563eb" />}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}
          </>
        )}

        <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#6b7280"
          value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#6b7280"
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

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
  pickerDropdown: {
    width: '100%', backgroundColor: '#0a0a0a', borderRadius: 10,
    borderWidth: 1, borderColor: '#374151', marginBottom: 12, overflow: 'hidden',
    maxHeight: 220,
  },
  pickerOption: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: '#1f2937',
  },
  pickerOptionActive: { backgroundColor: '#1e3a5f' },
  pickerOptionText: { color: '#d1d5db', fontSize: 14 },
});
