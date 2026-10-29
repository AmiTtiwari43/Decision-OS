import React, { useState, useCallback, useMemo } from 'react';
import { apiClient } from '../api/client.js';
import type { UserDto, LoginPayload, RegisterPayload } from '../api/types.js';
import { AuthContext, type AuthContextValue } from './authContextDef.js';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserDto | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');

  const openAuthModal = useCallback((mode: 'login' | 'register' = 'login') => {
    setAuthModalMode(mode);
    setError(null);
    setIsAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const login = useCallback(async (payload: LoginPayload): Promise<UserDto> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.login(payload);
      setUser(res.user);
      setTokenState(res.token);
      setIsAuthModalOpen(false);
      return res.user;
    } catch (err: unknown) {
      const msg = (err as Error)?.message || 'Authentication failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (payload: RegisterPayload): Promise<UserDto> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.register(payload);
      setUser(res.user);
      setTokenState(res.token);
      setIsAuthModalOpen(false);
      return res.user;
    } catch (err: unknown) {
      const msg = (err as Error)?.message || 'Registration failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      await apiClient.logout();
    } catch {
      // Clean up local auth state even if server logout errored
    } finally {
      setUser(null);
      setTokenState(null);
      setIsLoading(false);
      setError(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    token,
    isAuthenticated: !!user && !!token,
    isLoading,
    error,
    isAuthModalOpen,
    authModalMode,
    login,
    register,
    logout,
    openAuthModal,
    closeAuthModal,
    setAuthModalMode,
    clearError,
  }), [
    user,
    token,
    isLoading,
    error,
    isAuthModalOpen,
    authModalMode,
    login,
    register,
    logout,
    openAuthModal,
    closeAuthModal,
    clearError,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
