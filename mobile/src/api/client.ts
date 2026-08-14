import axios from 'axios';
import { Platform } from 'react-native';
import * as SecureStore from '../storage/secureStore';
import * as FileSystem from 'expo-file-system/legacy';
import { emitCoachUnauthorized } from './authFailure';
import { playerApi } from './playerClient';
import { noteJobStarted } from '../jobs/jobRoutes';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

export const api = axios.create({ baseURL: BASE_URL, timeout: 120000 });

/** Something a coach taught BloomPrint by correcting a report. */
export type CoachPreference = {
  id: number;
  team_id: number | null;
  team_name: string | null;
  text: string;
  source: string;
  active: boolean;
  created_at: string;
};

/** A player another coach on the team has, waiting to be added or turned down. */
export type RosterProposal = {
  id: number;
  team_id: number;
  team_name: string;
  player_id: number;
  player_name: string;
  jersey_number: string | null;
  position: string | null;
  proposed_by_name: string;
};

/** One written sentence on the scouting page, and whether it is out of date. */
export type ScoutInsightOut = {
  insight: string;
  games: number;
  cached?: boolean;
  /** There is written material about the team this sentence predates. */
  stale?: boolean;
  material?: number;
  material_now?: number;
};

/** A long job of this coach's, as the app-wide banner reads it. */
export type ActiveJob = {
  id: number;
  kind: string;
  status: 'processing' | 'done' | 'error';
  progress: string | null;
  result_id: number | null;
  error: string | null;
  /** English fallback; the client renders jobs.kinds.<kind> where it has one. */
  label: string;
  updated_at: string | null;
};

/**
 * Upload a video (or any file) without building the multipart body in JS memory.
 *
 * Native uses FileSystem.uploadAsync, which streams from disk in native code —
 * React Native's FormData loads the whole file into JS heap first and dies with
 * "Failed to grow buffer" on long film.
 *
 * The web has no uploadAsync (expo-file-system ships no web implementation of
 * it) and doesn't need one: a browser's FormData takes a Blob by reference and
 * the network stack streams it, so the OOM this function exists to avoid is a
 * React Native problem the browser never had.
 */
export type UploadProgress = { sent: number; total: number; fraction: number };

/**
 * A blob: or data: URL read back as a Blob, for callers that only kept the URL.
 *
 * Prefer passing the File itself where one exists. This path is the fallback,
 * and it fails on very large files — so it says which file and why, instead of
 * surfacing the browser's bare "Failed to fetch".
 */
async function blobFromUrl(url: string): Promise<Blob> {
  try {
    return await (await fetch(url)).blob();
  } catch {
    throw new Error("The browser could not read the selected file. Try picking it again, or move it out of a cloud folder (iCloud, OneDrive, Google Drive) onto this computer first.");
  }
}

export async function uploadFileStreamed(
  path: string,
  file: string | Blob,
  parameters: Record<string, string> = {},
  fieldName = 'video',
  mimeType = 'video/mp4',
  onProgress?: (p: UploadProgress) => void,
): Promise<any> {
  const token = await SecureStore.getItemAsync('auth_token');
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  if (Platform.OS === 'web') {
    // Web pickers hand back the File itself alongside a blob: URL for it, and
    // the File is what should be uploaded. Reading the URL back with fetch()
    // asks the browser to produce a second Blob for bytes it is already holding
    // — on a multi-gigabyte game film that is where it gives up, with nothing
    // but "Failed to fetch" to say so. A File is already a disk-backed Blob, so
    // handing it to FormData streams it without copying anything.
    const blob = typeof file === 'string' ? await blobFromUrl(file) : file;
    const form = new FormData();
    // The three-argument append (value + filename) is the DOM signature; React
    // Native's FormData typing only declares two, so this is cast rather than
    // restructured — at runtime on web this is the browser's FormData.
    const name = (blob as File)?.name || `upload.${mimeType.split('/')[1] || 'mp4'}`;
    (form.append as any)(fieldName, blob, name);
    for (const [k, v] of Object.entries(parameters)) form.append(k, v);

    // XHR rather than fetch, for one reason: fetch cannot report how much of a
    // request body has gone out. A game film is gigabytes and can take an hour
    // on a home connection, and with no progress the coach has nothing to tell
    // uploading apart from stalled. XMLHttpRequest.upload.onprogress is still
    // the only browser API that answers that question.
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE_URL}${path}`);
      // Content-Type is deliberately unset: the browser must add the multipart
      // boundary itself, and setting it by hand produces a body the server can't parse.
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => {
        if (!onProgress || !e.lengthComputable) return;
        onProgress({ sent: e.loaded, total: e.total, fraction: e.total ? e.loaded / e.total : 0 });
      };
      xhr.onload = () => {
        const body = xhr.responseText || '';
        if (xhr.status >= 400) {
          let detail = `Upload failed (${xhr.status})`;
          try { detail = JSON.parse(body || '{}').detail || detail; } catch {}
          return reject(new Error(detail));
        }
        try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
      };
      xhr.onerror = () => reject(new Error('Upload failed — the connection dropped.'));
      xhr.ontimeout = () => reject(new Error('Upload timed out.'));
      xhr.send(form as any);
    });
  }

  // Native never has a Blob to hand — the pickers there give a file:// uri, and
  // uploadAsync streams from that path.
  const fileUri = typeof file === 'string' ? file : '';
  const options = {
    httpMethod: 'POST' as const,
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName,
    mimeType,
    parameters,
    headers,
  };

  // createUploadTask is uploadAsync with a progress callback. Same transport,
  // same streaming from disk; the only difference is that it says how far it
  // has got, which on an hour-long upload is the difference between waiting
  // and wondering.
  const res = onProgress
    ? await FileSystem.createUploadTask(`${BASE_URL}${path}`, fileUri, options, (p: any) => {
        const total = p?.totalBytesExpectedToSend ?? 0;
        const sent = p?.totalBytesSent ?? 0;
        onProgress({ sent, total, fraction: total ? sent / total : 0 });
      }).uploadAsync()
    : await FileSystem.uploadAsync(`${BASE_URL}${path}`, fileUri, options);

  if (!res) throw new Error('Upload failed.');
  if (res.status >= 400) {
    let detail = `Upload failed (${res.status})`;
    try { detail = JSON.parse(res.body || '{}').detail || detail; } catch {}
    throw new Error(detail);
  }
  try { return JSON.parse(res.body || '{}'); } catch { return {}; }
}

/** Build a video source for a stream url. Absolute urls (e.g. presigned S3) are
 * used as-is; relative backend paths get the bearer token attached. */
export async function authedVideoSource(streamPath: string): Promise<{ uri: string; headers?: Record<string, string> }> {
  if (/^https?:\/\//i.test(streamPath)) return { uri: streamPath };
  const token = await SecureStore.getItemAsync('auth_token');
  return { uri: `${BASE_URL}${streamPath}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined };
}

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// A rejected token can surface on any request, not just the one at startup.
// Announce it once, centrally, so the app returns to the login screen instead
// of every open screen showing its own unexplained failure. Login and register
// are exempt: a 401 there is "wrong password", which the form reports itself.
const AUTH_EXEMPT = /\/auth\/(login|register|google)/;
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    const url = err?.config?.url ?? '';
    // Only when the request actually CARRIED a token. A 401 on a request that
    // went out without one says the header was missing, not that the session
    // is over — the token is read from storage per request, and a read that
    // loses a race would otherwise sign the coach out mid-session for no
    // reason they could see.
    const sent = !!err?.config?.headers?.Authorization;
    if (status === 401 && sent && !AUTH_EXEMPT.test(url)) emitCoachUnauthorized();
    return Promise.reject(err);
  },
);

