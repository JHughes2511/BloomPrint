# BloomPrint — Production Readiness Audit
_Audited 2026-07-19 · covers backend, mobile app-store readiness, and web/browser readiness_

## Verdict

The app is feature-rich and structurally sound, but it is currently a **single-laptop system**: the server assumes your Mac (SQLite file, local uploads folder, dev launcher), the mobile app assumes your laptop's IP, and the web build doesn't start yet. Nothing here is unusual for this stage, and nothing is architecturally broken — but there are **12 blockers** to clear before real users touch it.

---

## Part 1 — Backend (getting off your Mac)

### Blockers
1. **Hardcoded login secrets.** The key that signs player logins is a fixed string committed in the code (`api/routes/player_auth.py:13`); the coach key defaults to `"change-me-in-production"` (`api/auth.py:13`). Anyone with the code could forge logins. → Both must come from environment variables, and the server must refuse to start without them.
2. **Database is SQLite with SQLite-only migrations.** `api/database.py` hardwires a local `bloomprint.db` file and ~680 lines of `PRAGMA`-based patches that cannot run on Postgres. SQLite also allows only one writer — it will lock up under real traffic. → Add `DATABASE_URL` support + Alembic migrations, deploy on Postgres.
3. **CORS is wide open** (`api/main.py:12-18`): `allow_origins=["*"]` with credentials. → Explicit origin allowlist for the web app + marketing domain.
4. **The voice-transcription endpoint has no login check** (`api/routes/transcribe.py:39`) and no size limit — anyone on the internet could upload unlimited audio and burn server compute. → Require auth + cap size + rate-limit.
5. **Background jobs die with the server.** Film analysis runs inside the web process (`BackgroundTasks`). On a real host with multiple workers/restarts, jobs get lost mid-run with status stuck "processing" forever. → Short-term: single worker + persistent job recovery. Right answer: a separate worker/queue service for film jobs.
6. **Uploaded film lives in a local `uploads/` folder.** On cloud hosts the disk is wiped on every deploy — all film vanishes. The good news: **S3 support is already built** in `api/storage.py` (presigned URLs and all) — it just needs `STORAGE_S3_BUCKET` + credentials set.

### High
- No deployment artifacts at all (no Dockerfile; `run.sh` uses `--reload`, hardcodes port 8000, ignores `$PORT`).
- The video pipeline needs system **ffmpeg** + multi-GB **torch/whisper** installs; Whisper device selection assumes a Mac (MPS) — on Linux it silently drops to slow CPU. Decide: does the API server carry the video stack, or does a separate worker?
- Coach passwords use weak `sha256_crypt` while players use bcrypt → standardize on bcrypt.
- No upload size limits anywhere; some handlers read entire files into memory.
- No rate limiting on login/registration/AI endpoints.
- `sys.path.insert(0, ".")` hacks make imports depend on the process's working directory.
- Error responses leak raw exception text (`f"AI generation failed: {exc}"` in ~20 places).

### Medium
- Temp files from S3 video streaming never get cleaned up.
- No logging setup / error tracking (Sentry).
- `/docs` (full API schema) is public.
- 72-hour coach tokens / 30-day player tokens with no revocation.
- Whisper model re-downloads on every deploy (ephemeral cache).
- The git-pinned whisper dependency makes builds non-reproducible.

### Already good
- S3 storage layer complete (presigned playback, streamed saves).
- Job *status* is persisted in DB (clients poll — survives reconnects).
- `/health` endpoint exists. Upload filenames are server-generated (no path traversal). SMTP/Google degrade cleanly when unconfigured.

---

## Part 2 — Mobile app (App Store / TestFlight)

