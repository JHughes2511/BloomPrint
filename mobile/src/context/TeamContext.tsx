/**
 * Which team the coach is currently working with, for the whole app.
 *
 * The team filter used to be local state inside Roster, which meant picking a
 * team there and then opening Recent showed you everything again. A coach works
 * with one team at a time, so the choice belongs above the screens rather than
 * inside one of them — and a switcher in the sidebar has to mean something
 * everywhere, or it's promising a scope it doesn't have.
 *
 * null means "all teams", which stays an explicit choice rather than a state
 * you fall into when nothing is selected.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as Store from '../storage/secureStore';
import { teamsAPI } from '../api/client';
import { Team } from '../types';

const STORE_KEY = 'current_team_id';

type TeamContextValue = {
  teams: Team[];
  currentTeamId: number | null;
  currentTeam: Team | null;
  setCurrentTeamId: (id: number | null) => void;
  /** Re-fetch after a team is created, renamed or deleted. */
  reloadTeams: () => Promise<void>;
  loading: boolean;
};

const TeamContext = createContext<TeamContextValue | undefined>(undefined);

export function TeamProvider({ children }: { children: React.ReactNode }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [currentTeamId, setId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadTeams = useCallback(async () => {
    try {
      const list = await teamsAPI.list();
      setTeams(list);
      // A remembered team that no longer exists (deleted, or the coach signed
      // in as someone else) would filter every screen to nothing with no
      // obvious cause. Fall back to all teams instead.
      setId(prev => (prev != null && !list.some((t: Team) => t.id === prev) ? null : prev));
    } catch {
      // Offline or unauthenticated — leave whatever we have rather than
      // clearing the coach's selection.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const stored = await Store.getItemAsync(STORE_KEY);
        if (stored) setId(stored === 'all' ? null : Number(stored));
      } catch {}
      await reloadTeams();
    })();
  }, [reloadTeams]);

  const setCurrentTeamId = useCallback((id: number | null) => {
    setId(id);
    Store.setItemAsync(STORE_KEY, id == null ? 'all' : String(id)).catch(() => {});
  }, []);

  const currentTeam = teams.find(t => t.id === currentTeamId) ?? null;

  return (
    <TeamContext.Provider
      value={{ teams, currentTeamId, currentTeam, setCurrentTeamId, reloadTeams, loading }}
    >
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam(): TeamContextValue {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error('useTeam must be used inside a TeamProvider');
  return ctx;
}
