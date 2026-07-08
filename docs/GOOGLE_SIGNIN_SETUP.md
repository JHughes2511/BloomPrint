# Google Sign-In — activation checklist (do this at deploy)

The full "Continue with Google" flow is already wired into the app and API. It
is **gated**: until the steps below are done, the button shows a friendly
"enabled at launch" notice and email/password keeps working. Nothing here
changes app behavior for existing users.

Design note: Google only provides identity (name + email). A **new** user still
completes every required field for their portal before the account is created —
coaches finish the signup form (role, competition level, conference if College,
location); players complete the coach-link flow after signing up.

## 1. Create Google OAuth credentials

In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services
→ Credentials, create an **OAuth 2.0 Client ID** for each platform you ship:

- **Web application** (used for token verification and Expo web)
- **iOS** (bundle id must match `mobile/app.json` → `ios.bundleIdentifier`)
- **Android** (package name + SHA-1 from your signing key)

Configure the OAuth consent screen (external), and add the scopes `openid`,
`email`, `profile`.

## 2. Install the mobile packages

From `mobile/`:

```
npx expo install expo-auth-session expo-web-browser expo-crypto
```

(The code already imports these defensively, so the app runs fine before they
are installed.)

Add a URL scheme for the OAuth redirect in `mobile/app.json` (Expo AuthSession
uses it): set `expo.scheme` to e.g. `"bloomprint"`.

## 3. Set the client IDs (mobile — build-time env)

Expo inlines `EXPO_PUBLIC_*` env vars at build time. Set:

```
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<ios client id>.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=<android client id>.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web client id>.apps.googleusercontent.com
```

`mobile/src/config/google.ts` reads these; `isGoogleConfigured` flips to true
once any is present, which activates the real OAuth button.

## 4. Set the client IDs (backend — token verification)

The API verifies the Google token's audience against `GOOGLE_CLIENT_ID`
(comma-separated to trust all of your platform client IDs):

```
GOOGLE_CLIENT_ID=<web id>.apps.googleusercontent.com,<ios id>.apps.googleusercontent.com,<android id>.apps.googleusercontent.com
```

`google-auth` is already declared in `pyproject.toml`; it installs with the API
(`pip install -e .`). Until `GOOGLE_CLIENT_ID` is set, the `/auth/google` and
`/player-auth/google` endpoints return a clear "not configured" message.

## 5. Verify

- Coach portal: Login → "Continue with Google". New Google user is routed into
  the signup form (name/email prefilled, no password) and must pick role /
  level / conference / location before "Create Account".
- Player portal: Login → "Continue with Google". New user lands on Create
  Account (prefilled), then the coach-link step.
- Returning Google users sign straight in. A Google email matching an existing
  email/password account links to it and signs in.

## What's already built

- Backend: `api/google_auth.py` (token verify), `POST /auth/google`,
  `POST /player-auth/google`, `google_sub` columns + migrations.
- Mobile: `src/config/google.ts`, `src/components/GoogleSignInButton.tsx`
  (safe/gated), client + context methods, buttons on coach and player
  login/signup with the required-field completion flow.