### Blockers
1. **API URL falls back to `http://localhost:8000`** (`client.ts:5`, `playerClient.ts:4`) and is baked in at build time. Production builds need `EXPO_PUBLIC_API_URL=https://api.<domain>` — and iOS blocks plain HTTP, so the API must be HTTPS.
2. **Google Sign-In is silently dead in every build**: `expo-auth-session` / `expo-web-browser` aren't installed, and no client IDs are configured — the button always shows the "coming soon" alert. Needs: install both packages, create iOS/Android/Web OAuth clients in Google Cloud, set 3 env vars + backend `GOOGLE_CLIENT_ID`.
3. **No app icon or splash assets** — `app.json` points at `./assets/icon.png`, which doesn't exist (only `court.png` is there). Store submission fails without a 1024×1024 icon, adaptive icon, and splash.
4. **No `eas.json`** — no build profiles, so no store builds can be produced yet.

### High
- No iOS `buildNumber` / Android `versionCode` / `runtimeVersion` in `app.json`.
- Player-side API client has no timeout (hangs forever on bad networks).
- No 401 handling (expired token leaves the app broken until manual re-login), no error boundary (a render crash white-screens).
- Add `NSPhotoLibraryAddUsageDescription`; review deprecated `READ_EXTERNAL_STORAGE` Android permission.

### Medium
- Staff-chat polls the server every 5s per open conversation — fine now, needs push/websocket at scale.
- `expo-av` is deprecated (voice recording) → plan migration to `expo-audio`.
- `expo-router` is installed but unused (dead weight).

### Already good
- Tokens stored in SecureStore (correct). Zero stray `console.log`s. Exports use the OS-evictable cache dir. Deep-link scheme `bloomprint` already set.

---

## Part 3 — Web / browser readiness

### Where it stands
`npx expo start --web` **won't currently start**: `react-native-web` and `react-dom` aren't installed and there's no `web` config block. Once those are added, the UI layer is in good shape — navigation, the whiteboard (SVG + gestures work with a mouse), QR generation, modals, fonts, theming all run on web. But two systems break hard:

1. **Login/session** — SecureStore has no web version, and it's used at boot + in every API call. **Fix:** one small `secureStorage.ts` wrapper that uses SecureStore on device and localStorage on web (5 call sites).
2. **File flows** — every PDF/CSV export, the streamed video upload, and voice-message encoding go through `expo-file-system`, which doesn't exist on web. **Fix:** platform-branch to browser equivalents (Blob + download link, `FormData` upload, `FileReader`). The browser print dialog (`Print.printAsync`) already works and covers "Save as PDF".

### Degraded but acceptable
Image/document pickers (become file-choose dialogs), audio recording (works in Chrome over HTTPS), multi-button alerts (collapse to OK/Cancel), QR *scanning* (unreliable on web — fall back to typing the invite code), camera capture (hide on web), authed video playback (needs presigned URLs on web — already supported when S3 is on).

Notably there is currently **zero** `Platform.OS === 'web'` handling in the codebase — all of the above is net-new branching, but each branch is small.

---

## Recommended path (in order)

**Phase 1 — Security + config hygiene (code-only, do now)**
Env-var JWT secrets w/ fail-fast · auth + limits on /transcribe · CORS allowlist · bcrypt for coaches · stop leaking exception text · `DATABASE_URL` support · `$PORT` binding + no-reload prod launch · upload size caps · basic rate limiting on auth endpoints.

**Phase 2 — Make it deployable**
Dockerfile (with ffmpeg; decide video-stack placement) · Alembic migrations · Postgres · S3 bucket (R2/S3) with env config · deploy API to a host (Railway/Render/Fly) · point a domain + HTTPS at it · Sentry + logging.

**Phase 3 — Ship the mobile app**
Set `EXPO_PUBLIC_API_URL` to prod · icon/splash assets · `eas.json` + version numbers · Google OAuth clients + packages · playerClient timeout + 401 interceptor + error boundary · permission strings · EAS build → TestFlight.

**Phase 4 — Web build**
Install react-native-web/react-dom + web config · storage shim · platform-branch file flows (upload, export, voice) · guard shares · QR manual-entry fallback · deploy web (Vercel/Netlify static or Expo hosting).

The audits' full file:line detail is preserved in the sections above.
