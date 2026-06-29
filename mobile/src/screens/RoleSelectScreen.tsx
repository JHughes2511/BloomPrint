import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';

export default function RoleSelectScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTheme();
  const styles = makeStyles(t);

  return (
    <ScreenBackground>
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.logo}>BloomPrint</Text>
        <Text style={styles.sub}>Basketball Intelligence Model</Text>
        <Text style={styles.prompt}>Who are you?</Text>

        <TouchableOpacity
          style={[styles.card, styles.coachCard]}
          onPress={() => navigation.navigate('CoachLogin')}
        >
          <View style={[styles.iconBg, { backgroundColor: t.accentSoft }]}>
            <Ionicons name="clipboard" size={32} color={t.accent} />
          </View>
          <Text style={styles.cardTitle}>Coach / Scout / Trainer</Text>
          <Text style={styles.cardDesc}>
            Evaluate players, generate reports, and manage your roster
          </Text>
          <View style={[styles.arrow, { backgroundColor: t.accent }]}>
            <Ionicons name="arrow-forward" size={16} color={t.ctaText} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.card, styles.playerCard]}
          onPress={() => navigation.navigate('PlayerLogin')}
        >
          <View style={[styles.iconBg, { backgroundColor: t.positiveSoft }]}>
            <Ionicons name="basketball" size={32} color={t.positive} />
          </View>
          <Text style={styles.cardTitle}>Player</Text>
          <Text style={styles.cardDesc}>
            View your evaluations, training programs, and coach feedback
          </Text>
          <View style={[styles.arrow, { backgroundColor: t.positive }]}>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
          </View>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1 },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logo: { fontSize: 38, fontFamily: fonts[900], color: t.ink, letterSpacing: 1 },
  sub: { fontSize: 13, color: t.muted, marginBottom: 8, marginTop: 4 },
  prompt: { fontSize: 18, color: t.inkSoft, fontFamily: fonts[700], marginBottom: 32, marginTop: 16 },
  card: {
    width: '100%',
    borderRadius: 20,
    padding: 24,
    marginBottom: 16,
    borderWidth: 1,
    position: 'relative',
    backgroundColor: t.card,
  },
  coachCard: { borderColor: t.accent },
  playerCard: { borderColor: t.positive },
  iconBg: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  cardTitle: { color: t.ink, fontSize: 18, fontFamily: fonts[800], marginBottom: 6 },
  cardDesc: { color: t.muted, fontSize: 13, lineHeight: 19, paddingRight: 32 },
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
