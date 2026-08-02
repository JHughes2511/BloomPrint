import React, { useEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
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
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_CLIENT_IDS.ios,
    androidClientId: GOOGLE_CLIENT_IDS.android,
    webClientId: GOOGLE_CLIENT_IDS.web,
    // Say the redirect URI rather than let the library derive one.
    //
    // Google matches this string exactly against the list registered in the
    // Cloud Console, and a mismatch is a dead end: redirect_uri_mismatch, on
    // Google's own error page, with nothing in our logs. The library's default
    // is built from the current URL and can carry a path or a trailing slash
    // depending on where the user happens to be standing when they sign in —
    // so the registered value would have to anticipate every page.
    //
    // window.location.origin is scheme + host + port and nothing else, which is
    // stable across every route in the app and is exactly the form registered:
    // https://bloomprint.org, https://www.bloomprint.org, http://localhost:8081.
    // Both apex and www work without listing them separately here, because each
    // serves its own origin back.
    //
    // Web only. On a phone the redirect is a deep link into the app's own
    // scheme, which the library builds correctly and window does not exist for.
    ...(Platform.OS === 'web' ? { redirectUri: window.location.origin } : {}),
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken = response.params?.id_token ?? response.authentication?.idToken;
      if (idToken) onIdToken(idToken);
      else Alert.alert(tr('components.googleSignIn.signInTitle'), tr('components.googleSignIn.noTokenReturned'));
    } else if (response?.type === 'error') {
      Alert.alert(tr('components.googleSignIn.signInTitle'), tr('components.googleSignIn.somethingWentWrong'));
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
            <Text style={[s.text, { color: t.ink }]}>{tr('components.googleSignIn.continueWithGoogle')}</Text>
          </>}
    </TouchableOpacity>
  );
}

function GoogleDisabled({ color }: Props) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  return (
    <TouchableOpacity
      style={[s.btn, { borderColor: color ?? t.line, opacity: 0.9 }]}
      onPress={() => Alert.alert(
        tr('components.googleSignIn.continueWithGoogle'),
        tr('components.googleSignIn.disabledMsg'),
      )}
    >
      <Ionicons name="logo-google" size={18} color={color ?? t.muted} />
      <Text style={[s.text, { color: t.muted }]}>{tr('components.googleSignIn.continueWithGoogle')}</Text>
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
