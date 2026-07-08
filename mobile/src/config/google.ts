// Google Sign-In configuration.
//
// These come from environment variables inlined at build time. Until they are
// set (i.e. before deploy) the app treats Google sign-in as "not configured"
// and the buttons show a friendly notice instead of attempting OAuth.
//
// At deploy, create an OAuth 2.0 Client in Google Cloud Console and set:
//   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
//   EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
//   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
// The backend must also have GOOGLE_CLIENT_ID set to the same client id(s)
// (comma-separated) so it can verify the returned token.

export const GOOGLE_CLIENT_IDS = {
  ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || undefined,
  android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || undefined,
  web: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined,
};

export const isGoogleConfigured = !!(
  GOOGLE_CLIENT_IDS.ios || GOOGLE_CLIENT_IDS.android || GOOGLE_CLIENT_IDS.web
);
