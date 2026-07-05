export interface Team {
  id: number;
  name: string;
  coach_id: number;
  competition_level: string;
  created_at: string;
}

export interface Coach {
  id: number;
  name: string;
  email: string;
  weight: number;
  level: string;
  role: string;
  program_name: string;
  competition_level?: string | null;
  conference?: string | null;
  system_profile?: Record<string, string> | null;
  created_at: string;
}

export interface Player {
  id: number;
  name: string;
  position: string | null;
  age: number | null;
  height: string | null;
  wingspan: string | null;
  weight: string | null;
  standing_reach: string | null;
  program_name: string;
  competition_level: string;
  notes: string | null;
  created_at: string;
  latest_grade: number | null;
  team_id: number | null;
  team_name: string | null;
}

export interface Evaluation {
  id: number;
  player_id: number;
  coach_id: number;
  output_type: string;
  competition_level: string | null;
  coach_weight: number | null;
  coach_notes: string | null;
  report_text: string | null;
  overall_grade: number | null;
  pillar_grades: Record<string, number> | null;
  key_questions: string[] | null;
  green_flags: string[] | null;
  watch_flags: string[] | null;
  created_at: string;
}

export interface EvalWithPlayer extends Evaluation {
  player_name: string;
}

export interface Correction {
  id: number;
  evaluation_id: number;
  coach_id: number;
  pillar: string | null;
  original_text: string | null;
  correction: string;
  coach_weight: number | null;
  applied: boolean;
  created_at: string;
}

export interface TrainingSession {
  id: number;
  player_id: number;
  coach_id: number;
  evaluation_id: number | null;
  program_text: string | null;
  priorities: string[] | null;
  created_at: string;
  sent_to_player?: boolean;
  reformatting?: boolean;
  player_program_text?: string | null;
}

export type OutputType =
  | 'film_breakdown'
  | 'player_eval'
  | 'scouting_report'
  | 'coaching_report'
  | 'training_program'
  | 'recruitment_profile'
  | 'position_analysis'
  | 'game_analysis'
  | 'box_score';

// ── Player system types ───────────────────────────────────────────────────────

export interface PlayerUser {
  id: number;
  name: string;
  email: string;
  player_id: number | null;
  avatar?: string | null;
  linked_player_name?: string | null;
  linked_team_name?: string | null;
  linked_program_name?: string | null;
  created_at: string;
}

export interface SharedReport {
  id: number;
  evaluation_id: number;
  player_user_id: number;
  shared_by_id: number;
  share_report_text: boolean;
  share_grades: boolean;
  share_flags: boolean;
  share_questions: boolean;
  message: string | null;
  created_at: string;
  output_type: string;
  report_text: string | null;
  overall_grade: number | null;
  pillar_grades: Record<string, number> | null;
  green_flags: string[] | null;
  watch_flags: string[] | null;
  key_questions: string[] | null;
  shared_by_name: string;
}

export interface PlayerTraining {
  id: number;
  player_user_id: number;
  shared_report_id: number;
  program_text: string | null;
  coach_notes: string | null;
  completed_drills?: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface PlayerComment {
  id: number;
  player_user_id: number | null;
  coach_id: number | null;
  text: string;
  created_at: string;
  author_name: string;
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  read: boolean;
  ref_id: number | null;
  created_at: string;
}
