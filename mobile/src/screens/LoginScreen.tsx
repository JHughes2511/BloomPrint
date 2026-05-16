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

export default function LoginScreen() {
  const { login, register } = useAuth();
  const navigation = useNavigation<any>();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [program, setProgram] = useState('');
  const [role, setRole] = useState('coach');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register({ name, email, password, program_name: program || name, role });
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
});
