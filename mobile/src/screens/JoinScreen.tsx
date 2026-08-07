import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { teamInviteAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { usePlayerAuth } from '../context/PlayerAuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer from '../responsive/PageContainer';
import { topPad } from '../responsive/screenPadding';

/**
 * Where an invite link lands.
 *
 * Reachable signed OUT — that is the point of it. The public call shows only
 * the team and who invited them, then the visitor says which they are and is
 * sent to the matching signup with the code in hand. Coming back signed in,
 * the join happens immediately.
 *
 * A player who signs up is asked which roster name is theirs, so the evals and
 * history a coach has already built stay attached to the same person instead
 * of starting a second, empty record beside it.
 */
export default function JoinScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const { coach } = useAuth();
  const { playerUser, refreshUser } = usePlayerAuth();

  const code: string = route.params?.code ?? '';
  const [info, setInfo] = useState<any | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Player branch: which roster name are they?
  const [roster, setRoster] = useState<any[] | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!code) { setError(tr('join.badLink')); setLoading(false); return; }
    teamInviteAPI.peek(code)
      .then(setInfo)
      .catch((e: any) => setError(e?.response?.data?.detail ?? tr('join.badLink')))
      .finally(() => setLoading(false));
  }, [code]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Signed in as a player already: go straight to picking their name.
  useEffect(() => {
    if (playerUser && info && roster === null) loadRoster();
  }, [playerUser, info]);   // eslint-disable-line react-hooks/exhaustive-deps

  const loadRoster = async () => {
    try {
      const r = await teamInviteAPI.unclaimedRoster(code);
      setRoster(r.players ?? []);
    } catch (e: any) {
      setRoster([]);
    }
  };

  const joinStaff = async () => {
    setBusy(true);
    try {
      const r = await teamInviteAPI.joinAsStaff(code);
      Alert.alert(tr('join.welcomeTitle'), tr('join.joinedTeam', { team: r.team_name }));
      navigation.reset({ index: 0, routes: [{ name: 'HomeTab' }] });
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('join.couldNotJoin'));
    } finally { setBusy(false); }
  };

  const claim = async (playerId?: number) => {
    setBusy(true);
    try {
      const r = await teamInviteAPI.joinAsPlayer(code, playerId ? { player_id: playerId } : { name: newName.trim() });
      // The account in memory still says "no player" — it was read at signup,
      // before this claim existed. Without refreshing it the player lands on a
      // home screen telling them they are not linked to anyone.
      await refreshUser().catch(() => {});
      Alert.alert(tr('join.welcomeTitle'), tr('join.joinedTeam', { team: r.team_name }));
      navigation.reset({ index: 0, routes: [{ name: 'PlayerHomeTab' }] });
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('join.couldNotJoin'));
    } finally { setBusy(false); }
  };

  if (loading) {
    return (
      <ScreenBackground><View style={s.center}><ActivityIndicator color={t.accent} size="large" /></View></ScreenBackground>
    );
  }

  if (error) {
    return (
      <ScreenBackground>
        <View style={s.center}>
          <Ionicons name="link-outline" size={40} color={t.muted2} />
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity style={s.secondary} onPress={() => navigation.navigate('RoleSelect')}>
            <Text style={s.secondaryText}>{tr('join.goToApp')}</Text>
          </TouchableOpacity>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <PageContainer maxWidth={640}>
        <View style={{ paddingHorizontal: 24, paddingTop: topPad(48) }}>
          <Text style={s.kicker}>{tr('join.invitedBy', { name: info?.invited_by ?? '' })}</Text>
          <Text style={s.team} numberOfLines={2}>{info?.team_name}</Text>

          {/* Already a player: which one are you? */}
          {playerUser && roster !== null ? (
            <View style={{ marginTop: 22 }}>
              <Text style={s.question}>{tr('join.whichOne')}</Text>
              {roster.map(p => (
                <TouchableOpacity key={p.id} style={s.row} onPress={() => claim(p.id)} disabled={busy}>
                  <Text style={s.rowName} numberOfLines={1}>{p.name}</Text>
                  {!!p.position && <Text style={s.rowMeta}>{p.position}</Text>}
                  <Ionicons name="chevron-forward" size={16} color={t.line} />
                </TouchableOpacity>
              ))}
              <Text style={[s.question, { marginTop: 18 }]}>{tr('join.notListed')}</Text>
              <TextInput
                style={s.input}
                value={newName}
                onChangeText={setNewName}
                placeholder={tr('join.yourName')}
                placeholderTextColor={t.muted2}
              />
              <TouchableOpacity
                style={[s.primary, !newName.trim() && { opacity: 0.5 }]}
                onPress={() => claim()}
                disabled={busy || !newName.trim()}
              >
                {busy ? <ActivityIndicator color={t.ctaText} /> :
                  <Text style={s.primaryText}>{tr('join.addMe')}</Text>}
              </TouchableOpacity>
            </View>
          ) : coach ? (
            /* Already a coach: one tap. */
            <View style={{ marginTop: 22 }}>
              <TouchableOpacity style={s.primary} onPress={joinStaff} disabled={busy}>
                {busy ? <ActivityIndicator color={t.ctaText} /> :
                  <Text style={s.primaryText}>{tr('join.joinAsStaffNow', { team: info?.team_name ?? '' })}</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            /* Signed out: which are you? */
            <View style={{ marginTop: 22 }}>
              <Text style={s.question}>{tr('join.whoAreYou')}</Text>
              <TouchableOpacity
                style={s.choice}
                onPress={() => navigation.navigate('PlayerRegister', {
                  joinCode: code, joinTeam: info?.team_name,
                })}
              >
                <Ionicons name="person-outline" size={20} color={t.accent} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.choiceTitle}>{tr('join.iAmPlayer')}</Text>
                  <Text style={s.choiceSub} numberOfLines={2}>{tr('join.iAmPlayerSub')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={t.line} />
              </TouchableOpacity>

              <TouchableOpacity
                style={s.choice}
                // Straight to the REGISTER form, not the sign-in one: someone
                // arriving from an invite has, by definition, been sent here to
                // create an account. Signing in is one tap away underneath it.
                onPress={() => navigation.navigate('CoachLogin', {
                  joinCode: code,
                  mode: 'register',
                  joinTeam: info?.team_name,
                  joinProgram: info?.program,
                  joinLevel: info?.competition_level,
                })}
              >
                <Ionicons name="people-outline" size={20} color={t.accent} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.choiceTitle}>{tr('join.iAmStaff')}</Text>
                  <Text style={s.choiceSub} numberOfLines={2}>{tr('join.iAmStaffSub')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={t.line} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </PageContainer>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  errorText: { color: t.ink, fontSize: 15, textAlign: 'center' },
  kicker: { color: t.label, fontSize: 12, fontFamily: fonts[700], textTransform: 'uppercase', letterSpacing: 1 },
  team: { color: t.ink, fontSize: 30, fontFamily: fonts[800], letterSpacing: -0.6, marginTop: 6 },
  question: { color: t.muted, fontSize: 13, fontFamily: fonts[600], marginBottom: 10 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, borderRadius: 14, padding: 16, marginBottom: 10 },
  choiceTitle: { color: t.ink, fontSize: 15, fontFamily: fonts[700] },
  choiceSub: { color: t.muted2, fontSize: 12, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8 },
  rowName: { flex: 1, color: t.ink, fontSize: 14.5, fontFamily: fonts[600] },
  rowMeta: { color: t.muted2, fontSize: 12 },
  input: { backgroundColor: t.card, borderRadius: 12, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line },
  primary: { backgroundColor: t.ctaBg, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 12 },
  primaryText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 15 },
  secondary: { borderWidth: 1, borderColor: t.line, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20 },
  secondaryText: { color: t.ink, fontFamily: fonts[700], fontSize: 14 },
});
