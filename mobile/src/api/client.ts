import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  register: (data: { name: string; email: string; password: string; weight?: number; program_name?: string; role?: string }) =>
    api.post('/auth/register', data).then(r => r.data),

  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then(r => r.data),

  me: () => api.get('/auth/me').then(r => r.data),
};

// ── Players ───────────────────────────────────────────────────────────────────
export const playersAPI = {
  list: (teamId?: number) =>
    api.get('/players', { params: teamId != null ? { team_id: teamId } : {} }).then(r => r.data),

  get: (id: number) => api.get(`/players/${id}`).then(r => r.data),

  create: (data: {
    name: string; position?: string; age?: number;
    height?: string; competition_level?: string; notes?: string; team_id?: number;
  }) => api.post('/players', data).then(r => r.data),

  delete: (id: number) => api.delete(`/players/${id}`).then(r => r.data),

  evaluations: (id: number) => api.get(`/players/${id}/evaluations`).then(r => r.data),

  summary: (id: number, data: { output_type: string; focus_prompt?: string }) =>
    api.post(`/players/${id}/summary`, data).then(r => r.data),
};

// ── Evaluations ───────────────────────────────────────────────────────────────
export const evalsAPI = {
  submit: (formData: FormData) =>
    api.post('/evaluations', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),

  delete: (id: number) => api.delete(`/evaluations/${id}`).then(r => r.data),

  get: (id: number) => api.get(`/evaluations/${id}`).then(r => r.data),

  recent: (limit = 30) =>
    api.get('/evaluations/recent', { params: { limit } }).then(r => r.data),

  teamReport: (data: { output_type: string; focus_prompt?: string; video?: { uri: string; name: string; type: string } }) => {
    const form = new FormData();
    form.append('output_type', data.output_type);
    if (data.focus_prompt) form.append('focus_prompt', data.focus_prompt);
    if (data.video) form.append('video', { uri: data.video.uri, name: data.video.name, type: data.video.type } as any);
    return api.post('/evaluations/team-report', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
  },

  teamReports: (limit = 30) =>
    api.get('/evaluations/team-reports/recent', { params: { limit } }).then(r => r.data),
  deleteTeamReport: (id: number) =>
    api.delete(`/evaluations/team-reports/${id}`).then(r => r.data),

  addCorrection: (evalId: number, data: { pillar?: string; original_text?: string; correction: string }) =>
    api.post(`/evaluations/${evalId}/corrections`, data).then(r => r.data),

  corrections: (evalId: number) =>
    api.get(`/evaluations/${evalId}/corrections`).then(r => r.data),
};

// ── Teams ─────────────────────────────────────────────────────────────────────
export const teamsAPI = {
  list: () => api.get('/teams').then(r => r.data),
  create: (data: { name: string; competition_level?: string }) =>
    api.post('/teams', data).then(r => r.data),
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
  generate: (data: { player_id: number; evaluation_id?: number; focus_prompt?: string }) =>
    api.post('/training', data).then(r => r.data),

  forPlayer: (playerId: number) =>
    api.get(`/training/player/${playerId}`).then(r => r.data),
};

// ── Player (coach-side) ────────────────────────────────────────────────────────
export interface ShareReportRequest {
  player_user_id: number;
  share_report_text?: boolean;
  share_grades?: boolean;
  share_flags?: boolean;
  share_questions?: boolean;
  message?: string | null;
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
  addCoachComment: (trainingId: number, data: { text: string }) =>
    api.post(`/player/training/${trainingId}/coach-comment`, data).then(r => r.data),
  coachMarkAllRead: () =>
    api.post('/player/coach-notifications/read-all').then(r => r.data),
  coachViewSharedReport: (sharedId: number) =>
    api.get(`/player/shared-reports/${sharedId}/coach-view`).then(r => r.data),
  coachReplyToReport: (sharedId: number, text: string) =>
    api.post(`/player/shared-reports/${sharedId}/coach-reply`, { text }).then(r => r.data),
  shareTeamReport: (data: { output_type: string; report_text: string; target_type: string; player_user_id?: number; team_id?: number; message?: string }) =>
    api.post('/player/share-team-report', data).then(r => r.data),
  searchStaff: (q: string) =>
    api.get('/player/staff/search', { params: { q } }).then(r => r.data),
  getTrainingDetail: (trainingId: number) =>
    api.get(`/player/training/${trainingId}/detail`).then(r => r.data),
  coachRefreshTraining: (trainingId: number, feedback: string) =>
    api.post(`/player/training/${trainingId}/coach-refresh`, { feedback }).then(r => r.data),
};
