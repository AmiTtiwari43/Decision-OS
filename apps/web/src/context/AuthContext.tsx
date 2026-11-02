import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiClient, ApiClientError } from '../api/client.js';
import type { UserDto, LoginPayload, RegisterPayload } from '../api/types.js';
import { AuthContext, type AuthContextValue } from './authContextDef.js';
import { getStoredToken, setStoredToken } from './authStorage.js';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserDto | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');

  const sessionGenRef = useRef(0);
  const inFlightInitRef = useRef<Promise<void> | null>(null);

  const initSession = useCallback(async (isRetry = false): Promise<void> => {
    // Deduplicate concurrent calls unless explicitly forced as a retry
    if (inFlightInitRef.current && !isRetry) {
      return inFlightInitRef.current;
    }

    const currentGen = ++sessionGenRef.current;
    if (isRetry) {
      setIsInitializing(true);
      setSessionError(null);
    }

    const initPromise = (async () => {
      const stored = getStoredToken();
      if (!stored) {
        if (currentGen === sessionGenRef.current) {
          setIsInitializing(false);
          setSessionError(null);
        }
        return;
      }

      apiClient.setToken(stored);
      try {
        const res = await apiClient.getCurrentUser();
        // Discard result if newer action/generation has started
        if (currentGen === sessionGenRef.current) {
          setUser(res.user);
          setTokenState(stored);
          setSessionError(null);
        }
      } catch (err: unknown) {
        // Discard result if newer action/generation has started
        if (currentGen !== sessionGenRef.current) {
          return;
        }

        const isExplicit401 = err instanceof ApiClientError && err.statusCode === 401;

        if (isExplicit401) {
          // Token is cryptographically invalid, expired, or revoked by server
          apiClient.setToken(null);
          setStoredToken(null);
          setUser(null);
          setTokenState(null);
          setSessionError(null);
        } else {
          // Transient failure: Network offline, timeout, DNS failure, 5xx server error, or unknown error.
          // DO NOT delete stored token from localStorage.
          // DO NOT authenticate user without server verification.
          setUser(null);
          setTokenState(null);

          let errMsg = 'Backend service is temporarily unreachable. Your session has been safely preserved.';
          if (err instanceof ApiClientError) {
            if (err.isNetworkError || err.statusCode === 0) {
              errMsg = 'Backend service is unreachable (network offline). Your session has been preserved.';
            } else if (err.statusCode >= 500) {
              errMsg = `Backend service error (HTTP ${err.statusCode}). Your session has been preserved.`;
            } else if (err.message) {
              errMsg = `${err.message} Your session has been preserved.`;
            }
          } else if ((err as Error)?.message) {
            errMsg = `${(err as Error).message}. Your session has been preserved.`;
          }

          setSessionError(errMsg);
        }
      } finally {
        if (currentGen === sessionGenRef.current) {
          setIsInitializing(false);
        }
        inFlightInitRef.current = null;
      }
    })();

    inFlightInitRef.current = initPromise;
    return initPromise;
  }, []);

  useEffect(() => {
    let isMounted = true;
    const sessionGen = sessionGenRef;
    const inFlightInit = inFlightInitRef;

    // Register 401 callback so invalid/expired token immediately invalidates state and storage
    apiClient.setOnUnauthorized(() => {
      if (isMounted) {
        sessionGen.current++;
        inFlightInit.current = null;
        setUser(null);
        setTokenState(null);
        setStoredToken(null);
        setSessionError(null);
      }
    });

    initSession();

    return () => {
      isMounted = false;
      sessionGen.current++;
      inFlightInit.current = null;
      apiClient.setOnUnauthorized(undefined);
    };
  }, [initSession]);

  const retrySession = useCallback(async (): Promise<void> => {
    return initSession(true);
  }, [initSession]);

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
    setSessionError(null);
  }, []);

  const login = useCallback(async (payload: LoginPayload): Promise<UserDto> => {
    sessionGenRef.current++;
    inFlightInitRef.current = null;
    setIsLoading(true);
    setError(null);
    setSessionError(null);
    try {
      const res = await apiClient.login(payload);
      setUser(res.user);
      setTokenState(res.token);
      setStoredToken(res.token);
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
    sessionGenRef.current++;
    inFlightInitRef.current = null;
    setIsLoading(true);
    setError(null);
    setSessionError(null);
    try {
      const res = await apiClient.register(payload);
      setUser(res.user);
      setTokenState(res.token);
      setStoredToken(res.token);
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
    sessionGenRef.current++;
    inFlightInitRef.current = null;
    setIsLoading(true);
    try {
      await apiClient.logout();
    } catch {
      // Clean up local auth state even if server logout errored
    } finally {
      setStoredToken(null);
      apiClient.setToken(null);
      setUser(null);
      setTokenState(null);
      setSessionError(null);
      setIsLoading(false);
      setError(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    token,
    isAuthenticated: !!user && !!token,
    isLoading,
    isInitializing,
    sessionError,
    error,
    isAuthModalOpen,
    authModalMode,
    login,
    register,
    logout,
    retrySession,
    openAuthModal,
    closeAuthModal,
    setAuthModalMode,
    clearError,
  }), [
    user,
    token,
    isLoading,
    isInitializing,
    sessionError,
    error,
    isAuthModalOpen,
    authModalMode,
    login,
    register,
    logout,
    retrySession,
    openAuthModal,
    closeAuthModal,
    clearError,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
