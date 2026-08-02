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
 * the record were missing.
 */
import type { LinkingOptions } from '@react-navigation/native';

const id = {
  parse: { playerId: Number, evalId: Number, trainingId: Number,
           reportId: Number, conversationId: Number, gameId: Number },
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
