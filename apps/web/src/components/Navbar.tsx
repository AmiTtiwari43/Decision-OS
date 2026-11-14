import React, { useState, useEffect } from 'react';
import { Sparkles, Command, Volume2, VolumeX, User, LogOut, PieChart, Menu, X, LayoutGrid, Compass } from 'lucide-react';
import { Logo } from './Logo';
import { sound } from '../utils/audioFx';
import { useAuth } from '../hooks/useAuth';

interface NavbarProps {
  onOpenSandbox: () => void;
  onOpenAudit: () => void;
  onOpenAnalytics?: () => void;
  activeView?: 'app' | 'marketing';
  onSelectView?: (view: 'app' | 'marketing') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenSandbox,
  onOpenAudit,
  onOpenAnalytics,
  activeView = 'app',
  onSelectView,
}) => {
  const [scrolled, setScrolled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(sound.isSoundEnabled());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, isAuthenticated, logout, openAuthModal } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close mobile menu on Esc key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileMenuOpen) {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileMenuOpen]);

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
        <a
          href="#"
          onClick={(e) => {
            if (isAuthenticated && onSelectView) {
              e.preventDefault();
              onSelectView('app');
            }
          }}
          className="flex items-center gap-2.5 group shrink-0"
        >
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
        {isAuthenticated && onSelectView ? (
          <>
            <nav className="hidden sm:flex items-center gap-1.5 p-1 bg-surface-card border border-border-subtle rounded-xl text-xs font-mono">
              <button
                onClick={() => onSelectView('app')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none ${
                  activeView === 'app'
                    ? 'bg-signal text-background font-bold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                aria-current={activeView === 'app' ? 'page' : undefined}
              >
                Workspace Hub
              </button>
              <button
                onClick={() => onSelectView('marketing')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none ${
                  activeView === 'marketing'
                    ? 'bg-signal text-background font-bold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                aria-current={activeView === 'marketing' ? 'page' : undefined}
              >
                Product Tour
              </button>
            </nav>

            {/* Mobile View Toggle Pill for 390px Screens */}
            <div className="flex sm:hidden items-center p-0.5 bg-surface-card border border-border-subtle rounded-lg text-[11px] font-mono">
              <button
                onClick={() => onSelectView('app')}
                className={`px-2 py-1 rounded transition-all cursor-pointer flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none ${
                  activeView === 'app'
                    ? 'bg-signal text-background font-bold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Switch to Workspace Hub"
                aria-label="Workspace Hub"
              >
                <LayoutGrid className="w-3 h-3" />
                <span>Hub</span>
              </button>
              <button
                onClick={() => onSelectView('marketing')}
                className={`px-2 py-1 rounded transition-all cursor-pointer flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none ${
                  activeView === 'marketing'
                    ? 'bg-signal text-background font-bold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Switch to Product Tour"
                aria-label="Product Tour"
              >
                <Compass className="w-3 h-3" />
                <span>Tour</span>
              </button>
            </div>
          </>
        ) : (
          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-400">
            <a
              href="#product"
              className="hover:text-slate-100 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none rounded px-1"
            >
              Product
            </a>
            <a
              href="#simulator"
              className="hover:text-slate-100 transition-colors duration-200 flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none rounded px-1"
            >
              <span>Interactive Demo</span>
              <span className="w-1.5 h-1.5 rounded-full bg-signal" />
            </a>
            <a
              href="#instruments"
              className="hover:text-slate-100 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none rounded px-1"
            >
              Deep Studio
            </a>
            <a
              href="#governance-showcase"
              className="hover:text-slate-100 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none rounded px-1"
            >
              Governance & Audit
            </a>
            <a
              href="#how-it-works"
              className="hover:text-slate-100 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none rounded px-1"
            >
              How it works
            </a>
            <a
              href="#principles"
              className="hover:text-slate-100 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none rounded px-1"
            >
              Principles
            </a>
          </nav>
        )}

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Workspace Analytics Button */}
          {isAuthenticated && onOpenAnalytics && (
            <button
              onClick={onOpenAnalytics}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-200 hover:text-white bg-surface/70 hover:bg-surface border border-border-subtle hover:border-signal/40 transition-all cursor-pointer shadow-sm focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none"
              title="Open Workspace Analytics"
              aria-label="Open Workspace Analytics"
            >
              <PieChart className="w-3.5 h-3.5 text-signal" />
              <span className="hidden sm:inline">Analytics</span>
            </button>
          )}

          {/* User Pill / Sign In Trigger */}
          {isAuthenticated && user ? (
            <div className="flex items-center gap-1.5 p-1 pl-2 bg-surface/80 border border-border-subtle rounded-lg text-xs">
              <div className="w-5 h-5 rounded-full bg-signal/20 text-signal font-mono text-[10px] flex items-center justify-center uppercase font-bold shrink-0">
                {user.name.charAt(0) || 'U'}
              </div>
              <span className="max-w-[65px] sm:max-w-[110px] truncate text-slate-200 font-medium">
                {user.name}
              </span>
              {user.role === 'admin' && (
                <span className="hidden sm:inline px-1 py-0.5 text-[9px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded">
                  ADMIN
                </span>
              )}
              <button
                onClick={() => logout()}
                className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-surface transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => openAuthModal('login')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-200 hover:text-white bg-surface/70 hover:bg-surface border border-border-subtle hover:border-signal/40 transition-all cursor-pointer shadow-sm focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none"
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
            className="p-1.5 sm:p-2 rounded-lg bg-surface/60 hover:bg-surface border border-border-subtle hover:border-border text-slate-400 hover:text-slate-200 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none"
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
            className="hidden sm:flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-mono text-slate-400 hover:text-slate-200 bg-surface/60 hover:bg-surface border border-border-subtle hover:border-border transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none"
            title="Inspect Mathematical Engine"
            aria-label="Inspect Mathematical Engine"
          >
            <Command className="w-3 h-3 text-slate-400" />
            <span>K</span>
          </button>

          {/* Main CTA */}
          <button
            onClick={onOpenSandbox}
            className="relative group overflow-hidden px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-surface border border-border hover:border-signal/50 text-xs sm:text-sm font-semibold text-slate-100 transition-all duration-300 hover:shadow-glow-signal-sm flex items-center gap-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse" />
            <span className="truncate">Start decision</span>
            <Sparkles className="w-3 h-3 text-signal group-hover:rotate-12 transition-transform hidden sm:inline" />
          </button>

          {/* Mobile Menu Hamburger for Public Marketing Links */}
          {(!isAuthenticated || activeView === 'marketing') && (
            <button
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
              className="p-1.5 rounded-lg lg:hidden bg-surface/60 hover:bg-surface border border-border-subtle text-slate-400 hover:text-white transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none"
              title="Toggle mobile menu"
              aria-label="Toggle mobile menu"
              aria-expanded={isMobileMenuOpen}
            >
              {isMobileMenuOpen ? <X className="w-4 h-4 text-signal" /> : <Menu className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile Drawer Navigation for Tour/Marketing */}
      {isMobileMenuOpen && (!isAuthenticated || activeView === 'marketing') && (
        <div className="lg:hidden bg-surface/95 border-b border-border-subtle backdrop-blur-md px-4 py-3 space-y-2 text-xs font-medium animate-in fade-in slide-in-from-top-2">
          <a
            href="#product"
            onClick={() => setIsMobileMenuOpen(false)}
            className="block py-1.5 px-2 rounded-lg text-slate-300 hover:text-white hover:bg-surface-subtle"
          >
            Product Overview
          </a>
          <a
            href="#simulator"
            onClick={() => setIsMobileMenuOpen(false)}
            className="block py-1.5 px-2 rounded-lg text-slate-300 hover:text-white hover:bg-surface-subtle flex items-center justify-between"
          >
            <span>Interactive Demo</span>
            <span className="w-1.5 h-1.5 rounded-full bg-signal" />
          </a>
          <a
            href="#instruments"
            onClick={() => setIsMobileMenuOpen(false)}
            className="block py-1.5 px-2 rounded-lg text-slate-300 hover:text-white hover:bg-surface-subtle"
          >
            Deep Studio
          </a>
          <a
            href="#governance-showcase"
            onClick={() => setIsMobileMenuOpen(false)}
            className="block py-1.5 px-2 rounded-lg text-slate-300 hover:text-white hover:bg-surface-subtle"
          >
            Governance & Cryptographic Audit
          </a>
          <a
            href="#how-it-works"
            onClick={() => setIsMobileMenuOpen(false)}
            className="block py-1.5 px-2 rounded-lg text-slate-300 hover:text-white hover:bg-surface-subtle"
          >
            How it works
          </a>
          <a
            href="#principles"
            onClick={() => setIsMobileMenuOpen(false)}
            className="block py-1.5 px-2 rounded-lg text-slate-300 hover:text-white hover:bg-surface-subtle"
          >
            Principles
          </a>
          <button
            onClick={() => {
              setIsMobileMenuOpen(false);
              onOpenAudit();
            }}
            className="w-full text-left py-1.5 px-2 rounded-lg text-signal font-mono flex items-center gap-1.5 hover:bg-surface-subtle"
          >
            <Command className="w-3.5 h-3.5" />
            <span>Open Mathematical Audit</span>
          </button>
        </div>
      )}
    </header>
  );
};