// ── The public discovery questionnaire ────────────────────────────────────────

export type QuestionnaireForm = {
  version: number;
  language: string;
  translation_failed?: boolean;
  age_ranges: string[];
  /** Every visible word on the form, in the same language as the questions. */
  ui: Record<string, string>;
  roles: { id: string; name: string; blurb: string }[];
  questions: Record<string, { text: string; multi: boolean; options: string[] }[]>;
};

export type QuestionnaireSummary = {
  version: number;
  total: number;
  /** Answers to an earlier wording of the questions, counted apart from these. */
  earlier_version_count?: number;
  roles: {
    id: string; name: string; count: number;
    questions: { text: string; multi: boolean; answered: number;
                 options: { text: string; count: number }[] }[];
  }[];
  comments: { id: number; name: string; role_name: string; comment: string; created_at: string }[];
};

export type QuestionnaireRow = {
  id: number; role: string; role_name: string; name: string;
  email: string | null; age_range: string | null; comment: string | null; source: string | null;
  created_at: string;
  answers: { question: string; answer: string | string[] | null }[];
};

export const questionnaireAPI = {
  /** The questions. No token — whoever opens the link has no account. */
  form: (lang?: string): Promise<QuestionnaireForm> =>
    api.get('/questionnaire/form', { params: lang && lang !== 'en' ? { lang } : undefined })
      .then(r => r.data),
  submit: (body: {
    role: string; name: string; email?: string | null; age_range?: string | null;
    answers: Record<string, number | number[]>;
    comment?: string | null; source?: string | null;
  }) => api.post('/questionnaire/responses', body).then(r => r.data),

  // The results carry names, so they carry the key off the link. Sent as a
  // header rather than a query string so it doesn't end up in a log line.
  summary: (key: string): Promise<QuestionnaireSummary> =>
    api.get('/questionnaire/summary', { headers: { 'X-Questionnaire-Key': key } }).then(r => r.data),
  responses: (key: string, role?: string): Promise<QuestionnaireRow[]> =>
    api.get('/questionnaire/responses', {
      headers: { 'X-Questionnaire-Key': key },
      params: role ? { role } : undefined,
    }).then(r => r.data),
  exportCsv: (key: string): Promise<{ csv: string; count: number }> =>
    api.get('/questionnaire/export', { headers: { 'X-Questionnaire-Key': key } }).then(r => r.data),
};

// ── What corrections have taught ──────────────────────────────────────────────
export const preferencesAPI = {
  /** Everything learned; with a team, what applies to reports about that team. */
  list: (teamId?: number): Promise<CoachPreference[]> =>
    api.get('/preferences', { params: teamId != null ? { team_id: teamId } : undefined })
       .then(r => r.data),
  /** Stop applying one without losing the record of having made it. */
  setActive: (id: number, active: boolean) =>
    api.patch(`/preferences/${id}`, { active }).then(r => r.data),
  remove: (id: number) => api.delete(`/preferences/${id}`).then(r => r.data),
};

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  register: (data: { name: string; email: string; password: string; weight?: number; program_name?: string; role?: string; competition_level?: string; conference?: string; country?: string; city?: string }) =>
    api.post('/auth/register', data).then(r => r.data),

  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then(r => r.data),

  google: (data: {
    id_token: string; mode: 'login' | 'register';
    // Editable on the signup form, so it has to be sendable. The type is what
    // enforces that: the field was missing here, so passing it was a compile
    // error and the app quietly created accounts under the Google profile name.
    name?: string;
    role?: string; program_name?: string; competition_level?: string;
    conference?: string; country?: string; city?: string;
    preferred_language?: string;
  }) => api.post('/auth/google', data).then(r => r.data),

  me: () => api.get('/auth/me').then(r => r.data),

  // Activity email on/off. Separate from the profile record because the same
  // setting is writable from the unsubscribe link in any message.
  getEmailPrefs: (): Promise<{ email_enabled: boolean }> =>
    api.get('/auth/email-prefs').then(r => r.data),
  setEmailPrefs: (email_enabled: boolean) =>
    api.patch('/auth/email-prefs', { email_enabled }).then(r => r.data),

  updateProfile: (data: {
    name?: string; email?: string; role?: string; job_title?: string;
    program_name?: string; competition_level?: string; conference?: string;
    system_profile?: Record<string, string>;
    country?: string; city?: string; onboarded?: boolean;
  }) => api.patch('/auth/me', data).then(r => r.data),

  importPhilosophy: (formData: FormData) =>
    api.post('/auth/philosophy/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    }).then(r => r.data),
};

// ── Players ───────────────────────────────────────────────────────────────────
export const playersAPI = {
  /** Take a player off MY roster that a shared report put there. */
  dropShared: (playerId: number) =>
    api.delete(`/players/${playerId}/access`).then(r => r.data),
  list: (teamId?: number) =>
    api.get('/players', { params: teamId != null ? { team_id: teamId } : {} }).then(r => r.data),

  get: (id: number) => api.get(`/players/${id}`).then(r => r.data),

  videos: (playerId: number) => api.get(`/players/${playerId}/videos`).then(r => r.data),
  deleteVideo: (videoId: number) => api.delete(`/players/videos/${videoId}`).then(r => r.data),

  create: (data: {
    name: string; position?: string; jersey_number?: string; age?: number;
    height?: string; wingspan?: string; weight?: string; standing_reach?: string;
    school_name?: string; city?: string; state?: string; country?: string;
    competition_level?: string; notes?: string; team_id?: number;
    parent_permission?: boolean | null;
  }) => api.post('/players', data).then(r => r.data),

  update: (id: number, data: {
    name?: string; position?: string; jersey_number?: string; competition_level?: string; team_id?: number;
    height?: string; wingspan?: string; weight?: string; standing_reach?: string;
    country?: string; state?: string; city?: string; school_name?: string;
  }) => api.patch(`/players/${id}`, data).then(r => r.data),

  delete: (id: number) => api.delete(`/players/${id}`).then(r => r.data),

  evaluations: (id: number) => api.get(`/players/${id}/evaluations`).then(r => r.data),

  summary: (id: number, data: { output_type: string; focus_prompt?: string; game_ids?: number[]; sources?: string[] }) =>
    api.post(`/players/${id}/summary`, data).then(r => r.data),
};

