import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { playerAuthAPI } from '../api/playerClient';
import { PlayerUser } from '../types';

interface PlayerAuthState {
  playerUser: PlayerUser | null;
  playerToken: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { name: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const PlayerAuthContext = createContext<PlayerAuthState | null>(null);

export function PlayerAuthProvider({ children }: { children: React.ReactNode }) {
  const [playerUser, setPlayerUser] = useState<PlayerUser | null>(null);
  const [playerToken, setPlayerToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const stored = await SecureStore.getItemAsync('player_auth_token');
      if (stored) {
        setPlayerToken(stored);
        try {
          const me = await playerAuthAPI.me();
          setPlayerUser(me);
        } catch {
          await SecureStore.deleteItemAsync('player_auth_token');
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await playerAuthAPI.login(email, password);
    await SecureStore.setItemAsync('player_auth_token', res.access_token);
    setPlayerToken(res.access_token);
    setPlayerUser(res.player_user);
  };

  const register = async (data: { name: string; email: string; password: string }) => {
    const res = await playerAuthAPI.register(data);
    await SecureStore.setItemAsync('player_auth_token', res.access_token);
    setPlayerToken(res.access_token);
    setPlayerUser(res.player_user);
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync('player_auth_token');
    setPlayerToken(null);
    setPlayerUser(null);
  };

  const refreshUser = async () => {
    try {
      const me = await playerAuthAPI.me();
      setPlayerUser(me);
    } catch {}
  };

  return (
    <PlayerAuthContext.Provider value={{ playerUser, playerToken, loading, login, register, logout, refreshUser }}>
      {children}
    </PlayerAuthContext.Provider>
  );
}

export const usePlayerAuth = () => {
  const ctx = useContext(PlayerAuthContext);
  if (!ctx) throw new Error('usePlayerAuth must be inside PlayerAuthProvider');
  return ctx;
};
