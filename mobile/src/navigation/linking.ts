/**
 * URLs for the web build, so a page has an address.
 *
 * Without this, every screen is bloomprint.org: refreshing restarts the app at
 * the initial route, the back button leaves the site, and there is no way to
 * send someone a link to the thing you are both looking at. Deep-linking config
 * is what turns navigation state into a URL and back again.
 *
 * Modals are deliberately absent. Edit Profile, New Game and the whiteboard are
 * not addressable: a URL that reopens a half-filled form on reload is usually
 * worse than one that lands on the page beneath it, and giving every sheet a
 * path is a lot of surface for very little. A refresh closes the sheet and
 * keeps the screen.
 *
 * Ids are parsed to numbers. A URL only carries strings, and screens compare
 * these against numeric ids from the API — `"12" === 12` is false, so a
 * player's own row would fail to match and the screen would render as though
 * the record were missing. See leadingId: a segment may also carry a readable
 * suffix, which is understood on the way in and never written on the way out.
 */
import type { LinkingOptions } from '@react-navigation/native';

/**
 * Read the id off the front of a segment, ignoring anything after it.
 *
 * Accepts "1" and "1-bloom" alike, so a link someone typed or tidied by hand
 * still opens the right record. The app writes the plain id; the readable
 * suffix is understood, not generated — producing it would mean every navigate
 * call carrying a name, and navigation is not where this needs more moving
 * parts.
 *
 * Number() would not do: Number("1-bloom") is NaN, so a link with a name in it
 * would fail rather than simply lose the decoration.
 */
const leadingId = (v: string): number => parseInt(String(v), 10);

const id = {
  parse: { playerId: leadingId, evalId: leadingId, trainingId: leadingId,
           reportId: leadingId, conversationId: leadingId, gameId: leadingId,
           teamId: leadingId },
};

export const linking: LinkingOptions<any> = {
  prefixes: [],
  config: {
    screens: {
      // ── Signed out ────────────────────────────────────────────────────────
      RoleSelect: '',
      CoachLogin: 'login',
      PlayerLogin: 'player/login',
      PlayerRegister: 'player/register',

      // ── Coach ─────────────────────────────────────────────────────────────
      HomeTab: {
        path: 'home',
        screens: {
          Home: '',
          CoachNotifications: 'notifications',
          CoachTrainingDetail: { path: 'training/:trainingId', ...id },
          StaffInbox: 'staff',
          TeamDetail: { path: 'staff/team/:teamId', ...id },
          Conversation: { path: 'staff/:conversationId', ...id },
          Onboarding: 'onboarding',
        },
      },
      TeamTab: {
        path: 'team-eval',
        screens: {
          Team: '',
          GameReportBuilder: { path: 'packet/:reportId', ...id },
          Summary: 'summary',
          Import: 'import',
        },
      },
      TeamEvalTab: {
        path: 'team-grade',
        screens: { TeamEval: '' },
      },
      RosterTab: {
        path: 'roster',
        screens: {
          Roster: '',
          PlayerProfile: { path: 'player/:playerId', ...id },
          NewEval: { path: 'player/:playerId/new-eval', ...id },
          Training: { path: 'player/:playerId/training', ...id },
          EvalReport: { path: 'eval/:evalId', ...id },
          Summary: 'summary',
          Import: 'import',
        },
      },
      RecentTab: {
        path: 'recent',
        screens: {
          Recent: '',
          EvalReport: { path: 'eval/:evalId', ...id },
          PlayerProfile: { path: 'player/:playerId', ...id },
          NewEval: { path: 'player/:playerId/new-eval', ...id },
          Training: { path: 'player/:playerId/training', ...id },
          GameReportBuilder: { path: 'packet/:reportId', ...id },
          Summary: 'summary',
          StaffInbox: 'staff',
          TeamDetail: { path: 'staff/team/:teamId', ...id },
          Conversation: { path: 'staff/:conversationId', ...id },
        },
      },

      // ── Player ────────────────────────────────────────────────────────────
      PlayerHomeTab: {
        path: 'my',
        screens: {
          PlayerHome: '',
          PlayerReportDetail: { path: 'report/:reportId', ...id },
          PlayerTeamReportDetail: { path: 'team-report/:reportId', ...id },
        },
      },
      InboxTab: {
        path: 'my/reports',
        screens: {
          PlayerInbox: '',
          PlayerReportDetail: { path: ':reportId', ...id },
          PlayerTeamReportDetail: { path: 'team/:reportId', ...id },
          PlayerTraining: 'training',
          PlayerTrainingDetail: { path: 'training/:trainingId', ...id },
          PlayerCoachTrainingDetail: { path: 'coach-training/:trainingId', ...id },
        },
      },
      TrainingTab: {
        path: 'my/training',
        screens: {
          PlayerTraining: '',
          PlayerTrainingDetail: { path: ':trainingId', ...id },
          PlayerCoachTrainingDetail: { path: 'from-coach/:trainingId', ...id },
        },
      },
      PlayerNotifsTab: {
        path: 'my/alerts',
        screens: {
          PlayerNotifications: '',
          PlayerReportDetail: { path: 'report/:reportId', ...id },
          PlayerTeamReportDetail: { path: 'team-report/:reportId', ...id },
          PlayerTrainingDetail: { path: 'training/:trainingId', ...id },
        },
      },
      ProfileTab: 'my/profile',
    },
  },
};