// ── Evaluations ───────────────────────────────────────────────────────────────
// Large/long film uploads: allow up to 30 min for the upload itself (the
// server returns a job id as soon as the file lands, then processes in the
// background — the app polls evalsAPI.job for the result).
const UPLOAD_TIMEOUT = 1800000;

export const evalsAPI = {
  submit: (formData: FormData) =>
    api.post('/evaluations', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_TIMEOUT,
    }).then(r => r.data),

  // Poll a background generation job (video evals / team reports).
  job: (jobId: number) =>
    api.get(`/evaluations/jobs/${jobId}`).then(r => r.data),

  // Extract plain text from an uploaded doc (import into Notes/Focus fields).
  extractDoc: (file: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    form.append('file', file as any);
    return api.post('/evaluations/extract-doc', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data);
  },

  delete: (id: number) => api.delete(`/evaluations/${id}`).then(r => r.data),

  get: (id: number) => api.get(`/evaluations/${id}`).then(r => r.data),

  recent: (limit = 30) =>
    api.get('/evaluations/recent', { params: { limit } }).then(r => r.data),

  teamReport: (data: { output_type: string; focus_prompt?: string; team_id?: number; opponent_team_id?: number; video?: { uri: string; name: string; type: string } }) => {
    const form = new FormData();
    form.append('output_type', data.output_type);
    if (data.focus_prompt) form.append('focus_prompt', data.focus_prompt);
    if (data.team_id != null) form.append('team_id', String(data.team_id));
    if (data.opponent_team_id != null) form.append('opponent_team_id', String(data.opponent_team_id));
    if (data.video) form.append('video', { uri: data.video.uri, name: data.video.name, type: data.video.type } as any);
    return api.post('/evaluations/team-report', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: UPLOAD_TIMEOUT }).then(r => r.data);
  },

  teamReports: (limit = 30) =>
    api.get('/evaluations/team-reports/recent', { params: { limit } }).then(r => r.data),
  // Poll a job until it finishes, returning the result object. Throws on error.
  /**
   * Follow a background job to completion.
   *
   * There is no wall-clock limit, because there is no honest one to pick: a
   * three-hour film takes as long as it takes, and a thirty-minute cap told the
   * coach "Generation timed out" while the server was still working — the job
   * then finished and appeared later, contradicting the error they had just
   * been shown.
   *
   * What is worth giving up on is a job that has stopped moving. Progress that
   * hasn't changed in STALL_MINUTES means nothing is happening; anything else
   * is just work. Even then the job is not cancelled — it is still running, and
   * the caller is told exactly that.
   */
  awaitJob: async (jobId: number, onTick?: (status: string) => void) => {
    // Whoever is watching this one, so the app-wide banner can stay quiet while
    // the coach is still on the screen that started it. Every long job in the
    // app funnels through here.
    noteJobStarted(jobId);
    const EVERY_MS = 4000;
    const STALL_MINUTES = 25;
    const stallLimit = (STALL_MINUTES * 60_000) / EVERY_MS;
    let last = '';
    let same = 0;
    for (;;) {
      const j = await api.get(`/evaluations/jobs/${jobId}`).then(r => r.data);
      if (j.status === 'done') return j.result;
      if (j.status === 'error') throw new Error(j.error || 'Generation failed');
      const p = j.progress || j.status || '';
      if (p !== last) { last = p; same = 0; } else { same++; }
      if (same >= stallLimit) {
        throw new Error(
          'This is taking longer than expected. It’s still running on the server — ' +
          'you can leave this screen and it will appear when it’s done.',
        );
      }
      onTick?.(p);
      await new Promise(res => setTimeout(res, EVERY_MS));
    }
  },
  /** Every job of mine still running or just finished — see JobWatcher. */
  activeJobs: (): Promise<ActiveJob[]> =>
    api.get('/evaluations/jobs/active').then(r => r.data),
  deleteTeamReport: (id: number) =>
    api.delete(`/evaluations/team-reports/${id}`).then(r => r.data),

  addCorrection: (evalId: number, data: { pillar?: string; original_text?: string; correction: string }) =>
    api.post(`/evaluations/${evalId}/corrections`, data).then(r => r.data),

  corrections: (evalId: number) =>
    api.get(`/evaluations/${evalId}/corrections`).then(r => r.data),

  applyCorrections: (evalId: number) =>
    api.post(`/evaluations/${evalId}/apply-corrections`).then(r => r.data),

  regenerate: (evalId: number) =>
    api.post(`/evaluations/${evalId}/regenerate`).then(r => r.data),

  correctTeamReport: (reportId: number, correction: string) =>
    api.post(`/evaluations/team-reports/${reportId}/correct`, { correction }).then(r => r.data),

  addTeamReportCorrection: (reportId: number, correction: string) =>
    api.post(`/evaluations/team-reports/${reportId}/corrections`, { correction }).then(r => r.data),

  teamReportCorrections: (reportId: number) =>
    api.get(`/evaluations/team-reports/${reportId}/corrections`).then(r => r.data),

  regenerateTeamReport: (reportId: number) =>
    api.post(`/evaluations/team-reports/${reportId}/regenerate`).then(r => r.data),
};

// ── Unified AI imports (any file → preview → commit) ──────────────────────────
type PickedFile = { uri: string; name: string; type: string };
/**
 * The multipart body for an import, built the way each platform needs.
 *
 * `{uri, name, type}` is React Native's file descriptor and means nothing to a
 * browser: the DOM's FormData stringifies it, so the server received the text
 * "[object Object]" where a file should have been and answered 422. On web the
 * uri is a blob:/data: URL, and fetching it gives back the Blob the browser
 * wanted in the first place.
 */
const _importForm = async (file: PickedFile, extra: Record<string, string> = {}) => {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(file.uri)).blob();
    // Three-argument append is the DOM signature; RN's typing declares two.
    (form.append as any)('file', blob, file.name || 'upload');
  } else {
    form.append('file', file as any);
  }
  Object.entries(extra).forEach(([k, v]) => form.append(k, v));
  return form;
};
/** The same body, for any number of files, under the field name `files`. */
const _importFormMulti = async (files: PickedFile[]) => {
  const form = new FormData();
  for (const f of files) {
    if (Platform.OS === 'web') {
      const blob = await (await fetch(f.uri)).blob();
      (form.append as any)('files', blob, f.name || 'upload');
    } else {
      form.append('files', f as any);
    }
  }
  return form;
};

