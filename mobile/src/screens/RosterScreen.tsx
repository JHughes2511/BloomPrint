import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Modal, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playersAPI } from '../api/client';
import { Player } from '../types';
import { GradeBadge } from '../components/GradeBadge';
import { useAuth } from '../context/AuthContext';

export default function RosterScreen() {
  const navigation = useNavigation<any>();
  const { coach } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPos, setNewPos] = useState('');
  const [newLevel, setNewLevel] = useState('HS Varsity');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setPlayers(await playersAPI.list());
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const addPlayer = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await playersAPI.create({ name: newName, position: newPos, competition_level: newLevel });
      setShowAdd(false);
      setNewName(''); setNewPos('');
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not add player');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#2563eb" size="large" /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Roster</Text>
          <Text style={styles.sub}>{coach?.program_name} · {players.length} players</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={players}
        keyExtractor={p => String(p.id)}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('PlayerProfile', { playerId: item.id })}>
            <View style={styles.cardLeft}>
              <Text style={styles.playerName}>{item.name}</Text>
              <Text style={styles.playerMeta}>{[item.position, item.competition_level].filter(Boolean).join(' · ')}</Text>
            </View>
            <GradeBadge grade={item.latest_grade} size="md" />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No players yet. Add your first player.</Text>
          </View>
        }
      />

      <Modal visible={showAdd} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Add Player</Text>
            <TextInput style={styles.input} placeholder="Full Name *" placeholderTextColor="#6b7280"
              value={newName} onChangeText={setNewName} />
            <TextInput style={styles.input} placeholder="Position (e.g. PG, SG)" placeholderTextColor="#6b7280"
              value={newPos} onChangeText={setNewPos} />
            <TextInput style={styles.input} placeholder="Competition Level" placeholderTextColor="#6b7280"
              value={newLevel} onChangeText={setNewLevel} />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={addPlayer} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Add</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', paddingTop: 56 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 20 },
  title: { fontSize: 28, fontWeight: '900', color: '#fff' },
  sub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  addBtn: { backgroundColor: '#2563eb', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#111827', marginHorizontal: 16, marginBottom: 10,
    borderRadius: 12, padding: 16,
  },
  cardLeft: { flex: 1 },
  playerName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  playerMeta: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  emptyText: { color: '#6b7280', marginTop: 60 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#111827', borderRadius: 20, padding: 24, margin: 16 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 16 },
  input: {
    backgroundColor: '#1f2937', borderRadius: 10, padding: 14,
    color: '#fff', fontSize: 14, marginBottom: 10,
  },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#374151', alignItems: 'center' },
  cancelText: { color: '#9ca3af', fontWeight: '600' },
  saveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#2563eb', alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700' },
});
