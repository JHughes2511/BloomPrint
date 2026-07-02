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
        <Text style={styles.brand}>BloomPrint</Text>
        <Text style={styles.title}>Who are you?</Text>
        <Text style={styles.sub}>Choose how you'll use BloomPrint. You can switch later in settings.</Text>

        <View style={styles.cards}>
          <TouchableOpacity
            style={[styles.card, { borderWidth: 1.5, borderColor: t.accent }]}
            onPress={() => navigation.navigate('CoachLogin')}
          >
            <View style={[styles.tile, { backgroundColor: t.accentSoft }]}>
              <Ionicons name="clipboard-outline" size={28} color={t.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Coach</Text>
              <Text style={styles.cardDesc}>Build reports, track games, evaluate your roster</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={t.accent} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.card, { borderWidth: 1, borderColor: t.cardBorder }]}
            onPress={() => navigation.navigate('PlayerLogin')}
          >
            <View style={[styles.tile, { backgroundColor: t.brownSoft }]}>
              <Ionicons name="person-outline" size={28} color={t.brown} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Player</Text>
              <Text style={styles.cardDesc}>Receive reports, follow training, track your growth</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={t.muted2} />
          </TouchableOpacity>
        </View>

      </View>
    </SafeAreaView>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 30 },
  brand: {
    fontFamily: fonts[800], fontSize: 14, letterSpacing: 2.8,
    textTransform: 'uppercase', color: t.label, textAlign: 'center',
  },
  title: {
    fontFamily: fonts[800], fontSize: 34, letterSpacing: -0.7,
    color: t.ink, textAlign: 'center', marginTop: 14, lineHeight: 38,
  },
  sub: { fontSize: 15, color: t.muted, textAlign: 'center', marginTop: 10, lineHeight: 22 },
  cards: { marginTop: 40, gap: 15 },
  card: {
    backgroundColor: t.card, borderRadius: 22, padding: 22,
    flexDirection: 'row', alignItems: 'center', gap: 16,
  },
  tile: {
    width: 58, height: 58, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontFamily: fonts[800], fontSize: 20, color: t.ink },
  cardDesc: { fontSize: 13.5, color: t.muted, marginTop: 3, lineHeight: 19 },
  signin: { textAlign: 'center', marginTop: 34, fontSize: 14, color: t.muted },
  signinLink: { color: t.label, fontFamily: fonts[800] },
});
