import axios from 'axios';
import * as SecureStore from '../storage/secureStore';
import { emitPlayerUnauthorized } from './authFailure';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
export const playerApi = axios.create({ baseURL: BASE_URL });

playerApi.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('player_auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Same contract as the coach client: a rejected token is announced once and
// centrally. Login and register are exempt — a 401 there means wrong password.
const AUTH_EXEMPT = /\/player-auth\/(login|register|google)/;
playerApi.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    const url = err?.config?.url ?? '';
    if (status === 401 && !AUTH_EXEMPT.test(url)) emitPlayerUnauthorized();
    return Promise.reject(err);
  },
);

export const playerAuthAPI = {
  register: (data: { name: string; email: string; password: string; country?: string; city?: string }) =>
    playerApi.post('/player-auth/register', data).then(r => r.data),
  login: (email: string, password: string) =>
    playerApi.post('/player-auth/login', { email, password }).then(r => r.data),
  google: (data: { id_token: string; mode: 'login' | 'register'; name?: string; country?: string; city?: string }) =>
    playerApi.post('/player-auth/google', data).then(r => r.data),
  requestPasswordReset: (email: string) =>
    playerApi.post('/player-auth/password-reset/request', { email }).then(r => r.data),
  confirmPasswordReset: (token: string, password: string) =>
    playerApi.post('/player-auth/password-reset/confirm', { token, password }).then(r => r.data),
  me: () => playerApi.get('/player-auth/me').then(r => r.data),
  updateMe: (data: { name?: string; avatar?: string | null; country?: string; city?: string }) =>
    playerApi.patch('/player-auth/me', data).then(r => r.data),
};

export const playerReportsAPI = {
  list: () => playerApi.get('/player/shared-reports').then(r => r.data),
  listTeam: () => playerApi.get('/player/team-shared-reports').then(r => r.data),
  get: (id: number) => playerApi.get(`/player/shared-reports/${id}`).then(r => r.data),
  addComment: (id: number, text: string, parentId?: number) =>
    playerApi.post(`/player/shared-reports/${id}/comments`, { text, parent_id: parentId }).then(r => r.data),
  /** Rewrite a comment you left. */
  editComment: (commentId: number, text: string) =>
    playerApi.patch(`/player/comments/${commentId}`, { text }).then(r => r.data),
  /** Take one of yours back. It keeps its place so replies still read. */
  deleteComment: (commentId: number) =>
    playerApi.delete(`/player/comments/${commentId}`).then(r => r.data),
  getComments: (id: number) =>
    playerApi.get(`/player/shared-reports/${id}/comments`).then(r => r.data),
};

export const playerTrainingAPI = {
  /** Rewrite a comment you left. Same endpoint as the reports one — a comment
   *  is a comment, whichever screen it was written on. */
  editComment: (commentId: number, text: string) =>
    playerApi.patch(`/player/comments/${commentId}`, { text }).then(r => r.data),
  /** Take one of yours back. It keeps its place so replies still read. */
  deleteComment: (commentId: number) =>
    playerApi.delete(`/player/comments/${commentId}`).then(r => r.data),
  generate: (sharedReportId: number) =>
    playerApi.post(`/player/training/generate/${sharedReportId}`).then(r => r.data),
  list: () => playerApi.get('/player/training').then(r => r.data),
  getComments: (id: number) =>
    playerApi.get(`/player/training/${id}/comments`).then(r => r.data),
  addComment: (id: number, text: string, parentId?: number) =>
    playerApi.post(`/player/training/${id}/comments`, { text, parent_id: parentId }).then(r => r.data),
  refresh: (id: number, feedback: string) =>
    playerApi.post(`/player/training/${id}/refresh`, { feedback }).then(r => r.data),
  corrections: (id: number) =>
    playerApi.get(`/player/training/${id}/corrections`).then(r => r.data),
  addCorrection: (id: number, text: string) =>
    playerApi.post(`/player/training/${id}/corrections`, { text }).then(r => r.data),
  applyCorrections: (id: number) =>
    playerApi.post(`/player/training/${id}/apply-corrections`).then(r => r.data),
  setProgress: (id: number, completed_drills: string[]) =>
    playerApi.patch(`/player/training/${id}/progress`, { completed_drills }).then(r => r.data),
  listCoachSent: () =>
    playerApi.get('/player/coach-training').then(r => r.data),
  getCoachSent: (id: number) =>
    playerApi.get(`/player/coach-training/${id}`).then(r => r.data),
  getCoachSentComments: (id: number) =>
    playerApi.get(`/player/coach-training/${id}/comments`).then(r => r.data),
  addCoachSentComment: (id: number, text: string, parentId?: number) =>
    playerApi.post(`/player/coach-training/${id}/comments`, { text, parent_id: parentId }).then(r => r.data),
  setCoachSentProgress: (id: number, completed_drills: string[]) =>
    playerApi.patch(`/player/coach-training/${id}/progress`, { completed_drills }).then(r => r.data),
  refreshCoachSent: (id: number, feedback: string) =>
    playerApi.post(`/player/coach-training/${id}/refresh`, { feedback }).then(r => r.data),
  coachSentCorrections: (id: number) =>
    playerApi.get(`/player/coach-training/${id}/corrections-list`).then(r => r.data),
  addCoachSentCorrection: (id: number, text: string) =>
    playerApi.post(`/player/coach-training/${id}/corrections`, { text }).then(r => r.data),
  applyCoachSentCorrections: (id: number) =>
    playerApi.post(`/player/coach-training/${id}/apply-corrections`).then(r => r.data),
};

export const shareApprovalsAPI = {
  list: () => playerApi.get('/player/share-approvals').then(r => r.data),
  approve: (id: number) => playerApi.post(`/player/share-approvals/${id}/approve`).then(r => r.data),
  reject: (id: number) => playerApi.post(`/player/share-approvals/${id}/reject`).then(r => r.data),
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
  // Everything a player owns about themselves. country/state/city were already
  // accepted by the server and simply never sent — they went to the account
  // record instead, where a coach cannot see them.
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
    age?: number;
    competition_level?: string;
  }) => playerApi.patch('/player-auth/linked-player', data).then(r => r.data),
};
