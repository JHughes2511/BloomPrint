import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { authAPI } from '../api/client';
import { Coach } from '../types';

interface AuthState {
  coach: Coach | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { name: string; email: string; password: string; weight?: number; program_name?: string; role?: string; competition_level?: string; conference?: string; country?: string; city?: string }) => Promise<void>;
  updateProfile: (data: { name?: string; email?: string; role?: string; program_name?: string; competition_level?: string; conference?: string; system_profile?: Record<string, string>; country?: string; city?: string; onboarded?: boolean }) => Promise<void>;
  importPhilosophy: (formData: FormData) => Promise<Coach>;
  applyAuth: (accessToken: string, coachData: Coach) => Promise<void>;
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

  const updateProfile = async (data: Parameters<typeof authAPI.updateProfile>[0]) => {
    const updated = await authAPI.updateProfile(data);
    setCoach(updated);
  };

  const importPhilosophy = async (formData: FormData) => {
    const updated = await authAPI.importPhilosophy(formData);
    setCoach(updated);
    return updated;
  };

  const applyAuth = async (accessToken: string, coachData: Coach) => {
    await SecureStore.setItemAsync('auth_token', accessToken);
    setToken(accessToken);
    setCoach(coachData);
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync('auth_token');
    setToken(null);
    setCoach(null);
  };

  return (
    <AuthContext.Provider value={{ coach, token, loading, login, register, updateProfile, importPhilosophy, applyAuth, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
};
