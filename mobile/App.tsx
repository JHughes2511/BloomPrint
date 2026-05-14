import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import LoginScreen from './src/screens/LoginScreen';
import RosterScreen from './src/screens/RosterScreen';
import PlayerProfileScreen from './src/screens/PlayerProfileScreen';
import NewEvalScreen from './src/screens/NewEvalScreen';
import EvalReportScreen from './src/screens/EvalReportScreen';
import TrainingScreen from './src/screens/TrainingScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function RosterStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } }}>
      <Stack.Screen name="Roster" component={RosterScreen} />
      <Stack.Screen name="PlayerProfile" component={PlayerProfileScreen} />
      <Stack.Screen name="NewEval" component={NewEvalScreen} />
      <Stack.Screen name="EvalReport" component={EvalReportScreen} />
      <Stack.Screen name="Training" component={TrainingScreen} />
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
          const icons: Record<string, string> = {
            RosterTab: focused ? 'people' : 'people-outline',
          };
          return <Ionicons name={(icons[route.name] ?? 'grid-outline') as any} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="RosterTab" component={RosterStack} options={{ title: 'Roster' }} />
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
      {coach ? <AppTabs /> : <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Login" component={LoginScreen} /></Stack.Navigator>}
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
