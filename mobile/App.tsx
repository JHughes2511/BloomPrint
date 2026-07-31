import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, Text, PanResponder } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { PlayerAuthProvider, usePlayerAuth } from './src/context/PlayerAuthContext';
import './src/i18n';
import { initAppLanguage } from './src/i18n';
import { useTranslation } from 'react-i18next';
import ErrorBoundary from './src/components/ErrorBoundary';
// Side-effect import: patches react-native-web's do-nothing Alert and installs
// the global CSS. Must run before anything renders or reports an error.
import './src/web/webShims';
import { useBreakpoint } from './src/responsive/useBreakpoint';
import Sidebar from './src/navigation/Sidebar';

// 5 tabs at fontSize 9: translated labels (de/nl/el run 30-40% longer than the
// English) used to clip mid-word. Wrapping to two tight lines keeps the label
// readable at full size and still fits above the standard tab-bar height.
function tabLabel(label: string, sidebar = false) {
  if (sidebar) {
    // A sidebar row has horizontal room, so the label is set at a readable size
    // on one line — the two-line 9px treatment below exists only because five
    // tabs have to share the width of a phone.
    return ({ color }: { color: string }) => (
      <Text
        numberOfLines={1}
        style={{ fontSize: 14, lineHeight: 18, color, marginLeft: 10, flexShrink: 1 }}
      >
        {label}
      </Text>
    );
  }
  return ({ color }: { color: string }) => (
    <Text
      numberOfLines={2}
      ellipsizeMode="tail"
      style={{
        fontSize: 9, lineHeight: 10, textAlign: 'center', color,
        includeFontPadding: false, marginBottom: 2, paddingHorizontal: 1,
      }}
    >
      {label}
    </Text>
  );
}

// Coach screens
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import RosterScreen from './src/screens/RosterScreen';
import PlayerProfileScreen from './src/screens/PlayerProfileScreen';
import NewEvalScreen from './src/screens/NewEvalScreen';
import EvalReportScreen from './src/screens/EvalReportScreen';
import TrainingScreen from './src/screens/TrainingScreen';
import TeamReportScreen from './src/screens/TeamReportScreen';
import RecentScreen from './src/screens/RecentScreen';
import SummaryScreen from './src/screens/SummaryScreen';
import ImportScreen from './src/screens/ImportScreen';
import CoachNotificationsScreen from './src/screens/CoachNotificationsScreen';
import CoachTrainingDetailScreen from './src/screens/CoachTrainingDetailScreen';
import GameReportBuilderScreen from './src/screens/GameReportBuilderScreen';
import StaffInboxScreen from './src/screens/StaffInboxScreen';
import ConversationScreen from './src/screens/ConversationScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import TeamEvalScreen from './src/screens/TeamEvalScreen';

// Role select
import RoleSelectScreen from './src/screens/RoleSelectScreen';

// Player screens
import PlayerLoginScreen from './src/screens/player/PlayerLoginScreen';
import PlayerRegisterScreen from './src/screens/player/PlayerRegisterScreen';
import PlayerHomeScreen from './src/screens/player/PlayerHomeScreen';
import PlayerInboxScreen from './src/screens/player/PlayerInboxScreen';
import PlayerReportDetailScreen from './src/screens/player/PlayerReportDetailScreen';
import PlayerTrainingScreen from './src/screens/player/PlayerTrainingScreen';
import PlayerTrainingDetailScreen from './src/screens/player/PlayerTrainingDetailScreen';
import PlayerCoachTrainingDetailScreen from './src/screens/player/PlayerCoachTrainingDetailScreen';
import PlayerNotificationsScreen from './src/screens/player/PlayerNotificationsScreen';
import PlayerTeamReportDetailScreen from './src/screens/player/PlayerTeamReportDetailScreen';
import PlayerLinkScreen from './src/screens/player/PlayerLinkScreen';

import {
  useFonts,
  HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold, HankenGrotesk_800ExtraBold, HankenGrotesk_900Black,
} from '@expo-google-fonts/hanken-grotesk';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const SCREEN_OPTIONS = { headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } };
const PLAYER_SCREEN_OPTIONS = { headerShown: false, contentStyle: { backgroundColor: '#0f1a0f' } };

