/**
 * Choosing a new password, from the link in a reset email.
 *
 * Reached signed out, by someone who cannot get in, so it is registered in the
 * signed-out navigator. It is registered in the two signed-in ones as well, for
 * the same reason Join is: whoever clicks the link may already have a session
 * on that device, and an address that matches nothing lands them on whatever
 * screen happens to be first.
 *
 * The link carries who it is for. A token says nothing about whether it belongs
 * to a coach or a player, and the alternative to being told is trying one
 * endpoint and falling back to the other, which spends the token on the guess.
 *
 * A reset ends every other session, so the person is signed straight in with
 * the token the confirm returns. Asking them to type the password they set ten
 * seconds ago would be asking them to prove something they have just proved.
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { authAPI } from '../api/client';
import { playerAuthAPI } from '../api/playerClient';
import { useAuth } from '../context/AuthContext';
import { usePlayerAuth } from '../context/PlayerAuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import AuthLayout from '../responsive/AuthLayout';

const MIN_LENGTH = 8;

export default function ResetPasswordScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);

  // Both providers wrap the whole app, so both hooks are available whichever
  // navigator this screen was reached through.
  const { applyAuth } = useAuth();
  const { applyAuth: applyPlayerAuth } = usePlayerAuth();

  const token: string = route.params?.token ?? '';
  const isPlayer = (route.params?.as ?? 'coach') === 'player';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= MIN_LENGTH && confirm === password && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (isPlayer) {
        const res = await playerAuthAPI.confirmPasswordReset(token, password);
        await applyPlayerAuth(res.access_token, res.player_user);
      } else {
        const res = await authAPI.confirmPasswordReset(token, password);
        await applyAuth(res.access_token, res.coach);
      }
      // No navigation call: the app swaps navigators once there is a session,
      // and pushing a screen here would fight that.
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? tr('resetPassword.failed'));
      setBusy(false);
    }
  };

  // A link with nothing in it cannot be recovered from on this screen, so it
  // says so and points at the one place that can start again.
  if (!token) {
    return (
      <ScreenBackground>
        <AuthLayout>
          <Text style={s.title}>{tr('resetPassword.badLinkTitle')}</Text>
          <Text style={s.sub}>{tr('resetPassword.badLinkBody')}</Text>
          <TouchableOpacity
            style={s.button}
            onPress={() => navigation.navigate(isPlayer ? 'PlayerLogin' : 'CoachLogin')}
          >
            <Text style={s.buttonText}>{tr('resetPassword.backToSignIn')}</Text>
          </TouchableOpacity>
        </AuthLayout>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <AuthLayout>
        <Text style={s.title}>{tr('resetPassword.title')}</Text>
        <Text style={s.sub}>{tr('resetPassword.sub')}</Text>

        <View style={s.field}>
          <TextInput
            style={s.input}
            placeholder={tr('resetPassword.newPassword')}
            placeholderTextColor={t.muted2}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!show}
            autoCapitalize="none"
            autoComplete="new-password"
          />
          <TouchableOpacity
            onPress={() => setShow(v => !v)}
            accessibilityLabel={tr(show ? 'resetPassword.hide' : 'resetPassword.show')}
            // Padding is the target, because hitSlop does nothing on the web.
            style={{ padding: 10, margin: -10, marginLeft: 0 }}
          >
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={18}
                      color={t.muted2} />
          </TouchableOpacity>
        </View>
        {tooShort && (
          <Text style={s.hint}>{tr('resetPassword.tooShort', { count: MIN_LENGTH })}</Text>
        )}

        <View style={s.field}>
          <TextInput
            style={s.input}
            placeholder={tr('resetPassword.confirmPassword')}
            placeholderTextColor={t.muted2}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!show}
            autoCapitalize="none"
            autoComplete="new-password"
            onSubmitEditing={submit}
          />
        </View>
        {mismatch && <Text style={s.hint}>{tr('resetPassword.mismatch')}</Text>}

        {!!error && <Text style={s.error}>{error}</Text>}

        <TouchableOpacity
          style={[s.button, !ready && s.buttonIdle]}
          onPress={submit}
          disabled={!ready}
        >
          {busy
            ? <ActivityIndicator color={t.ctaText} />
            : <Text style={s.buttonText}>{tr('resetPassword.submit')}</Text>}
        </TouchableOpacity>

        {/* Said before it happens, not after. Someone resetting because
            somebody else got in wants to know the other person is being put
            out, and someone resetting on a whim should not be surprised to
            find their tablet signed out. */}
        <Text style={s.note}>{tr('resetPassword.signsOutOthers')}</Text>
      </AuthLayout>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  title: { color: t.ink, fontSize: 26, fontFamily: fonts[900], letterSpacing: -0.5 },
  sub: { color: t.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 22 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.cardBorder,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
  },
  input: {
    flex: 1, minWidth: 0, color: t.ink, fontSize: 15, paddingVertical: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
  },
  hint: { color: t.muted, fontSize: 12.5, marginTop: -6, marginBottom: 12 },
  error: { color: t.negative, fontSize: 13.5, lineHeight: 20, marginBottom: 12 },
  button: {
    backgroundColor: t.ctaBg, borderRadius: 12, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  buttonIdle: { opacity: 0.45 },
  buttonText: { color: t.ctaText, fontSize: 15.5, fontFamily: fonts[700] },
  note: { color: t.muted2, fontSize: 12.5, lineHeight: 19, marginTop: 16, textAlign: 'center' },
});
