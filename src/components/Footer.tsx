import React from 'react';
import { Terminal, Shield, Sparkles } from 'lucide-react';
import { Logo } from './Logo';
import { sound } from '../utils/audioFx';

interface FooterProps {
  onOpenSandbox: () => void;
  onOpenAudit: () => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenSandbox, onOpenAudit }) => {
  return (
    <footer className="border-t border-border-subtle bg-surface/40 py-14 relative text-xs text-slate-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-12 border-b border-border-subtle">
          {/* Brand & Mission */}
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-center gap-2.5">
              <Logo size="sm" />
              <span className="font-bold text-slate-100 text-base">
                Decision <span className="text-signal">OS</span>
              </span>
            </div>
            <p className="text-slate-400 text-xs sm:text-sm max-w-sm leading-relaxed">
              A structured decision-support workspace. Turning complex choices into transparent, explainable trade-off models based on your explicit priorities.
            </p>
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 pt-1">
              <Shield className="w-3.5 h-3.5 text-signal" />
              <span>Honest Product Concept · Zero Fabricated Testimonials</span>
            </div>
          </div>

          {/* Navigation */}
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-slate-300 font-semibold mb-3">
              Navigation
            </div>
            <ul className="space-y-2">
              <li>
                <a href="#product" className="hover:text-slate-100 transition-colors">
                  Product Overview
                </a>
              </li>
              <li>
                <a href="#simulator" className="hover:text-slate-100 transition-colors">
                  Interactive Simulator
                </a>
              </li>
              <li>
                <a href="#instruments" className="hover:text-slate-100 transition-colors">
                  Deep Analytical Studio
                </a>
              </li>
              <li>
                <a href="#how-it-works" className="hover:text-slate-100 transition-colors">
                  How It Works
                </a>
              </li>
              <li>
                <a href="#principles" className="hover:text-slate-100 transition-colors">
                  Design Principles
                </a>
              </li>
            </ul>
          </div>

          {/* Interactive Tools & Guides */}
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-slate-300 font-semibold mb-3">
              Actions
            </div>
            <ul className="space-y-2">
              <li>
                <button
                  onClick={() => {
                    sound.playTick();
                    onOpenSandbox();
                  }}
                  className="hover:text-signal transition-colors text-left flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3 h-3 text-signal" />
                  <span>Launch Decision Sandbox</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    sound.playTick();
                    onOpenAudit();
                  }}
                  className="hover:text-signal transition-colors text-left flex items-center gap-1.5 font-mono cursor-pointer"
                >
                  <Terminal className="w-3 h-3 text-signal" />
                  <span>Mathematical Audit (⌘K)</span>
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom copyright & attribution */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-400 font-mono">
          <div>
            © {new Date().getFullYear()} Decision OS. Built for clarity, taste, and explainable engineering.
          </div>
          <div className="flex items-center gap-4">
            <span className="text-slate-400">React + Vite + Tailwind + TypeScript</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