function HomeStack() {
  return (
    <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="CoachNotifications" component={CoachNotificationsScreen} />
      <Stack.Screen name="CoachTrainingDetail" component={CoachTrainingDetailScreen} />
      <Stack.Screen name="StaffInbox" component={StaffInboxScreen} />
      <Stack.Screen name="Conversation" component={ConversationScreen} />
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
    </Stack.Navigator>
  );
}

function OnboardingStack() {
  return (
    <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
    </Stack.Navigator>
  );
}

function TeamStack() {
  return (
    <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
      <Stack.Screen name="Team" component={TeamReportScreen} />
      <Stack.Screen name="GameReportBuilder" component={GameReportBuilderScreen} />
      <Stack.Screen name="Summary" component={SummaryScreen} />
      <Stack.Screen name="Import" component={ImportScreen} />
    </Stack.Navigator>
  );
}

function TeamEvalStack() {
  return (
    <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
      <Stack.Screen name="TeamEval" component={TeamEvalScreen} />
    </Stack.Navigator>
  );
}

function RosterStack() {
  return (
    <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
      <Stack.Screen name="Roster" component={RosterScreen} />
      <Stack.Screen name="PlayerProfile" component={PlayerProfileScreen} />
      <Stack.Screen name="NewEval" component={NewEvalScreen} />
      <Stack.Screen name="EvalReport" component={EvalReportScreen} />
      <Stack.Screen name="Training" component={TrainingScreen} />
      <Stack.Screen name="Summary" component={SummaryScreen} />
      <Stack.Screen name="Import" component={ImportScreen} />
    </Stack.Navigator>
  );
}

function RecentStack() {
  return (
    <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
      <Stack.Screen name="Recent" component={RecentScreen} />
      <Stack.Screen name="EvalReport" component={EvalReportScreen} />
      <Stack.Screen name="PlayerProfile" component={PlayerProfileScreen} />
      {/* Reachable from PlayerProfile, which lives in this stack too */}
      <Stack.Screen name="NewEval" component={NewEvalScreen} />
      <Stack.Screen name="Training" component={TrainingScreen} />
      <Stack.Screen name="Summary" component={SummaryScreen} />
      <Stack.Screen name="GameReportBuilder" component={GameReportBuilderScreen} />
      <Stack.Screen name="StaffInbox" component={StaffInboxScreen} />
    </Stack.Navigator>
  );
}

function AppTabs() {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  // Sidebar once there's width for it. Keyed off window width, not platform, so
  // a half-width browser window still gets bottom tabs and a big tablet gets
  // the sidebar — the question is how much room there is, not which OS it is.
  const { isDesktop } = useBreakpoint();

  return (
    <Tab.Navigator
      // Left rail once there's room, the stock bottom bar otherwise. The custom
      // bar owns its own width and active styling; see src/navigation/Sidebar.tsx.
      tabBar={(props) => (isDesktop ? <Sidebar {...props} /> : <BottomTabBar {...props} />)}
      screenOptions={({ route }) => ({
        headerShown: false,
        // Lays the navigator out as a row so the rail sits beside the content.
        tabBarPosition: isDesktop ? ('left' as const) : ('bottom' as const),
        tabBarStyle: { backgroundColor: t.isDark ? '#0C2331' : '#EFE7DA', borderTopColor: t.divider },
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted2,
        tabBarItemStyle: { flex: 1, flexShrink: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 1 },
        tabBarIconStyle: { marginBottom: -1 },
        tabBarIcon: ({ focused, color }) => {
          const icons: Record<string, [string, string]> = {
            HomeTab:     ['home',        'home-outline'],
            TeamTab:     ['people',      'people-outline'],
            TeamEvalTab: ['stats-chart', 'stats-chart-outline'],
            RosterTab:   ['list',        'list-outline'],
            RecentTab:   ['time',        'time-outline'],
          };
          const [active, inactive] = icons[route.name] ?? ['grid', 'grid-outline'];
          return <Ionicons name={(focused ? active : inactive) as any} size={22} color={color} />;
        },
      })}
    >
      <Tab.Screen name="HomeTab"     component={HomeStack}     options={{ tabBarLabel: isDesktop ? tr('common.tabs.home') : tabLabel(tr('common.tabs.home')) }} />
      <Tab.Screen name="TeamTab"     component={TeamStack}     options={{ tabBarLabel: isDesktop ? tr('common.tabs.teamEval') : tabLabel(tr('common.tabs.teamEval')) }} />
      <Tab.Screen name="TeamEvalTab" component={TeamEvalStack} options={{ tabBarLabel: isDesktop ? tr('common.tabs.teamGrade') : tabLabel(tr('common.tabs.teamGrade')) }} />
      <Tab.Screen name="RosterTab"   component={RosterStack}   options={{ tabBarLabel: isDesktop ? tr('common.tabs.roster') : tabLabel(tr('common.tabs.roster')) }} />
      <Tab.Screen name="RecentTab"   component={RecentStack}   options={{ tabBarLabel: isDesktop ? tr('common.tabs.recent') : tabLabel(tr('common.tabs.recent')) }} />
    </Tab.Navigator>
  );
}

