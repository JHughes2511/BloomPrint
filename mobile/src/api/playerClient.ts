import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
export const playerApi = axios.create({ baseURL: BASE_URL });

playerApi.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('player_auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const playerAuthAPI = {
  register: (data: { name: string; email: string; password: string }) =>
    playerApi.post('/player-auth/register', data).then(r => r.data),
  login: (email: string, password: string) =>
    playerApi.post('/player-auth/login', { email, password }).then(r => r.data),
  me: () => playerApi.get('/player-auth/me').then(r => r.data),
  updateMe: (data: { name?: string; avatar?: string | null }) =>
    playerApi.patch('/player-auth/me', data).then(r => r.data),
};

export const playerReportsAPI = {
  list: () => playerApi.get('/player/shared-reports').then(r => r.data),
  listTeam: () => playerApi.get('/player/team-shared-reports').then(r => r.data),
  get: (id: number) => playerApi.get(`/player/shared-reports/${id}`).then(r => r.data),
  addComment: (id: number, text: string) =>
    playerApi.post(`/player/shared-reports/${id}/comments`, { text }).then(r => r.data),
  getComments: (id: number) =>
    playerApi.get(`/player/shared-reports/${id}/comments`).then(r => r.data),
};

export const playerTrainingAPI = {
  generate: (sharedReportId: number) =>
    playerApi.post(`/player/training/generate/${sharedReportId}`).then(r => r.data),
  list: () => playerApi.get('/player/training').then(r => r.data),
  getComments: (id: number) =>
    playerApi.get(`/player/training/${id}/comments`).then(r => r.data),
  addComment: (id: number, text: string) =>
    playerApi.post(`/player/training/${id}/comments`, { text }).then(r => r.data),
  refresh: (id: number, feedback: string) =>
    playerApi.post(`/player/training/${id}/refresh`, { feedback }).then(r => r.data),
  setProgress: (id: number, completed_drills: string[]) =>
    playerApi.patch(`/player/training/${id}/progress`, { completed_drills }).then(r => r.data),
  listCoachSent: () =>
    playerApi.get('/player/coach-training').then(r => r.data),
  getCoachSent: (id: number) =>
    playerApi.get(`/player/coach-training/${id}`).then(r => r.data),
  getCoachSentComments: (id: number) =>
    playerApi.get(`/player/coach-training/${id}/comments`).then(r => r.data),
  addCoachSentComment: (id: number, text: string) =>
    playerApi.post(`/player/coach-training/${id}/comments`, { text }).then(r => r.data),
  setCoachSentProgress: (id: number, completed_drills: string[]) =>
    playerApi.patch(`/player/coach-training/${id}/progress`, { completed_drills }).then(r => r.data),
  refreshCoachSent: (id: number, feedback: string) =>
    playerApi.post(`/player/coach-training/${id}/refresh`, { feedback }).then(r => r.data),
};

export const playerNotificationsAPI = {
  list: () => playerApi.get('/player/notifications').then(r => r.data),
  markRead: (id: number) =>
    playerApi.post(`/player/notifications/${id}/read`).then(r => r.data),
  markAllRead: () =>
    playerApi.post('/player/notifications/read-all').then(r => r.data),
};

export const playerLinkAPI = {
  useInvite: (code: string) =>
    playerApi.post('/player/use-invite', { code }).then(r => r.data),
  searchPlayers: (q: string) =>
    playerApi.get('/player/search-players', { params: { q } }).then(r => r.data),
  requestLink: (playerId: number) =>
    playerApi.post(`/player/link-request/${playerId}`).then(r => r.data),
  listLinks: () => playerApi.get('/player/links').then(r => r.data),
  unlink: (playerId: number) =>
    playerApi.delete(`/player/links/${playerId}`).then(r => r.data),
};

export const playerProfileAPI = {
  get: () => playerApi.get('/player-auth/linked-player').then(r => r.data),
  update: (data: {
    position?: string;
    height?: string;
    wingspan?: string;
    weight?: string;
    standing_reach?: string;
    country?: string;
    state?: string;
    city?: string;
    school_name?: string;
  }) => playerApi.patch('/player-auth/linked-player', data).then(r => r.data),
};
