import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Sliders,
  Sparkles,
  Award,
  ChevronRight,
  MousePointerClick,
  CheckCircle2,
} from 'lucide-react';
import { sound } from '../utils/audioFx';

interface HeroProps {
  onOpenSandbox: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onOpenSandbox }) => {
  const [activePriority, setActivePriority] = useState<'career' | 'comp' | 'wlb'>('career');

  const handlePrioritySelect = (p: 'career' | 'comp' | 'wlb') => {
    setActivePriority(p);
    sound.playScenarioChime(p === 'comp');
  };

  const scores = {
    career: { alpha: 84, beta: 78, gamma: 73, lead: '+6.0', winner: 'Alpha' },
    comp: { alpha: 79, beta: 84, gamma: 75, lead: '+5.0', winner: 'Beta' },
    wlb: { alpha: 76, beta: 82, gamma: 86, lead: '+4.0', winner: 'Gamma' },
  };

  const active = scores[activePriority];

  return (
    <section id="product" className="relative pt-28 pb-16 md:pt-36 md:pb-24 overflow-hidden w-full max-w-full">
      {/* Background ambient lighting and subtle grid */}
      <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[450px] bg-radial-fade pointer-events-none" />
      <div className="absolute top-20 left-1/4 w-96 h-96 bg-signal/5 blur-[120px] rounded-full pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center max-w-3xl mx-auto">
          {/* Subtle Tagline Badge */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-subtle border border-border text-xs font-medium text-slate-300 mb-6 shadow-sm"
          >
            <span className="w-2 h-2 rounded-full bg-signal shadow-[0_0_8px_#B8FF5A]" />
            <span className="text-slate-400">Structured Decision Support</span>
            <span className="text-slate-600">/</span>
            <span className="text-signal font-mono">Zero Black-Box AI</span>
          </motion.div>

          {/* Primary Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white leading-[1.08]"
          >
            Make decisions you can <span className="text-transparent bg-clip-text bg-gradient-to-r from-signal via-signal-light to-white">explain.</span>
          </motion.h1>

          {/* Supporting Copy */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-6 text-base sm:text-lg lg:text-xl text-slate-300 max-w-2xl mx-auto font-normal leading-relaxed"
          >
            Decision OS turns complex choices into clear, transparent decisions based on what actually matters to you.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <button
              onClick={() => {
                sound.playTick();
                onOpenSandbox();
              }}
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-signal hover:bg-signal-light text-background font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition-all duration-200 shadow-glow-signal hover:shadow-glow-signal transform hover:-translate-y-0.5"
            >
              <MousePointerClick className="w-4 h-4 text-background" />
              <span>Click to start a decision</span>
              <ArrowRight className="w-4 h-4 text-background" />
            </button>

            <a
              href="#simulator"
              onClick={() => sound.playTick()}
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-surface hover:bg-surface-hover text-slate-200 hover:text-white font-semibold text-sm sm:text-base border border-border hover:border-slate-600 flex items-center justify-center gap-2 transition-all duration-200"
            >
              <span>Explore Interactive Demo</span>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </a>
          </motion.div>
        </div>

        {/* HERO PRODUCT COMMAND CONSOLE */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-12 sm:mt-16 max-w-5xl mx-auto"
        >
          <div className="relative rounded-3xl bg-gradient-to-b from-surface-card via-surface to-background p-1 shadow-2xl border border-border/80 ring-1 ring-white/5">
            {/* Top Workspace Header Bar */}
            <div className="px-4 sm:px-5 py-3 bg-surface/90 border-b border-border/70 rounded-t-[22px] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                </div>
                <span className="text-slate-600 text-xs">|</span>
                <div className="flex items-center gap-2 text-xs font-mono text-slate-300 truncate">
                  <Sliders className="w-3.5 h-3.5 text-signal shrink-0" />
                  <span className="hidden sm:inline">Workspace / Career /</span>
                  <span className="text-slate-100 font-semibold truncate">Job Offer Matrix 2026</span>
                </div>
              </div>

              {/* Interactive Quick-Pill Switcher inside Hero Preview */}
              <div className="flex items-center gap-1.5 bg-background/90 p-1.5 rounded-xl border border-border-subtle text-xs w-full sm:w-auto justify-between sm:justify-start">
                <div className="flex items-center gap-1 text-slate-400 font-mono text-[11px] px-1.5">
                  <MousePointerClick className="w-3 h-3 text-signal" />
                  <span className="hidden md:inline">Click to test:</span>
                </div>

                <div className="flex items-center gap-1 flex-1 sm:flex-initial justify-end">
                  <button
                    onClick={() => handlePrioritySelect('career')}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${
                      activePriority === 'career'
                        ? 'bg-signal text-background font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 bg-surface/40'
                    }`}
                  >
                    {activePriority === 'career' && <CheckCircle2 className="w-3 h-3 text-background" />}
                    <span>Career Growth</span>
                  </button>

                  <button
                    onClick={() => handlePrioritySelect('comp')}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${
                      activePriority === 'comp'
                        ? 'bg-signal text-background font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 bg-surface/40'
                    }`}
                  >
                    {activePriority === 'comp' && <CheckCircle2 className="w-3 h-3 text-background" />}
                    <span>Compensation</span>
                  </button>

                  <button
                    onClick={() => handlePrioritySelect('wlb')}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${
                      activePriority === 'wlb'
                        ? 'bg-signal text-background font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 bg-surface/40'
                    }`}
                  >
                    {activePriority === 'wlb' && <CheckCircle2 className="w-3 h-3 text-background" />}
                    <span>Work-Life Focus</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Main Decision Card Content */}
            <div className="p-5 sm:p-8">
              {/* Question & Winner Highlight */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-border-subtle">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">Target Decision</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface border border-border text-signal">
                      100% Deterministic
                    </span>
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-bold text-white mt-1">
                    Should I accept this job?
                  </h3>
                </div>

                <div className="flex items-center gap-3.5 bg-surface-subtle border border-signal/40 px-5 py-3 rounded-2xl shadow-glow-signal-sm">
                  <Award className="w-6 h-6 text-signal shrink-0" />
                  <div>
                    <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Leading Recommendation</div>
                    <div className="text-base font-bold text-white flex items-center gap-2">
                      <span>Company {active.winner}</span>
                      <span className="text-signal font-mono text-sm font-extrabold">
                        ({active.winner === 'Alpha' ? active.alpha : active.winner === 'Beta' ? active.beta : active.gamma} pts)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Options Comparison Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                {/* Company Alpha Card */}
                <div
                  className={`rounded-2xl p-5 transition-all duration-300 border ${
                    active.winner === 'Alpha'
                      ? 'bg-surface-card border-signal/50 shadow-glow-signal-sm ring-1 ring-signal/20'
                      : 'bg-surface/40 border-border-subtle opacity-75'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-signal" />
                      <span className="font-bold text-slate-100 text-sm sm:text-base">Company Alpha</span>
                    </div>
                    {active.winner === 'Alpha' && (
                      <span className="px-2 py-0.5 rounded-md bg-signal/15 text-signal text-[10px] font-mono font-semibold border border-signal/30">
                        Top Rank #1
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="text-3xl font-extrabold font-mono text-white tracking-tight">
                      {active.alpha}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">/ 100 weighted pts</span>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-400">
                    <div className="flex justify-between">
                      <span>Growth</span>
                      <span className="font-mono text-slate-200">95/100</span>
                    </div>
                    <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                      <div className="h-full bg-signal rounded-full" style={{ width: '95%' }} />
                    </div>
                    <div className="flex justify-between pt-1">
                      <span>Comp</span>
                      <span className="font-mono text-slate-200">70/100</span>
                    </div>
                    <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                      <div className="h-full bg-signal/70 rounded-full" style={{ width: '70%' }} />
                    </div>
                  </div>
                </div>

                {/* Company Beta Card */}
                <div
                  className={`rounded-2xl p-5 transition-all duration-300 border ${
                    active.winner === 'Beta'
                      ? 'bg-surface-card border-accent-cyan/50 shadow-glow-card ring-1 ring-accent-cyan/20'
                      : 'bg-surface/40 border-border-subtle opacity-75'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-accent-cyan" />
                      <span className="font-bold text-slate-100 text-sm sm:text-base">Company Beta</span>
                    </div>
                    {active.winner === 'Beta' && (
                      <span className="px-2 py-0.5 rounded-md bg-accent-cyan/15 text-accent-cyan text-[10px] font-mono font-semibold border border-accent-cyan/30">
                        Top Rank #1
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="text-3xl font-extrabold font-mono text-white tracking-tight">
                      {active.beta}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">/ 100 weighted pts</span>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-400">
                    <div className="flex justify-between">
                      <span>Growth</span>
                      <span className="font-mono text-slate-200">72/100</span>
                    </div>
                    <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                      <div className="h-full bg-accent-cyan/70 rounded-full" style={{ width: '72%' }} />
                    </div>
                    <div className="flex justify-between pt-1">
                      <span>Comp</span>
                      <span className="font-mono text-slate-200">95/100</span>
                    </div>
                    <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                      <div className="h-full bg-accent-cyan rounded-full" style={{ width: '95%' }} />
                    </div>
                  </div>
                </div>

                {/* Company Gamma Card */}
                <div
                  className={`rounded-2xl p-5 transition-all duration-300 border ${
                    active.winner === 'Gamma'
                      ? 'bg-surface-card border-accent-amber/50 shadow-glow-card ring-1 ring-accent-amber/20'
                      : 'bg-surface/40 border-border-subtle opacity-75'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-accent-amber" />
                      <span className="font-bold text-slate-100 text-sm sm:text-base">Company Gamma</span>
                    </div>
                    {active.winner === 'Gamma' && (
                      <span className="px-2 py-0.5 rounded-md bg-accent-amber/15 text-accent-amber text-[10px] font-mono font-semibold border border-accent-amber/30">
                        Top Rank #1
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="text-3xl font-extrabold font-mono text-white tracking-tight">
                      {active.gamma}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">/ 100 weighted pts</span>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-400">
                    <div className="flex justify-between">
                      <span>WLB (4-Day Week)</span>
                      <span className="font-mono text-slate-200">96/100</span>
                    </div>
                    <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                      <div className="h-full bg-accent-amber rounded-full" style={{ width: '96%' }} />
                    </div>
                    <div className="flex justify-between pt-1">
                      <span>Stability</span>
                      <span className="font-mono text-slate-200">82/100</span>
                    </div>
                    <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                      <div className="h-full bg-accent-amber/80 rounded-full" style={{ width: '82%' }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Explainability Footer Bar */}
              <div className="mt-5 p-4 rounded-xl bg-background/90 border border-border flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 p-1 rounded bg-signal/10 text-signal">
                    <Sparkles className="w-4 h-4" />
                  </span>
                  <div>
                    <div className="text-xs font-semibold text-slate-200">
                      {activePriority === 'career' && 'Alpha fits your current priorities better (+6.0 pts lead).'}
                      {activePriority === 'comp' && 'Beta becomes the dominant choice when compensation is prioritized (+5.0 pts lead).'}
                      {activePriority === 'wlb' && 'Gamma leads when 4-day workweek and lifestyle are weighted highest (+4.0 pts lead).'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {activePriority === 'career' && 'High-velocity promotional ownership outweighs enterprise cash.'}
                      {activePriority === 'comp' && 'Market-leading liquid base pay & RSUs dominate the calculation.'}
                      {activePriority === 'wlb' && 'Extreme lifestyle autonomy and 32h workweeks surpass startup grind.'}
                    </div>
                  </div>
                </div>

                <a
                  href="#simulator"
                  onClick={() => sound.playTick()}
                  className="text-xs font-mono font-medium text-signal hover:underline flex items-center gap-1.5 ml-auto bg-surface-subtle px-3 py-1.5 rounded-lg border border-border"
                >
                  <MousePointerClick className="w-3.5 h-3.5" />
                  <span>Click to open Full Studio</span>
                  <ArrowRight className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};