// ── Player navigation ──────────────────────────────────────────────────────────

function PlayerHomeStack() {
  return (
    <Stack.Navigator screenOptions={PLAYER_SCREEN_OPTIONS}>
      <Stack.Screen name="PlayerHome" component={PlayerHomeScreen} />
      <Stack.Screen name="PlayerReportDetail" component={PlayerReportDetailScreen} />
      <Stack.Screen name="PlayerTeamReportDetail" component={PlayerTeamReportDetailScreen} />
    </Stack.Navigator>
  );
}

function PlayerInboxStack() {
  return (
    <Stack.Navigator screenOptions={PLAYER_SCREEN_OPTIONS}>
      <Stack.Screen name="PlayerInbox" component={PlayerInboxScreen} />
      <Stack.Screen name="PlayerReportDetail" component={PlayerReportDetailScreen} />
      <Stack.Screen name="PlayerTeamReportDetail" component={PlayerTeamReportDetailScreen} />
      <Stack.Screen name="PlayerTraining" component={PlayerTrainingScreen} />
      <Stack.Screen name="PlayerTrainingDetail" component={PlayerTrainingDetailScreen} />
      <Stack.Screen name="PlayerCoachTrainingDetail" component={PlayerCoachTrainingDetailScreen} />
    </Stack.Navigator>
  );
}

function PlayerTrainingStack() {
  return (
    <Stack.Navigator screenOptions={PLAYER_SCREEN_OPTIONS}>
      <Stack.Screen name="PlayerTraining" component={PlayerTrainingScreen} />
      <Stack.Screen name="PlayerTrainingDetail" component={PlayerTrainingDetailScreen} />
      <Stack.Screen name="PlayerCoachTrainingDetail" component={PlayerCoachTrainingDetailScreen} />
    </Stack.Navigator>
  );
}

function PlayerNotifStack() {
  return (
    <Stack.Navigator screenOptions={PLAYER_SCREEN_OPTIONS}>
      <Stack.Screen name="PlayerNotifications" component={PlayerNotificationsScreen} />
      <Stack.Screen name="PlayerReportDetail" component={PlayerReportDetailScreen} />
      <Stack.Screen name="PlayerTeamReportDetail" component={PlayerTeamReportDetailScreen} />
      <Stack.Screen name="PlayerTrainingDetail" component={PlayerTrainingDetailScreen} />
      <Stack.Screen name="PlayerCoachTrainingDetail" component={PlayerCoachTrainingDetailScreen} />
    </Stack.Navigator>
  );
}

const PLAYER_TABS = ['PlayerHomeTab', 'InboxTab', 'TrainingTab', 'PlayerNotifsTab', 'ProfileTab'];

function withTabSwipe<T extends object>(WrappedComponent: React.ComponentType<T>) {
  return function SwipeWrapper(props: T) {
    const navigation = useNavigation<any>();

    const panResponder = React.useMemo(() => PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy }) =>
        Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 1.8,
      onPanResponderRelease: (_, { dx }) => {
        if (Math.abs(dx) < 60) return;
        const parent = navigation.getParent();
        if (!parent) return;
        const state = parent.getState();
        if (!state) return;
        const idx = state.index as number;
        if (dx < 0 && idx < PLAYER_TABS.length - 1) {
          parent.navigate(PLAYER_TABS[idx + 1]);
        } else if (dx > 0 && idx > 0) {
          parent.navigate(PLAYER_TABS[idx - 1]);
        }
      },
    }), [navigation]);

    return (
      <View style={{ flex: 1 }} {...panResponder.panHandlers}>
        <WrappedComponent {...props} />
      </View>
    );
  };
}

