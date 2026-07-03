import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

export const api = axios.create({ baseURL: BASE_URL, timeout: 120000 });

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

  updateProfile: (data: {
    name?: string; role?: string; program_name?: string;
    competition_level?: string; conference?: string;
  }) => api.patch('/auth/me', data).then(r => r.data),
};

// ── Players ───────────────────────────────────────────────────────────────────
export const playersAPI = {
  list: (teamId?: number) =>
    api.get('/players', { params: teamId != null ? { team_id: teamId } : {} }).then(r => r.data),

  get: (id: number) => api.get(`/players/${id}`).then(r => r.data),

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

  teamReport: (data: { output_type: string; focus_prompt?: string; team_id?: number; video?: { uri: string; name: string; type: string } }) => {
    const form = new FormData();
    form.append('output_type', data.output_type);
    if (data.focus_prompt) form.append('focus_prompt', data.focus_prompt);
    if (data.team_id != null) form.append('team_id', String(data.team_id));
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

  regenerate: (playerId: number, feedback: string) =>
    api.post(`/training/players/${playerId}/regenerate`, { feedback }).then(r => r.data),

  sendToPlayer: (trainingId: number) =>
    api.post(`/training/${trainingId}/send-to-player`).then(r => r.data),

  recent: (limit = 30) =>
    api.get('/training/recent', { params: { limit } }).then(r => r.data),

  comments: (trainingId: number) =>
    api.get(`/training/${trainingId}/comments`).then(r => r.data),
  addComment: (trainingId: number, text: string) =>
    api.post(`/training/${trainingId}/comments`, { text }).then(r => r.data),
  refreshPlayerProgram: (trainingId: number, feedback: string) =>
    api.post(`/training/${trainingId}/refresh-player-program`, { feedback }).then(r => r.data),
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

// ── Staff sharing ──────────────────────────────────────────────────────────────
export const staffSharingAPI = {
  share: (data: { report_type: string; report_id: number; recipient_id: number; allow_regenerate?: boolean; frozen_text?: string }) =>
    api.post('/staff-sharing/share', data).then(r => r.data),
  searchTargets: (q: string) =>
    api.get('/staff-sharing/search-targets', { params: { q } }).then(r => r.data),
  shareGroup: (data: { report_type: string; report_id: number; kind: string; coach_id?: number; team_id?: number; program_name?: string; allow_regenerate?: boolean; frozen_text?: string }) =>
    api.post('/staff-sharing/share-group', data).then(r => r.data),
  inbox: () => api.get('/staff-sharing/inbox').then(r => r.data),
  sent: () => api.get('/staff-sharing/sent').then(r => r.data),
  getComments: (sharedId: number) => api.get(`/staff-sharing/${sharedId}/comments`).then(r => r.data),
  addComment: (sharedId: number, text: string) =>
    api.post(`/staff-sharing/${sharedId}/comments`, { text }).then(r => r.data),
  regenerate: (sharedId: number, feedback: string) =>
    api.post(`/staff-sharing/${sharedId}/regenerate`, { feedback }).then(r => r.data),
};

// ── Coaches search ─────────────────────────────────────────────────────────────
export const coachesAPI = {
  search: (q: string) => api.get('/auth/coaches/search', { params: { q } }).then(r => r.data),
  list: () => api.get('/auth/coaches').then(r => r.data),
};

// ── Game Evaluation ────────────────────────────────────────────────────────────
export const gameEvalAPI = {
  createSession: (data: any) => api.post('/game-eval/sessions', data).then(r => r.data),
  listSessions: (params?: any) => api.get('/game-eval/sessions', { params }).then(r => r.data),
  getSession: (id: number) => api.get(`/game-eval/sessions/${id}`).then(r => r.data),
  updateSession: (id: number, data: any) => api.patch(`/game-eval/sessions/${id}`, data).then(r => r.data),
  deleteSession: (id: number) => api.delete(`/game-eval/sessions/${id}`).then(r => r.data),
  listStats: (gameId: number) => api.get(`/game-eval/sessions/${gameId}/stats`).then(r => r.data),
  logStat: (gameId: number, data: any) => api.post(`/game-eval/sessions/${gameId}/stats`, data).then(r => r.data),
  importStats: (gameId: number, file: { uri: string; name: string; type: string }, isOpponent = false) => {
    const form = new FormData();
    form.append('file', file as any);
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
  getScoutingReport: (gameId: number) => api.post(`/game-eval/sessions/${gameId}/ai-scouting`).then(r => r.data),
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
  update: (boardId: number, data: { name?: string; court_type?: string; data?: string }) =>
    api.patch(`/game-eval/whiteboards/${boardId}`, data).then(r => r.data),
  delete: (boardId: number) => api.delete(`/game-eval/whiteboards/${boardId}`).then(r => r.data),
  aiPlay: (description: string) =>
    api.post('/game-eval/ai-play', { description }).then(r => r.data),
};

export const gameReportsAPI = {
  list: () => api.get('/game-reports').then(r => r.data),
  get: (id: number) => api.get(`/game-reports/${id}`).then(r => r.data),
  create: (data: any) => api.post('/game-reports', data).then(r => r.data),
  update: (id: number, data: any) => api.patch(`/game-reports/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/game-reports/${id}`).then(r => r.data),
  addClip: (id: number, formData: FormData) =>
    api.post(`/game-reports/${id}/clips`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data),
  deleteClip: (id: number, clipId: number) => api.delete(`/game-reports/${id}/clips/${clipId}`).then(r => r.data),
  uploadDoc: (id: number, formData: FormData) =>
    api.post(`/game-reports/${id}/upload-doc`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data),
  generate: (id: number) => api.post(`/game-reports/${id}/generate`).then(r => r.data),
  teamTraining: (id: number, focusPrompt?: string) =>
    api.post(`/game-reports/${id}/team-training`, { focus_prompt: focusPrompt ?? null }).then(r => r.data),
  correct: (id: number, correction: string) =>
    api.post(`/game-reports/${id}/correct`, { correction }).then(r => r.data),
  correctClip: (id: number, clipId: number, correction: string) =>
    api.post(`/game-reports/${id}/clips/${clipId}/correct`, { correction }).then(r => r.data),
};


export const transcribeAPI = {
  transcribe: (uri: string, context?: string) => {
    const formData = new FormData();
    formData.append('audio', { uri, name: 'audio.m4a', type: 'audio/m4a' } as any);
    if (context) formData.append('context', context);
    return api.post('/transcribe', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 45000,
    }).then(r => r.data.text as string);
  },
};

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
};
