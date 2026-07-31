import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from '../storage/secureStore';
import { playerAuthAPI } from '../api/playerClient';
import { isAuthRejection, onPlayerUnauthorized } from '../api/authFailure';
import { PlayerUser } from '../types';

interface PlayerAuthState {
  playerUser: PlayerUser | null;
  playerToken: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { name: string; email: string; password: string; country?: string; city?: string }) => Promise<void>;
  applyAuth: (accessToken: string, user: PlayerUser) => Promise<void>;
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
        } catch (e) {
          // Same rule as the coach side: sign out only when the server actually
          // rejected the token, never because the request couldn't complete.
          if (isAuthRejection(e)) {
            await SecureStore.deleteItemAsync('player_auth_token');
            setPlayerToken(null);
          }
        }
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => onPlayerUnauthorized(() => {
    SecureStore.deleteItemAsync('player_auth_token').catch(() => {});
    setPlayerToken(null);
    setPlayerUser(null);
  }), []);

  const login = async (email: string, password: string) => {
    const res = await playerAuthAPI.login(email, password);
    await SecureStore.setItemAsync('player_auth_token', res.access_token);
    setPlayerToken(res.access_token);
    setPlayerUser(res.player_user);
  };

  const register = async (data: { name: string; email: string; password: string; country?: string; city?: string }) => {
    const res = await playerAuthAPI.register(data);
    await SecureStore.setItemAsync('player_auth_token', res.access_token);
    setPlayerToken(res.access_token);
    setPlayerUser(res.player_user);
  };

  const applyAuth = async (accessToken: string, user: PlayerUser) => {
    await SecureStore.setItemAsync('player_auth_token', accessToken);
    setPlayerToken(accessToken);
    setPlayerUser(user);
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
    <PlayerAuthContext.Provider value={{ playerUser, playerToken, loading, login, register, applyAuth, logout, refreshUser }}>
      {children}
    </PlayerAuthContext.Provider>
  );
}

export const usePlayerAuth = () => {
  const ctx = useContext(PlayerAuthContext);
  if (!ctx) throw new Error('usePlayerAuth must be inside PlayerAuthProvider');
  return ctx;
};
