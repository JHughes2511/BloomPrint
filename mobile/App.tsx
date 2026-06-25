import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, PanResponder } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { PlayerAuthProvider, usePlayerAuth } from './src/context/PlayerAuthContext';

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
import PlayerNotificationsScreen from './src/screens/player/PlayerNotificationsScreen';
import PlayerTeamReportDetailScreen from './src/screens/player/PlayerTeamReportDetailScreen';
import PlayerLinkScreen from './src/screens/player/PlayerLinkScreen';

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
      <Stack.Screen name="GameReportBuilder" component={GameReportBuilderScreen} />
      <Stack.Screen name="StaffInbox" component={StaffInboxScreen} />
    </Stack.Navigator>
  );
}

function AppTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: '#111827', borderTopColor: '#1f2937', paddingTop: 6 },
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#6b7280',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', marginTop: 4, textAlign: 'center', includeFontPadding: false },
        tabBarItemStyle: { flex: 1, paddingHorizontal: 2, paddingVertical: 4 },
        tabBarIconStyle: { marginBottom: 0 },
        tabBarIcon: ({ focused, color }) => {
          const icons: Record<string, [string, string]> = {
            HomeTab:     ['home',        'home-outline'],
            TeamTab:     ['people',      'people-outline'],
            TeamEvalTab: ['stats-chart', 'stats-chart-outline'],
            RosterTab:   ['list',        'list-outline'],
            RecentTab:   ['time',        'time-outline'],
          };
          const [active, inactive] = icons[route.name] ?? ['grid', 'grid-outline'];
          return <Ionicons name={(focused ? active : inactive) as any} size={24} color={color} />;
        },
      })}
    >
      <Tab.Screen name="HomeTab"     component={HomeStack}     options={{ title: 'Home' }} />
      <Tab.Screen name="TeamTab"     component={TeamStack}     options={{ title: 'Team Eval' }} />
      <Tab.Screen name="TeamEvalTab" component={TeamEvalStack} options={{ title: 'Team Grade' }} />
      <Tab.Screen name="RosterTab"   component={RosterStack}   options={{ title: 'Roster' }} />
      <Tab.Screen name="RecentTab"   component={RecentStack}   options={{ title: 'Recent' }} />
    </Tab.Navigator>
  );
}

// ── Player navigation ──────────────────────────────────────────────────────────

function PlayerHomeStack() {
  return (
    <Stack.Navigator screenOptions={PLAYER_SCREEN_OPTIONS}>
      <Stack.Screen name="PlayerHome" component={PlayerHomeScreen} />
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
    </Stack.Navigator>
  );
}

function PlayerTrainingStack() {
  return (
    <Stack.Navigator screenOptions={PLAYER_SCREEN_OPTIONS}>
      <Stack.Screen name="PlayerTraining" component={PlayerTrainingScreen} />
      <Stack.Screen name="PlayerTrainingDetail" component={PlayerTrainingDetailScreen} />
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
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: '#1a2e1a', borderTopColor: '#2d4a2d' },
        tabBarActiveTintColor: '#16a34a',
        tabBarInactiveTintColor: '#4b7a4b',
        tabBarIcon: ({ focused, color, size }) => {
          const icons: Record<string, [string, string]> = {
            PlayerHomeTab:    ['home',          'home-outline'],
            InboxTab:         ['mail',          'mail-outline'],
            TrainingTab:      ['barbell',       'barbell-outline'],
            PlayerNotifsTab:  ['notifications', 'notifications-outline'],
            ProfileTab:       ['person',        'person-outline'],
          };
          const [active, inactive] = icons[route.name] ?? ['grid', 'grid-outline'];
          return <Ionicons name={(focused ? active : inactive) as any} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="PlayerHomeTab"   component={SwipedPlayerHomeStack}     options={{ title: 'Home' }} />
      <Tab.Screen name="InboxTab"        component={SwipedPlayerInboxStack}    options={{ title: 'Reports' }} />
      <Tab.Screen name="TrainingTab"     component={SwipedPlayerTrainingStack} options={{ title: 'Training' }} />
      <Tab.Screen name="PlayerNotifsTab" component={SwipedPlayerNotifStack}    options={{ title: 'Alerts' }} />
      <Tab.Screen name="ProfileTab"      component={SwipedPlayerLinkScreen}    options={{ title: 'Profile' }} />
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
        <AppTabs />
      ) : playerUser ? (
        <PlayerTabs />
      ) : (
        <AuthStack />
      )}
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <PlayerAuthProvider>
        <Root />
      </PlayerAuthProvider>
    </AuthProvider>
  );
}
