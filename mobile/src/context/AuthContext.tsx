import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { authAPI } from '../api/client';
import { Coach } from '../types';

interface AuthState {
  coach: Coach | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { name: string; email: string; password: string; weight?: number; program_name?: string; role?: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [coach, setCoach] = useState<Coach | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const stored = await SecureStore.getItemAsync('auth_token');
      if (stored) {
        setToken(stored);
        try {
          const me = await authAPI.me();
          setCoach(me);
        } catch {
          await SecureStore.deleteItemAsync('auth_token');
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await authAPI.login(email, password);
    await SecureStore.setItemAsync('auth_token', res.access_token);
    setToken(res.access_token);
    setCoach(res.coach);
  };

  const register = async (data: Parameters<typeof authAPI.register>[0]) => {
    const res = await authAPI.register(data);
    await SecureStore.setItemAsync('auth_token', res.access_token);
    setToken(res.access_token);
    setCoach(res.coach);
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync('auth_token');
    setToken(null);
    setCoach(null);
  };

  return (
    <AuthContext.Provider value={{ coach, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
};
