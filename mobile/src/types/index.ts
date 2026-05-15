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
  program_name: string;
  created_at: string;
}

export interface Player {
  id: number;
  name: string;
  position: string | null;
  age: number | null;
  height: string | null;
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
}

export type OutputType =
  | 'film_breakdown'
  | 'player_eval'
  | 'scouting_report'
  | 'coaching_report'
  | 'training_program'
  | 'recruitment_profile'
  | 'position_analysis'
  | 'game_analysis';
