import React, { useState } from 'react';
import { X, Lock, Mail, User, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';

export const AuthModal: React.FC = () => {
  const {
    isAuthModalOpen,
    authModalMode,
    closeAuthModal,
    setAuthModalMode,
    login,
    register,
    isLoading,
    error,
    clearError,
  } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!isAuthModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    clearError();

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setValidationError('Please enter your email address.');
      return;
    }
    if (!password) {
      setValidationError('Please enter your password.');
      return;
    }

    if (authModalMode === 'register') {
      const trimmedName = name.trim();
      if (!trimmedName) {
        setValidationError('Please enter your name.');
        return;
      }
      if (password.length < 8) {
        setValidationError('Password must be at least 8 characters long.');
        return;
      }

      try {
        await register({ email: trimmedEmail, password, name: trimmedName });
        setEmail('');
        setPassword('');
        setName('');
      } catch {
        // Error state handled by AuthContext
      }
    } else {
      try {
        await login({ email: trimmedEmail, password });
        setEmail('');
        setPassword('');
      } catch {
        // Error state handled by AuthContext
      }
    }
  };

  const handleTabChange = (mode: 'login' | 'register') => {
    setAuthModalMode(mode);
    setValidationError(null);
    clearError();
  };

  const activeError = validationError || error;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="relative w-full max-w-md bg-surface border border-border/80 rounded-2xl shadow-glow-card overflow-hidden">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border-subtle/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-signal/10 border border-signal/30 flex items-center justify-center text-signal">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 id="auth-modal-title" className="text-base font-semibold text-slate-100">
                {authModalMode === 'login' ? 'Sign in to Decision OS' : 'Create an Account'}
              </h2>
              <p className="text-xs text-slate-400">
                Authoritative multi-criteria decision infrastructure
              </p>
            </div>
          </div>
          <button
            onClick={closeAuthModal}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-surface-highlight transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switch Tabs */}
        <div className="flex border-b border-border-subtle/60 bg-surface/50 p-1">
          <button
            type="button"
            onClick={() => handleTabChange('login')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              authModalMode === 'login'
                ? 'bg-surface text-signal shadow-sm border border-border/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('register')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              authModalMode === 'register'
                ? 'bg-surface text-signal shadow-sm border border-border/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {activeError && (
            <div
              className="flex items-start gap-2.5 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <span>{activeError}</span>
            </div>
          )}

          {authModalMode === 'register' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jane Doe"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-surface-subtle/80 border border-border-subtle rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-signal/50 focus:ring-1 focus:ring-signal/30"
                  required={authModalMode === 'register'}
                  autoFocus
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                <Mail className="w-4 h-4" />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                className="w-full pl-9 pr-3 py-2 text-sm bg-surface-subtle/80 border border-border-subtle rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-signal/50 focus:ring-1 focus:ring-signal/30"
                required
                autoFocus={authModalMode === 'login'}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                <Lock className="w-4 h-4" />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-9 pr-3 py-2 text-sm bg-surface-subtle/80 border border-border-subtle rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-signal/50 focus:ring-1 focus:ring-signal/30"
                required
              />
            </div>
            {authModalMode === 'register' && (
              <p className="text-[11px] text-slate-500 mt-1">
                Must be at least 8 characters long.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-2.5 px-4 rounded-lg bg-signal hover:bg-signal-hover text-slate-950 font-semibold text-sm transition-all shadow-glow-signal-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <span>{authModalMode === 'login' ? 'Sign In' : 'Create Account'}</span>
            )}
          </button>

          {/* Presentation Quick-Fill Demo Credentials */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => {
                setEmail('lead@decision-os.org');
                setPassword('DecisionOS@2026');
                setName('Lead Decision Architect');
              }}
              className="w-full py-1.5 px-3 rounded-lg bg-surface border border-dashed border-border-subtle hover:border-signal/50 text-slate-400 hover:text-signal text-[11px] font-mono transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>⚡ Fill Presentation Demo Credentials</span>
            </button>
          </div>
        </form>

        {/* Footer info note */}
        <div className="px-6 py-3 bg-surface/40 border-t border-border-subtle/60 text-center">
          <p className="text-[11px] text-slate-500">
            {authModalMode === 'login' ? (
              <>
                Need an account?{' '}
                <button
                  type="button"
                  onClick={() => handleTabChange('register')}
                  className="text-signal hover:underline cursor-pointer font-medium"
                >
                  Create one now
                </button>
              </>
            ) : (
              <>
                Already registered?{' '}
                <button
                  type="button"
                  onClick={() => handleTabChange('login')}
                  className="text-signal hover:underline cursor-pointer font-medium"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
};
