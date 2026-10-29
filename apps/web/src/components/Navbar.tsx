import React, { useState, useEffect } from 'react';
import { Sparkles, Command, Volume2, VolumeX, User, LogOut } from 'lucide-react';
import { Logo } from './Logo';
import { sound } from '../utils/audioFx';
import { useAuth } from '../hooks/useAuth';

interface NavbarProps {
  onOpenSandbox: () => void;
  onOpenAudit: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenSandbox, onOpenAudit }) => {
  const [scrolled, setScrolled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(sound.isSoundEnabled());
  const { user, isAuthenticated, logout, openAuthModal } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleToggleSound = () => {
    const state = sound.toggleSound();
    setSoundEnabled(state);
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 w-full max-w-full ${
        scrolled
          ? 'bg-background/90 backdrop-blur-md border-b border-border-subtle/80 py-2.5 shadow-glow-card'
          : 'bg-transparent py-3 sm:py-4'
      }`}
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-2">
        {/* Brand Logo in Header Navbar Top Left */}
        <a href="#" className="flex items-center gap-2.5 group shrink-0">
          <Logo size="md" />
          <div className="flex items-center gap-1.5">
            <span className="font-bold tracking-tight text-base sm:text-lg text-slate-100 group-hover:text-white transition-colors">
              Decision <span className="text-signal">OS</span>
            </span>
            <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono font-medium rounded-full bg-signal/10 text-signal border border-signal/20">
              v1.0
            </span>
          </div>
        </a>

        {/* Navigation Links */}
        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-400">
          <a
            href="#product"
            className="hover:text-slate-100 transition-colors duration-200"
          >
            Product
          </a>
          <a
            href="#simulator"
            className="hover:text-slate-100 transition-colors duration-200 flex items-center gap-1.5"
          >
            <span>Interactive Demo</span>
            <span className="w-1.5 h-1.5 rounded-full bg-signal" />
          </a>
          <a
            href="#instruments"
            className="hover:text-slate-100 transition-colors duration-200"
          >
            Deep Studio
          </a>
          <a
            href="#how-it-works"
            className="hover:text-slate-100 transition-colors duration-200"
          >
            How it works
          </a>
          <a
            href="#principles"
            className="hover:text-slate-100 transition-colors duration-200"
          >
            Principles
          </a>
        </nav>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* User Pill / Sign In Trigger */}
          {isAuthenticated && user ? (
            <div className="flex items-center gap-1.5 p-1 pl-2 bg-surface/80 border border-border-subtle rounded-lg text-xs">
              <div className="w-5 h-5 rounded-full bg-signal/20 text-signal font-mono text-[10px] flex items-center justify-center uppercase font-bold">
                {user.name.charAt(0) || 'U'}
              </div>
              <span className="max-w-[70px] sm:max-w-[110px] truncate text-slate-200 font-medium">
                {user.name}
              </span>
              {user.role === 'admin' && (
                <span className="px-1 py-0.5 text-[9px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded">
                  ADMIN
                </span>
              )}
              <button
                onClick={() => logout()}
                className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-surface transition-colors cursor-pointer"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => openAuthModal('login')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-200 hover:text-white bg-surface/70 hover:bg-surface border border-border-subtle hover:border-signal/40 transition-all cursor-pointer shadow-sm"
              title="Sign in to your account"
              aria-label="Sign in"
            >
              <User className="w-3.5 h-3.5 text-signal" />
              <span>Sign In</span>
            </button>
          )}

          {/* Audio Feedback Toggle */}
          <button
            onClick={handleToggleSound}
            className="p-1.5 sm:p-2 rounded-lg bg-surface/60 hover:bg-surface border border-border-subtle hover:border-border text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
            title={soundEnabled ? 'Mute UI sound effects' : 'Enable tactile audio feedback'}
            aria-label="Toggle UI Sound"
          >
            {soundEnabled ? (
              <Volume2 className="w-3.5 h-3.5 text-signal" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-slate-500" />
            )}
          </button>

          {/* Audit Terminal Trigger */}
          <button
            onClick={onOpenAudit}
            className="hidden sm:flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-mono text-slate-400 hover:text-slate-200 bg-surface/60 hover:bg-surface border border-border-subtle hover:border-border transition-all cursor-pointer"
            title="Inspect Mathematical Engine"
            aria-label="Inspect Mathematical Engine"
          >
            <Command className="w-3 h-3 text-slate-400" />
            <span>K</span>
          </button>

          {/* Main CTA */}
          <button
            onClick={onOpenSandbox}
            className="relative group overflow-hidden px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-surface border border-border hover:border-signal/50 text-xs sm:text-sm font-semibold text-slate-100 transition-all duration-300 hover:shadow-glow-signal-sm flex items-center gap-1.5 cursor-pointer"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse" />
            <span className="truncate">Start decision</span>
            <Sparkles className="w-3 h-3 text-signal group-hover:rotate-12 transition-transform hidden sm:inline" />
          </button>
        </div>
      </div>
    </header>
  );
};
