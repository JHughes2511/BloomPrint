import React, { useEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { GOOGLE_CLIENT_IDS, isGoogleConfigured } from '../config/google';

// Guarded requires: these native packages are only installed at deploy time.
// If they're absent the app must NOT crash — we fall back to the disabled button.
let Google: any = null;
let WebBrowser: any = null;
try {
  Google = require('expo-auth-session/providers/google');
  WebBrowser = require('expo-web-browser');
  WebBrowser?.maybeCompleteAuthSession?.();
} catch {
  Google = null;
}

const GOOGLE_AVAILABLE = !!Google && isGoogleConfigured;

type Props = {
  onIdToken: (idToken: string) => void;
  busy?: boolean;
  color?: string;   // accent color for the icon/border
};

/**
 * "Continue with Google" button. Wired end-to-end but gated: it only performs
 * real OAuth once the packages are installed AND client IDs are configured.
 * Until then it shows a friendly "enabled at launch" notice.
 */
export default function GoogleSignInButton(props: Props) {
  if (GOOGLE_AVAILABLE) return <GoogleReady {...props} />;
  return <GoogleDisabled {...props} />;
}

function GoogleReady({ onIdToken, busy, color }: Props) {
  const { t } = useTheme();
  const s = makeStyles(t);
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_CLIENT_IDS.ios,
    androidClientId: GOOGLE_CLIENT_IDS.android,
    webClientId: GOOGLE_CLIENT_IDS.web,
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken = response.params?.id_token ?? response.authentication?.idToken;
      if (idToken) onIdToken(idToken);
      else Alert.alert('Google sign-in', 'No token returned. Please try again.');
    } else if (response?.type === 'error') {
      Alert.alert('Google sign-in', 'Something went wrong signing in with Google.');
    }
  }, [response]);

  return (
    <TouchableOpacity
      style={[s.btn, { borderColor: color ?? t.line }]}
      onPress={() => promptAsync()}
      disabled={busy || !request}
    >
      {busy
        ? <ActivityIndicator color={color ?? t.ink} />
        : <>
            <Ionicons name="logo-google" size={18} color={color ?? t.ink} />
            <Text style={[s.text, { color: t.ink }]}>Continue with Google</Text>
          </>}
    </TouchableOpacity>
  );
}

function GoogleDisabled({ color }: Props) {
  const { t } = useTheme();
  const s = makeStyles(t);
  return (
    <TouchableOpacity
      style={[s.btn, { borderColor: color ?? t.line, opacity: 0.9 }]}
      onPress={() => Alert.alert(
        'Continue with Google',
        'Google sign-in will be enabled when the app launches. For now, please use email and password.',
      )}
    >
      <Ionicons name="logo-google" size={18} color={color ?? t.muted} />
      <Text style={[s.text, { color: t.muted }]}>Continue with Google</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  btn: {
    width: '100%', backgroundColor: t.card, borderRadius: 10, padding: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderWidth: 1, marginTop: 4,
  },
  text: { fontFamily: fonts[700], fontSize: 15 },
});
