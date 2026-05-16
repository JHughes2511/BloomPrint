import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

export default function RoleSelectScreen() {
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.logo}>BloomPrint</Text>
        <Text style={styles.sub}>Basketball Intelligence Model</Text>
        <Text style={styles.prompt}>Who are you?</Text>

        <TouchableOpacity
          style={[styles.card, styles.coachCard]}
          onPress={() => navigation.navigate('CoachLogin')}
        >
          <View style={[styles.iconBg, { backgroundColor: '#2563eb22' }]}>
            <Ionicons name="clipboard" size={32} color="#2563eb" />
          </View>
          <Text style={styles.cardTitle}>Coach / Scout / Trainer</Text>
          <Text style={styles.cardDesc}>
            Evaluate players, generate reports, and manage your roster
          </Text>
          <View style={[styles.arrow, { backgroundColor: '#2563eb' }]}>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.card, styles.playerCard]}
          onPress={() => navigation.navigate('PlayerLogin')}
        >
          <View style={[styles.iconBg, { backgroundColor: '#16a34a22' }]}>
            <Ionicons name="basketball" size={32} color="#16a34a" />
          </View>
          <Text style={styles.cardTitle}>Player</Text>
          <Text style={styles.cardDesc}>
            View your evaluations, training programs, and coach feedback
          </Text>
          <View style={[styles.arrow, { backgroundColor: '#16a34a' }]}>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
          </View>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logo: { fontSize: 38, fontWeight: '900', color: '#fff', letterSpacing: 1 },
  sub: { fontSize: 13, color: '#6b7280', marginBottom: 8, marginTop: 4 },
  prompt: { fontSize: 18, color: '#9ca3af', fontWeight: '600', marginBottom: 32, marginTop: 16 },
  card: {
    width: '100%',
    borderRadius: 20,
    padding: 24,
    marginBottom: 16,
    borderWidth: 1,
    position: 'relative',
  },
  coachCard: { backgroundColor: '#111827', borderColor: '#2563eb' },
  playerCard: { backgroundColor: '#1a2e1a', borderColor: '#16a34a' },
  iconBg: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  cardTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 6 },
  cardDesc: { color: '#6b7280', fontSize: 13, lineHeight: 19, paddingRight: 32 },
  arrow: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
