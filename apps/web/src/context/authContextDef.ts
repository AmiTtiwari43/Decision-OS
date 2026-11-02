import { createContext } from 'react';
import type { UserDto, LoginPayload, RegisterPayload } from '../api/types.js';

export interface AuthContextValue {
  user: UserDto | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitializing: boolean;
  sessionError: string | null;
  error: string | null;
  isAuthModalOpen: boolean;
  authModalMode: 'login' | 'register';
  login: (payload: LoginPayload) => Promise<UserDto>;
  register: (payload: RegisterPayload) => Promise<UserDto>;
  logout: () => Promise<void>;
  retrySession: () => Promise<void>;
  openAuthModal: (mode?: 'login' | 'register') => void;
  closeAuthModal: () => void;
  setAuthModalMode: (mode: 'login' | 'register') => void;
  clearError: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
