import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';

import { AuthProvider, useAuth } from './src/context/AuthContext';
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

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const SCREEN_OPTIONS = { headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } };

function HomeStack() {
  return (
    <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
      <Stack.Screen name="Home" component={HomeScreen} />
    </Stack.Navigator>
  );
}

function TeamStack() {
  return (
    <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
      <Stack.Screen name="Team" component={TeamReportScreen} />
      <Stack.Screen name="Summary" component={SummaryScreen} />
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
    </Stack.Navigator>
  );
}

function AppTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: '#111827', borderTopColor: '#1f2937' },
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#6b7280',
        tabBarIcon: ({ focused, color, size }) => {
          const icons: Record<string, [string, string]> = {
            HomeTab:   ['home',   'home-outline'],
            TeamTab:   ['people', 'people-outline'],
            RosterTab: ['list',   'list-outline'],
            RecentTab: ['time',   'time-outline'],
          };
          const [active, inactive] = icons[route.name] ?? ['grid', 'grid-outline'];
          return <Ionicons name={(focused ? active : inactive) as any} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="HomeTab"   component={HomeStack}   options={{ title: 'Home' }} />
      <Tab.Screen name="TeamTab"   component={TeamStack}   options={{ title: 'Team' }} />
      <Tab.Screen name="RosterTab" component={RosterStack} options={{ title: 'Roster' }} />
      <Tab.Screen name="RecentTab" component={RecentStack} options={{ title: 'Recent' }} />
    </Tab.Navigator>
  );
}

function Root() {
  const { coach, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#2563eb" size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      {coach
        ? <AppTabs />
        : <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Login" component={LoginScreen} />
          </Stack.Navigator>
      }
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
