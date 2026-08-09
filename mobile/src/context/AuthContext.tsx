import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from '../storage/secureStore';
import { clearPages } from '../storage/pageCache';
import { setAppLanguage } from '../i18n';
import { authAPI } from '../api/client';
import { isAuthRejection, onCoachUnauthorized } from '../api/authFailure';
import { Coach } from '../types';

interface AuthState {
  coach: Coach | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { name: string; email: string; password: string; weight?: number; program_name?: string; role?: string; competition_level?: string; conference?: string; country?: string; city?: string }) => Promise<void>;
  updateProfile: (data: { name?: string; email?: string; role?: string; job_title?: string; program_name?: string; competition_level?: string; conference?: string; system_profile?: Record<string, string>; country?: string; city?: string; onboarded?: boolean }) => Promise<void>;
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
          adoptLanguage(me);
        } catch (e) {
          // Only a rejected token justifies signing the coach out. A backend
          // that's asleep or a dropped connection says nothing about whether
          // the token is still good, and throwing it away there means the app
          // demands a fresh login every time the network hiccups.
          if (isAuthRejection(e)) {
            await SecureStore.deleteItemAsync('auth_token');
            setToken(null);
          }
        }
      }
      setLoading(false);
    })();
  }, []);

  // Any request can hit a rejected token, not just the one at startup. Clearing
  // state here sends the app back to login once, instead of leaving whatever
  // screen is open failing silently against a token the server won't accept.
  useEffect(() => onCoachUnauthorized(() => {
    SecureStore.deleteItemAsync('auth_token').catch(() => {});
    setToken(null);
    setCoach(null);
  }), []);


  // The account's saved language wins once signed in: switch the UI to it so a
  // coach gets their own language on any device they log into.
  const adoptLanguage = (c: any) => {
    const lang = c?.preferred_language;
    if (lang) setAppLanguage(lang).catch(() => {});
  };

  const login = async (email: string, password: string) => {
    const res = await authAPI.login(email, password);
    await SecureStore.setItemAsync('auth_token', res.access_token);
    setToken(res.access_token);
    setCoach(res.coach);
    adoptLanguage(res.coach);
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
    adoptLanguage(coachData);
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync('auth_token');
    // Cached pages belong to the account that fetched them. Left behind, the
    // next person to sign in on this device would open the app to somebody
    // else's roster for the moment before the server answered.
    await clearPages();
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
