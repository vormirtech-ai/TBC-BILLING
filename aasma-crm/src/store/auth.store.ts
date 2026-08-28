import { create } from 'zustand';
import { api, setToken } from '@/lib/api';
import type { AuthUser, LoginResponse } from '@shared/types';

interface AuthState {
  user: AuthUser | null;
  status: 'unknown' | 'authenticated' | 'anonymous';
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  restore: () => Promise<void>;
}

/** Session state. The token itself lives in localStorage, handled by lib/api. */
export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: 'unknown',

  login: async (username, password) => {
    const result = await api.post<LoginResponse>('/auth/login', { username, password });
    setToken(result.token);
    set({ user: result.user, status: 'authenticated' });
  },

  logout: () => {
    setToken(null);
    set({ user: null, status: 'anonymous' });
  },

  restore: async () => {
    try {
      const user = await api.get<AuthUser>('/auth/me');
      set({ user, status: 'authenticated' });
    } catch {
      set({ user: null, status: 'anonymous' });
    }
  },
}));