export const importsAPI = {
  rosterPreview: async (file: PickedFile) =>
    api.post('/imports/roster/preview', await _importForm(file), { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }).then(r => r.data),
  rosterCommit: (data: { team_id?: number | null; competition_level?: string; players: any[] }) =>
    api.post('/imports/roster/commit', data).then(r => r.data),
  /**
   * A game read from any number of files, of any type.
   *
   * One request per file rather than one for all of them, for a reason that is
   * only about the coach: reading a stat sheet takes the better part of a
   * minute, and a single request can only spin. File by file, the screen can
   * say "2 of 3" and move a bar that means something. Results are merged here;
   * the server merges again when they are committed, so nothing depends on this
   * getting it right.
   */
  gameStatsPreview: async (files: PickedFile[], gameId?: number, onProgress?: (done: number, total: number) => void) => {
    const players: any[] = [], events: any[] = [], shots: any[] = [], team_stats: any[] = [];
    const errors: string[] = [];
    // Team headings the files used that are neither team in this game, merged
    // across files: two photos of the same unnamed chart raise one question.
    const unresolved = new Map<string, { label: string; sections: Record<string, number> }>();
    for (let i = 0; i < files.length; i++) {
      onProgress?.(i, files.length);
      try {
        const form = await _importFormMulti([files[i]]);
        // The game the file belongs to, so the server can place each team by
        // name instead of guessing which one is the opponent.
        if (gameId != null) form.append('game_id', String(gameId));
        const r = await api.post('/imports/game-stats/preview', form,
          { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 }).then(x => x.data);
        players.push(...(r.players ?? []));
        events.push(...(r.events ?? []));
        shots.push(...(r.shots ?? []));
        team_stats.push(...(r.team_stats ?? []));
        for (const u of (r.unresolved ?? []) as any[]) {
          const at = unresolved.get(u.label) ?? { label: u.label, sections: {} as Record<string, number> };
          for (const [k, n] of Object.entries(u.sections ?? {})) {
            at.sections[k] = (at.sections[k] ?? 0) + (n as number);
          }
          unresolved.set(u.label, at);
        }
        if (r.errors?.length) errors.push(...r.errors);
      } catch (e: any) {
        // One unreadable file must not lose the ones that read fine.
        errors.push(`${files[i].name}: ${e?.response?.data?.detail ?? e?.message ?? 'could not be read'}`);
      }
    }
    onProgress?.(files.length, files.length);
    if (!players.length && !events.length && !shots.length && !team_stats.length) {
      throw new Error(errors.join('; ') || 'Nothing could be read from those files.');
    }
    // Same rule the server uses: the larger count per stat, not the sum. Two
    // photos of one sheet are the same numbers twice.
    const merged = new Map<string, any>();
    for (const p of players) {
      const key = `${String(p.player_name).toLowerCase()}|${String(p.team_name ?? '').toLowerCase()}`;
      const at = merged.get(key);
      if (!at) { merged.set(key, p); continue; }
      for (const [k, v] of Object.entries(p.stats ?? {})) {
        at.stats[k] = Math.max(at.stats[k] ?? 0, v as number);
      }
    }
    return { players: [...merged.values()], events, shots, team_stats,
             unresolved: [...unresolved.values()], errors };
  },
  /** Read ONE section again, with the coach saying what the reader got wrong. */
  regenerateSection: async (files: PickedFile[], body: { game_id: number; section: string; note: string }) => {
    const form = await _importFormMulti(files);
    form.append('game_id', String(body.game_id));
    form.append('section', body.section);
    form.append('note', body.note);
    return api.post('/imports/game-stats/resection', form,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 }).then(r => r.data);
  },
  gameStatsCommit: (data: { game_id: number; players?: any[]; events?: any[]; shots?: any[];
                            team_stats?: any[]; label_sides?: Record<string, boolean>;
                            team_mine?: Record<string, boolean> }) =>
    api.post('/imports/game-stats/commit', data).then(r => r.data),
  text: async (file: PickedFile, purpose = 'coaching notes') =>
    api.post('/imports/text', await _importForm(file, { purpose }), { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }).then(r => r.data),
};

// ── AI Copilot (command bar) ──────────────────────────────────────────────────
export const translationsAPI = {
  /** Translate a stored report on view. The server caches per (report, language). */
  report: (report_type: string, report_id: number, target_lang: string) =>
    api.post('/translations/report', { report_type, report_id, target_lang })
       .then(r => r.data as { text: string; cached: boolean; language: string }),
};

export const assistantAPI = {
  ask: (message: string, history: { role: string; content: string }[] = []) =>
    api.post('/assistant/ask', { message, history }, { timeout: 120000 }).then(r => r.data),
  confirm: (action: any) =>
    api.post('/assistant/confirm', { action }, { timeout: 120000 }).then(r => r.data),
};

// ── Teams ─────────────────────────────────────────────────────────────────────
export const searchAPI = {
  /**
   * Global search across everything the coach can see — players, teams, evals,
   * training programs, team reports, packets and scouting reports, matched on
   * names and on the text of the reports themselves.
   *
   * `limit` is per group: the sidebar wants a handful, the full-results screen
   * wants the lot.
   */
  all: (q: string, limit?: number) =>
    api.get('/search', { params: limit ? { q, limit } : { q } }).then(r => r.data),

  /**
   * Every name the coach can search, without report bodies — small enough to
   * hold in memory and match against locally, so typing doesn't wait on a
   * round trip. See navigation/searchIndex.ts.
   */
  index: () => api.get('/search/index').then(r => r.data),
};

export const teamsAPI = {
  list: () => api.get('/teams').then(r => r.data),
  create: (data: { name: string; competition_level?: string; is_mine?: boolean }) =>
    api.post('/teams', data).then(r => r.data),
  update: (id: number, data: { name?: string; competition_level?: string; is_mine?: boolean }) =>
    api.patch(`/teams/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/teams/${id}`).then(r => r.data),
};

// ── Uploads ───────────────────────────────────────────────────────────────────
export const uploadsAPI = {
  excel: (formData: FormData, teamId?: number) => {
    if (teamId != null) {
      formData.append('team_id', String(teamId));
    }
    return api.post('/uploads/excel', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data);
  },
};