const SwipedPlayerHomeStack = withTabSwipe(PlayerHomeStack);
const SwipedPlayerInboxStack = withTabSwipe(PlayerInboxStack);
const SwipedPlayerTrainingStack = withTabSwipe(PlayerTrainingStack);
const SwipedPlayerNotifStack = withTabSwipe(PlayerNotifStack);
const SwipedPlayerLinkScreen = withTabSwipe(PlayerLinkScreen);

function PlayerTabs() {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: t.isDark ? '#0C2331' : '#EFE7DA', borderTopColor: t.divider },
        tabBarActiveTintColor: t.positive,
        tabBarInactiveTintColor: t.muted2,
        // Same constraint as the coach tabs: 5 tabs, tiny label, long translations.
        tabBarItemStyle: { flex: 1, flexShrink: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 1 },
        tabBarIconStyle: { marginBottom: -1 },
        tabBarIcon: ({ focused, color }) => {
          const icons: Record<string, [string, string]> = {
            PlayerHomeTab:    ['home',          'home-outline'],
            InboxTab:         ['document-text', 'document-text-outline'],
            TrainingTab:      ['barbell',       'barbell-outline'],
            PlayerNotifsTab:  ['notifications', 'notifications-outline'],
            ProfileTab:       ['person',        'person-outline'],
          };
          const [active, inactive] = icons[route.name] ?? ['grid', 'grid-outline'];
          return <Ionicons name={(focused ? active : inactive) as any} size={22} color={color} />;
        },
      })}
    >
      <Tab.Screen name="PlayerHomeTab"   component={SwipedPlayerHomeStack}     options={{ tabBarLabel: tabLabel(tr('playerApp.tabs.home')) }} />
      <Tab.Screen name="InboxTab"        component={SwipedPlayerInboxStack}    options={{ tabBarLabel: tabLabel(tr('playerApp.tabs.reports')) }} />
      <Tab.Screen name="TrainingTab"     component={SwipedPlayerTrainingStack} options={{ tabBarLabel: tabLabel(tr('playerApp.tabs.training')) }} />
      <Tab.Screen name="PlayerNotifsTab" component={SwipedPlayerNotifStack}    options={{ tabBarLabel: tabLabel(tr('playerApp.tabs.alerts')) }} />
      <Tab.Screen name="ProfileTab"      component={SwipedPlayerLinkScreen}    options={{ tabBarLabel: tabLabel(tr('playerApp.tabs.profile')) }} />
    </Tab.Navigator>
  );
}

// ── Auth stack (unauthenticated) ───────────────────────────────────────────────

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="RoleSelect"     component={RoleSelectScreen} />
      <Stack.Screen name="CoachLogin"     component={LoginScreen} />
      <Stack.Screen name="PlayerLogin"    component={PlayerLoginScreen} />
      <Stack.Screen name="PlayerRegister" component={PlayerRegisterScreen} />
    </Stack.Navigator>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────

function Root() {
  const { coach, loading: coachLoading } = useAuth();
  const { playerUser, loading: playerLoading } = usePlayerAuth();

  const loading = coachLoading || playerLoading;

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      {loading ? (
        <View style={{ flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#2563eb" size="large" />
        </View>
      ) : coach ? (
        coach.onboarded === false ? <OnboardingStack /> : <AppTabs />
      ) : playerUser ? (
        <PlayerTabs />
      ) : (
        <AuthStack />
      )}
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold, HankenGrotesk_800ExtraBold, HankenGrotesk_900Black,
  });
  const [langReady, setLangReady] = React.useState(false);
  React.useEffect(() => { initAppLanguage().finally(() => setLangReady(true)); }, []);

  if (!fontsLoaded || !langReady) {
    return <View style={{ flex: 1, backgroundColor: '#0C2331', alignItems: 'center', justifyContent: 'center' }} />;
  }

  return (
    <ThemeProvider>
      <AuthProvider>
        <PlayerAuthProvider>
          {/* Inside the providers, so "Try again" remounts the navigator while
              the session and theme survive — the coach lands back where they
              were rather than at the login screen. */}
          <ErrorBoundary>
            <Root />
          </ErrorBoundary>
        </PlayerAuthProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
