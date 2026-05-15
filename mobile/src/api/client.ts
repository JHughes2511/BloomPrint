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
  register: (data: { name: string; email: string; password: string; weight?: number; program_name?: string }) =>
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

  get: (id: number) => api.get(`/evaluations/${id}`).then(r => r.data),

  recent: (limit = 30) =>
    api.get('/evaluations/recent', { params: { limit } }).then(r => r.data),

  teamReport: (data: { output_type: string; focus_prompt?: string }) =>
    api.post('/evaluations/team-report', data).then(r => r.data),

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