// ── Training ──────────────────────────────────────────────────────────────────
export const trainingAPI = {
  generate: async (data: {
    player_id: number; evaluation_id?: number; focus_prompt?: string;
    reference?: { uri: string; name: string; type: string };
  }, onTick?: (s: string) => void) => {
    const form = new FormData();
    form.append('player_id', String(data.player_id));
    if (data.evaluation_id != null) form.append('evaluation_id', String(data.evaluation_id));
    if (data.focus_prompt) form.append('focus_prompt', data.focus_prompt);
    if (data.reference) form.append('reference', { uri: data.reference.uri, name: data.reference.name, type: data.reference.type } as any);
    // Followed as a job: a program is written at length, and the request used to
    // outlive the client's timeout while the server carried on writing it.
    const res = await api.post('/training', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    return res?.job_id ? evalsAPI.awaitJob(res.job_id, onTick) : res;
  },

  forPlayer: (playerId: number) =>
    api.get(`/training/player/${playerId}`).then(r => r.data),

  regenerate: (playerId: number, feedback: string) =>
    api.post(`/training/players/${playerId}/regenerate`, { feedback }).then(r => r.data),

  /** `hideSections` are headings the coach switched off; the player never sees them. */
  sendToPlayer: (trainingId: number, hideSections: string[] = []) =>
    api.post(`/training/${trainingId}/send-to-player`, { hide_sections: hideSections }).then(r => r.data),

  recent: (limit = 30) =>
    api.get('/training/recent', { params: { limit } }).then(r => r.data),

  comments: (trainingId: number) =>
    api.get(`/training/${trainingId}/comments`).then(r => r.data),
  addComment: (trainingId: number, text: string) =>
    api.post(`/training/${trainingId}/comments`, { text }).then(r => r.data),
  refreshPlayerProgram: (trainingId: number, feedback: string) =>
    api.post(`/training/${trainingId}/refresh-player-program`, { feedback }).then(r => r.data),
  corrections: (trainingId: number) =>
    api.get(`/training/${trainingId}/corrections`).then(r => r.data),
  addCorrection: (trainingId: number, text: string) =>
    api.post(`/training/${trainingId}/corrections`, { text }).then(r => r.data),
  applyCorrections: (trainingId: number) =>
    api.post(`/training/${trainingId}/apply-corrections`).then(r => r.data),
};

// ── Player (coach-side) ────────────────────────────────────────────────────────
export interface ShareReportRequest {
  player_user_id: number;
  /** Section headings the coach switched off; the server filters them out. */
  hide_sections?: string[];
  share_report_text?: boolean;
  share_grades?: boolean;
  share_flags?: boolean;
  share_questions?: boolean;
  message?: string | null;
  consent_override?: boolean;
}

export const playerAPI = {
  searchPlayerUsers: (q: string) =>
    api.get('/player/search-player-users', { params: { q } }).then(r => r.data),
  share: (evalId: number, data: ShareReportRequest) =>
    api.post(`/player/share/${evalId}`, data).then(r => r.data),
  sentReports: () =>
    api.get('/player/shared-reports/sent').then(r => r.data),
  generateInvite: (playerId: number) =>
    api.post(`/player/invite/${playerId}`).then(r => r.data),
  coachNotifications: () =>
    api.get('/player/coach-notifications').then(r => r.data),
  coachMarkRead: (id: number) =>
    api.post(`/player/coach-notifications/${id}/read`).then(r => r.data),
  linkRequests: () =>
    api.get('/player/link-requests').then(r => r.data),
  approveLink: (id: number) =>
    api.post(`/player/link-request/${id}/approve`).then(r => r.data),
  rejectLink: (id: number) =>
    api.post(`/player/link-request/${id}/reject`).then(r => r.data),
  coachTrainingView: () =>
    api.get('/player/training/coach-view').then(r => r.data),
  updateTraining: (id: number, data: { coach_notes: string }) =>
    api.patch(`/player/training/${id}`, data).then(r => r.data),
  addCoachComment: (trainingId: number, data: { text: string; parent_id?: number }) =>
    api.post(`/player/training/${trainingId}/coach-comment`, data).then(r => r.data),
  coachMarkAllRead: () =>
    api.post('/player/coach-notifications/read-all').then(r => r.data),
  coachViewSharedReport: (sharedId: number) =>
    api.get(`/player/shared-reports/${sharedId}/coach-view`).then(r => r.data),
  coachReplyToReport: (sharedId: number, text: string, parentId?: number) =>
    api.post(`/player/shared-reports/${sharedId}/coach-reply`, { text, parent_id: parentId }).then(r => r.data),
  shareTeamReport: (data: { output_type: string; report_text: string; target_type: string; player_user_id?: number; team_id?: number; message?: string; subject_player_id?: number; require_consent?: boolean; consent_override?: boolean }) =>
    api.post('/player/share-team-report', data).then(r => r.data),
  searchStaff: (q: string) =>
    api.get('/player/staff/search', { params: { q } }).then(r => r.data),
  getTrainingDetail: (trainingId: number) =>
    api.get(`/player/training/${trainingId}/detail`).then(r => r.data),
  coachRefreshTraining: (trainingId: number, feedback: string) =>
    api.post(`/player/training/${trainingId}/coach-refresh`, { feedback }).then(r => r.data),
};

// ── Staff sharing ──────────────────────────────────────────────────────────────
export const staffSharingAPI = {
  share: (data: { report_type: string; report_id: number; recipient_id: number; allow_regenerate?: boolean; frozen_text?: string }) =>
    api.post('/staff-sharing/share', data).then(r => r.data),
  searchTargets: (q: string) =>
    api.get('/staff-sharing/search-targets', { params: { q } }).then(r => r.data),
  shareGroup: (data: { report_type: string; report_id: number; kind: string; coach_id?: number; team_id?: number; program_name?: string; allow_regenerate?: boolean; frozen_text?: string }) =>
    api.post('/staff-sharing/share-group', data).then(r => r.data),
  shareTeam: (data: { report_type: string; report_id: number; team_id: number; allow_regenerate?: boolean; frozen_text?: string }) =>
    api.post('/staff-sharing/share-team', data).then(r => r.data),
  inbox: () => api.get('/staff-sharing/inbox').then(r => r.data),
  sent: () => api.get('/staff-sharing/sent').then(r => r.data),
  getComments: (sharedId: number) => api.get(`/staff-sharing/${sharedId}/comments`).then(r => r.data),
  addComment: (sharedId: number, text: string, target: 'original' | 'updated' = 'original') =>
    api.post(`/staff-sharing/${sharedId}/comments`, { text, target }).then(r => r.data),
  regenerate: (sharedId: number, feedback: string) =>
    api.post(`/staff-sharing/${sharedId}/regenerate`, { feedback }).then(r => r.data),
  adopt: (sharedId: number, text: string) =>
    api.post(`/staff-sharing/${sharedId}/adopt`, { text }).then(r => r.data),
  listCorrections: (sharedId: number) =>
    api.get(`/staff-sharing/${sharedId}/corrections`).then(r => r.data),
  addCorrection: (sharedId: number, correction: string) =>
    api.post(`/staff-sharing/${sharedId}/corrections`, { correction }).then(r => r.data),
  editCorrection: (correctionId: number, correction: string) =>
    api.patch(`/staff-sharing/corrections/${correctionId}`, { correction }).then(r => r.data),
  deleteCorrection: (correctionId: number) =>
    api.delete(`/staff-sharing/corrections/${correctionId}`).then(r => r.data),
  regenerateMine: (sharedId: number, feedback?: string) =>
    api.post(`/staff-sharing/${sharedId}/regenerate-mine`, { feedback }).then(r => r.data),
  requestUpdated: (sharedId: number) =>
    api.post(`/staff-sharing/${sharedId}/request-updated`, {}).then(r => r.data),
  respondRequest: (sharedId: number, approve: boolean) =>
    api.post(`/staff-sharing/${sharedId}/respond-request`, { approve }).then(r => r.data),
};

// ── Coaches search ─────────────────────────────────────────────────────────────
export const staffMessagesAPI = {
  list: () => api.get('/staff-messages').then(r => r.data),
  create: (data: { member_ids: number[]; title?: string; is_group?: boolean }) =>
    api.post('/staff-messages', data).then(r => r.data),
  get: (cid: number) => api.get(`/staff-messages/${cid}`).then(r => r.data),
  send: (cid: number, data: { text?: string; attachments?: any[] }) =>
    api.post(`/staff-messages/${cid}/messages`, data).then(r => r.data),
  read: (cid: number) => api.post(`/staff-messages/${cid}/read`).then(r => r.data),
};

export const coachesAPI = {
  search: (q: string) => api.get('/auth/coaches/search', { params: { q } }).then(r => r.data),
  list: () => api.get('/auth/coaches').then(r => r.data),
};

export const feedbackAPI = {
  // `screen` is what makes a report actionable — "this is confusing" is worth
  // far more when the server knows where they were standing when they wrote it.
  // `images` are base64 data URIs, capped and compressed on the client. They
  // ride with the report and are attached to the notification email, so a
  // screenshot of the problem arrives in the inbox rather than behind a login.
  submit: (data: { text: string; screen?: string; app_version?: string; platform?: string; images?: string[] }) =>
    api.post('/feedback', data).then(r => r.data),
  mine: () => api.get('/feedback').then(r => r.data),
};

// ── Game Evaluation ────────────────────────────────────────────────────────────
export const gameEvalAPI = {
  createSession: (data: any) => api.post('/game-eval/sessions', data).then(r => r.data),
  listSessions: (params?: any) => api.get('/game-eval/sessions', { params }).then(r => r.data),
  getSession: (id: number) => api.get(`/game-eval/sessions/${id}`).then(r => r.data),
  updateSession: (id: number, data: any) => api.patch(`/game-eval/sessions/${id}`, data).then(r => r.data),
  deleteSession: (id: number) => api.delete(`/game-eval/sessions/${id}`).then(r => r.data),
  /** Correct one player's line after an import misread it. */
  editPlayerLine: (gameId: number, body: { player_name: string; is_opponent: boolean; line: Record<string, number> }) =>
    api.put(`/game-eval/sessions/${gameId}/box-score/player`, body).then(r => r.data),
  /** The game's numbers plus what can honestly be charted from them. */
  boxScore: (gameId: number) => api.get(`/game-eval/sessions/${gameId}/box-score`).then(r => r.data),
  /** The whole Game Insights page as markdown tables, for export and print. */
  insightsText: (gameId: number): Promise<{ text: string }> =>
    api.get(`/game-eval/sessions/${gameId}/insights-text`).then(r => r.data),
  listStats: (gameId: number) => api.get(`/game-eval/sessions/${gameId}/stats`).then(r => r.data),
  logStat: (gameId: number, data: any) => api.post(`/game-eval/sessions/${gameId}/stats`, data).then(r => r.data),
  /** Direct import, no preview. Field name `files`: the endpoint takes any
   *  number of files of any type. */
  importStats: (gameId: number, files: { uri: string; name: string; type: string }[], isOpponent = false) => {
    const form = new FormData();
    for (const f of files) form.append('files', f as any);
    return api.post(`/game-eval/sessions/${gameId}/import`, form, {
      params: { is_opponent: isOpponent },
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data);
  },
  deleteStat: (statId: number) => api.delete(`/game-eval/stats/${statId}`).then(r => r.data),
  logLineup: (gameId: number, data: any) => api.post(`/game-eval/sessions/${gameId}/lineup`, data).then(r => r.data),
  getLineup: (gameId: number) => api.get(`/game-eval/sessions/${gameId}/lineup`).then(r => r.data),
  getGameSummary: (gameId: number) => api.get(`/game-eval/sessions/${gameId}/summary`).then(r => r.data),
  uploadFile: (gameId: number, formData: FormData) => api.post(`/game-eval/sessions/${gameId}/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data),
  /** Scouting report, followed as a job — see gameReportsAPI.generate. */
  getScoutingReport: async (gameId: number, onTick?: (s: string) => void) => {
    const { job_id } = await api.post(`/game-eval/sessions/${gameId}/ai-scouting-job`).then(r => r.data);
    return evalsAPI.awaitJob(job_id, onTick);
  },
  /** Full game report, followed as a job. */
  generateGameReport: async (gameId: number, onTick?: (s: string) => void) => {
    const { job_id } = await api.post(`/game-eval/sessions/${gameId}/game-report-job`).then(r => r.data);
    return evalsAPI.awaitJob(job_id, onTick);
  },
  gameReportCorrections: (gameId: number) => api.get(`/game-eval/sessions/${gameId}/game-report-corrections`).then(r => r.data),
  addGameReportCorrection: (gameId: number, text: string) => api.post(`/game-eval/sessions/${gameId}/game-report-corrections`, { text }).then(r => r.data),
  deleteGameReportCorrection: (id: number) => api.delete(`/game-eval/game-report-corrections/${id}`).then(r => r.data),
  /**
   * Generate the game report, or apply what the coach just typed to the one
   * they already have. The text goes through explicitly so it is applied
   * whether it is being remembered for the opponent or kept to this report.
   */
  applyGameReportCorrections: async (
    gameId: number,
    body: { text?: string; remember?: boolean; remember_team?: string } = {},
    onTick?: (s: string) => void,
  ) => {
    const { job_id } = await api.post(`/game-eval/sessions/${gameId}/game-report-job`, body).then(r => r.data);
    return evalsAPI.awaitJob(job_id, onTick);
  },
  /** One written sentence about a team or one of its players. */
  scoutInsight: (team: string, subject: string, refresh = false) =>
    api.post(`/game-eval/opponents/${encodeURIComponent(team)}/insight`,
             { subject, refresh }, { timeout: 120000 })
       .then(r => r.data as ScoutInsightOut),
  /** Everything already written about a team, so nothing is paid for twice. */
  scoutInsights: (team: string) =>
    api.get(`/game-eval/opponents/${encodeURIComponent(team)}/insights`)
       .then(r => r.data as Record<string, ScoutInsightOut>),
  scoutingCorrections: (gameId: number) => api.get(`/game-eval/sessions/${gameId}/scouting-corrections`).then(r => r.data),
  addScoutingCorrection: (gameId: number, text: string) => api.post(`/game-eval/sessions/${gameId}/scouting-corrections`, { text }).then(r => r.data),
  editScoutingCorrection: (id: number, text: string) => api.patch(`/game-eval/scouting-corrections/${id}`, { text }).then(r => r.data),
  deleteScoutingCorrection: (id: number) => api.delete(`/game-eval/scouting-corrections/${id}`).then(r => r.data),
  /** Generate the scouting report, or apply what the coach just typed to it. */
  applyScoutingCorrections: async (
    gameId: number,
    body: { text?: string; remember?: boolean } = {},
    onTick?: (s: string) => void,
  ) => {
    const { job_id } = await api.post(`/game-eval/sessions/${gameId}/ai-scouting-job`, body).then(r => r.data);
    return evalsAPI.awaitJob(job_id, onTick);
  },

  /** Previous wordings of a report, and putting one back. */
  reportVersions: (gameId: number, kind: 'scouting' | 'game_report') =>
    api.get(`/game-eval/sessions/${gameId}/report-versions`, { params: { kind } }).then(r => r.data),
  restoreReportVersion: (gameId: number, versionId: number) =>
    api.post(`/game-eval/sessions/${gameId}/report-versions/${versionId}/restore`).then(r => r.data),
  getSeasonDashboard: (params?: any) => api.get('/game-eval/season-dashboard', { params }).then(r => r.data),
  getOpponentProfile: (name: string) => api.get(`/game-eval/opponents/${encodeURIComponent(name)}`).then(r => r.data),
  compareGames: (game1Id: number, game2Id: number) => api.get('/game-eval/compare', { params: { game1_id: game1Id, game2_id: game2Id } }).then(r => r.data),
  logMinutes: (gameId: number, data: any) => api.post(`/game-eval/sessions/${gameId}/minutes`, data).then(r => r.data),
  getOpponentNotes: (name: string) => api.get(`/game-eval/opponents/${encodeURIComponent(name)}/notes`).then(r => r.data),
  addOpponentNote: (name: string, noteText: string) => api.post(`/game-eval/opponents/${encodeURIComponent(name)}/notes`, { note_text: noteText }).then(r => r.data),
  deleteOpponentNote: (noteId: number) => api.delete(`/game-eval/opponent-notes/${noteId}`).then(r => r.data),
  listOpponentPlayers: (name: string) => api.get(`/game-eval/opponents/${encodeURIComponent(name)}/players`).then(r => r.data),
  addOpponentPlayer: (name: string, data: { player_name: string; jersey_number?: string; position?: string }) =>
    api.post(`/game-eval/opponents/${encodeURIComponent(name)}/players`, data).then(r => r.data),
  deleteOpponentPlayer: (playerId: number) => api.delete(`/game-eval/opponent-players/${playerId}`).then(r => r.data),
  playerGameHistory: (playerName: string) =>
    api.get('/game-eval/player-game-history', { params: { player_name: playerName } }).then(r => r.data),
};

export const whiteboardAPI = {
  list: (gameId: number) => api.get(`/game-eval/sessions/${gameId}/whiteboards`).then(r => r.data),
  create: (gameId: number, data: { name: string; court_type: string; data: string }) =>
    api.post(`/game-eval/sessions/${gameId}/whiteboards`, data).then(r => r.data),
  // Coach-level playbook (persists independent of games).
  playbookList: () => api.get('/game-eval/playbook/whiteboards').then(r => r.data),
  playbookCreate: (data: { name: string; court_type: string; data: string }) =>
    api.post('/game-eval/playbook/whiteboards', data).then(r => r.data),
  update: (boardId: number, data: { name?: string; court_type?: string; data?: string }) =>
    api.patch(`/game-eval/whiteboards/${boardId}`, data).then(r => r.data),
  delete: (boardId: number) => api.delete(`/game-eval/whiteboards/${boardId}`).then(r => r.data),
  aiPlay: (description: string) =>
    api.post('/game-eval/ai-play', { description }).then(r => r.data),
  describeMove: (body: { schemes: any; scheme: string; player_id: string; source?: string }) =>
    api.post('/game-eval/ai-play-describe', body).then(r => r.data),
  adaptPlay: (body: { edited: string; downstream: string[]; schemes: any; key: any[]; locked: any; source?: string }) =>
    api.post('/game-eval/ai-play-adapt', body).then(r => r.data),
  nameFreehand: (body: { markers: any[]; arrows: any[]; labels: any[] }) =>
    api.post('/game-eval/ai-play-name', body).then(r => r.data),
};

export const gameReportsAPI = {
  /** Tracked games this packet's film might be of, and whether to ask. */
  gameSuggestions: (reportId: number, q?: string): Promise<{
    ask: boolean; game_date: string | null; linked_game_id: number | null;
    games: { id: number; label: string; date: string | null; exact_date: boolean }[];
  }> => api.get(`/game-reports/${reportId}/game-suggestions`,
                { params: q ? { q } : undefined }).then(r => r.data),
  /** Confirm which game the film is of, or that none of them is. */
  linkGame: (reportId: number, data: { game_id?: number | null; declined?: boolean }) =>
    api.post(`/game-reports/${reportId}/link-game`, data).then(r => r.data),

  list: () => api.get('/game-reports').then(r => r.data),
  get: (id: number) => api.get(`/game-reports/${id}`).then(r => r.data),
  create: (data: any) => api.post('/game-reports', data).then(r => r.data),
  update: (id: number, data: any) => api.patch(`/game-reports/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/game-reports/${id}`).then(r => r.data),
  addClip: (id: number, formData: FormData) =>
    api.post(`/game-reports/${id}/clips`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data),
  /** Film already in storage (uploaded straight there) — just register it. */
  addClipRef: (id: number, data: { label: string; team_name?: string; video_ref: string }) => {
    const form = new FormData();
    form.append('label', data.label);
    form.append('team_name', data.team_name ?? '');
    form.append('video_ref', data.video_ref);
    return api.post(`/game-reports/${id}/clips`, form).then(r => r.data);
  },
  // Default keeps the breakdown and only frees the film — deleting a video
  // out of the film catalog must not take the report with it. Pass discard to
  // remove the clip outright, which is what deleting it inside a packet means.
  deleteClip: (id: number, clipId: number, discard = false) =>
    api.delete(`/game-reports/${id}/clips/${clipId}${discard ? '?discard=true' : ''}`).then(r => r.data),
  videos: () => api.get('/game-reports/videos').then(r => r.data),
  versions: (id: number) => api.get(`/game-reports/${id}/versions`).then(r => r.data),
  allVersions: () => api.get('/game-reports/versions').then(r => r.data),
  /** Every film breakdown across the coach's packets, for Recent. */
  allFilmAnalyses: () => api.get('/game-reports/film-analyses').then(r => r.data),
  /** Pull a recorded game's box score into the packet, appended to what's there. */
  importGame: (id: number, gameId: number) =>
    api.post(`/game-reports/${id}/import-game`, { game_id: gameId }).then(r => r.data),
  uploadDoc: (id: number, formData: FormData) =>
    api.post(`/game-reports/${id}/upload-doc`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data),
  /**
   * Write the packet's report, following it as a job.
   *
   * It used to be one POST that the browser waited on. A packet report is the
   * longest call in the app — two report lenses over two films' worth of
   * analysis — and it routinely ran past this client's two-minute timeout. The
   * browser then gave up on a request the server was still working on: the
   * coach saw "Could not generate report" while the report finished and saved a
   * minute later. Nothing had failed except the waiting.
   */
  generate: async (id: number, onTick?: (status: string) => void) => {
    const { job_id } = await api.post(`/game-reports/${id}/generate-job`).then(r => r.data);
    return evalsAPI.awaitJob(job_id, onTick);
  },
  teamTraining: (id: number, focusPrompt?: string) =>
    api.post(`/game-reports/${id}/team-training`, { focus_prompt: focusPrompt ?? null }).then(r => r.data),
  correct: (id: number, correction: string) =>
    api.post(`/game-reports/${id}/correct`, { correction }).then(r => r.data),
  correctClip: (id: number, clipId: number, correction: string) =>
    api.post(`/game-reports/${id}/clips/${clipId}/correct`, { correction }).then(r => r.data),
  corrections: (id: number) =>
    api.get(`/game-reports/${id}/corrections`).then(r => r.data),
  addCorrection: (id: number, correction: string) =>
    api.post(`/game-reports/${id}/corrections`, { correction }).then(r => r.data),
  regenerate: (id: number) =>
    api.post(`/game-reports/${id}/regenerate`).then(r => r.data),
};


export const transcribeAPI = {
  transcribe: async (uri: string, context?: string, language?: string) => {
    const formData = new FormData();
    if (Platform.OS === 'web') {
      // The {uri, name, type} object is React Native's file API. A browser has
      // no idea what to do with it: FormData stringifies it and sends the text
      // "[object Object]" as an ordinary field, so the server sees no file at
      // all and rejects the request. Dictation has never worked in a browser
      // for this reason — and the 422 it produces carries a list of objects as
      // its detail, which is what surfaced as "[object Object]" in the alert.
      //
      // Same treatment uploadFileStreamed already gives video on web: fetch the
      // recording back as a Blob and append it as a real file.
      const blob = await (await fetch(uri)).blob();
      const ext = (blob.type.split('/')[1] || 'webm').split(';')[0];
      (formData.append as any)('audio', blob, `audio.${ext}`);
    } else {
      formData.append('audio', { uri, name: 'audio.m4a', type: 'audio/m4a' } as any);
    }
    if (context) formData.append('context', context);
    // A dictation chunk is a couple of seconds long, which is thin evidence for
    // auto-detection. The app already knows what language the coach uses, so
    // tell the server rather than making it guess from the audio.
    if (language) formData.append('language', language);
    return api.post('/transcribe', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 45000,
    }).then(r => r.data.text as string);
  },
};

/**
 * Team signup links — the QR a coach holds up, or texts.
 *
 * `join*` calls are the newcomer's side: `peek` needs no account at all, the
 * rest need whichever session they just created.
 */
export const teamInviteAPI = {
  mine: (teamId: number) =>
    api.get(`/team-invites/${teamId}`).then(r => r.data),
  create: (teamId: number) =>
    api.post(`/team-invites/${teamId}`).then(r => r.data),
  revoke: (linkId: number) =>
    api.post(`/team-invites/link/${linkId}/revoke`).then(r => r.data),

  // `peek` needs no session at all; joinAsStaff is a coach.
  peek: (code: string) =>
    api.get(`/join/${encodeURIComponent(code)}`).then(r => r.data),
  joinAsStaff: (code: string) =>
    api.post(`/join/${encodeURIComponent(code)}/staff`).then(r => r.data),
  // These two are the PLAYER's, and a player's token lives on its own client
  // under its own key — sent through the coach client they arrive with either
  // the wrong token or none, and the roster comes back empty with no error
  // anyone would notice.
  unclaimedRoster: (code: string) =>
    playerApi.get(`/join/${encodeURIComponent(code)}/roster`).then(r => r.data),
  joinAsPlayer: (code: string, body: { player_id?: number; name?: string }) =>
    playerApi.post(`/join/${encodeURIComponent(code)}/player`, body).then(r => r.data),
};

/** The address a QR encodes, so a phone's own camera can open it. */
export function joinUrl(code: string): string {
  const base = (typeof window !== 'undefined' && window.location?.origin)
    ? window.location.origin
    : 'https://bloomprint.org';
  return `${base}/join/${code}`;
}

/** Pull the code out of whatever was scanned: our URL, or a bare code. */
export function codeFromScan(value: string): string {
  const m = String(value || '').trim().match(/\/join\/([^/?#\s]+)/);
  return m ? decodeURIComponent(m[1]) : String(value || '').trim();
}

export const teamStaffAPI = {
  search: (q: string) =>
    api.get('/team-staff/search', { params: { q } }).then(r => r.data),
  join: (teamId: number) =>
    api.post(`/team-staff/${teamId}/join`).then(r => r.data),
  leave: (teamId: number) =>
    api.delete(`/team-staff/${teamId}/leave`).then(r => r.data),
  myTeams: () =>
    api.get('/team-staff/my-teams').then(r => r.data),
  teamGames: (teamId: number) =>
    api.get('/team-staff/team-games', { params: { team_id: teamId } }).then(r => r.data),
  createSubteam: (teamId: number, name: string) =>
    api.post(`/team-staff/${teamId}/subteam`, { name }).then(r => r.data),
  subteams: (teamId: number) =>
    api.get(`/team-staff/${teamId}/subteams`).then(r => r.data),
  members: (teamId: number) =>
    api.get(`/team-staff/${teamId}/members`).then(r => r.data),
  // Straight onto a sub-team: they are already staff on the program above, so
  // there is nothing left for them to accept.
  addMember: (teamId: number, coachId: number) =>
    api.post(`/team-staff/${teamId}/members/${coachId}`).then(r => r.data),
  removeMember: (teamId: number, coachId: number) =>
    api.delete(`/team-staff/${teamId}/members/${coachId}`).then(r => r.data),
  coachProfile: (coachId: number) =>
    api.get(`/team-staff/coach/${coachId}`).then(r => r.data),
  invite: (teamId: number, data: { coach_id?: number; email?: string }) =>
    api.post(`/team-staff/${teamId}/invite`, data).then(r => r.data),
  invites: () => api.get('/team-staff/invites').then(r => r.data),
  approveInvite: (id: number) => api.post(`/team-staff/invites/${id}/approve`).then(r => r.data),
  rejectInvite: (id: number) => api.post(`/team-staff/invites/${id}/reject`).then(r => r.data),
  // Requests to join a team YOU own — the mirror image of invites().
  joinRequests: () => api.get('/team-staff/join-requests').then(r => r.data),
  approveJoinRequest: (id: number) =>
    api.post(`/team-staff/join-requests/${id}/approve`).then(r => r.data),
  rejectJoinRequest: (id: number) =>
    api.post(`/team-staff/join-requests/${id}/reject`).then(r => r.data),
  // A player another coach has and this team's roster does not.
  rosterProposals: (): Promise<RosterProposal[]> =>
    api.get('/team-staff/roster-proposals').then(r => r.data),
  approveRosterProposal: (id: number) =>
    api.post(`/team-staff/roster-proposals/${id}/approve`).then(r => r.data),
  rejectRosterProposal: (id: number) =>
    api.post(`/team-staff/roster-proposals/${id}/reject`).then(r => r.data),
  // Omit coachId to claim a team whose owner has left the app.
  transferOwner: (teamId: number, coachId?: number) =>
    api.post(`/team-staff/${teamId}/transfer-owner`, { coach_id: coachId ?? null }).then(r => r.data),
};
