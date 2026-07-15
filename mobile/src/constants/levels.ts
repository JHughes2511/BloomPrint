// The one canonical coach-facing competition-level list, weight-ordered. Every
// picker (signup, profile, roster, player, import) imports this so they stay in
// sync with the backend weight table (_auto_weight). The Team Grade / New Game
// screen and the BIM's internal vocabulary keep their own granular lists
// (D1/D2/D3, AAU age tiers, NBA/G-League, …) on purpose.
export const COMPETITION_LEVELS = [
  'Youth',
  'Middle School',
  'HS JV',
  'AAU',
  'HS Varsity',
  'Prep School',
  'JUCO',
  'College',
  'Pro',
] as const;
