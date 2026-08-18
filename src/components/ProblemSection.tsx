import React from 'react';
import { motion } from 'framer-motion';
import {
  FileQuestion,
  Shuffle,
  Scale,
  BrainCircuit,
  Layers,
  ArrowDown,
} from 'lucide-react';

const steps = [
  {
    icon: FileQuestion,
    label: 'Scattered Information',
    description: 'Messy notes, compensation spreadsheets, Glassdoor reviews, and conflicting advice from mentors.',
    color: 'text-slate-400',
    border: 'border-slate-800',
  },
  {
    icon: Shuffle,
    label: 'Conflicting Priorities',
    description: 'Do you prioritize rapid learning right now, or liquid salary to save for a home down payment?',
    color: 'text-accent-amber',
    border: 'border-accent-amber/30',
  },
  {
    icon: Scale,
    label: 'Hidden Trade-offs',
    description: 'Every upside in one option hides a compromise in culture, hours, equity liquidity, or promotion velocity.',
    color: 'text-accent-cyan',
    border: 'border-accent-cyan/30',
  },
  {
    icon: BrainCircuit,
    label: 'Decision Paralysis',
    description: 'Analysis loops leading to second-guessing and defaulting to whatever choice feels easiest in the moment.',
    color: 'text-accent-rose',
    border: 'border-accent-rose/30',
  },
];

export const ProblemSection: React.FC = () => {
  return (
    <section className="py-24 md:py-32 relative bg-surface-subtle/50 border-y border-border-subtle/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto">
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-signal">
            The Cognitive Friction
          </span>
          <h2 className="mt-2 text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Your hardest decisions deserve more than a gut feeling.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-400 font-normal">
            Intuition is easily skewed by salary anchoring and recency bias. When stakes are high, you need a model that can explain why an option actually wins.
          </p>
        </div>

        {/* 4-Stage Friction Flow Grid */}
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 relative">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                className={`relative p-6 rounded-2xl bg-surface/80 border ${step.border} backdrop-blur-sm flex flex-col justify-between hover:bg-surface-hover transition-colors`}
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className={`p-2.5 rounded-xl bg-surface-subtle border border-border ${step.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="font-mono text-xs text-slate-500 font-semibold">
                      0{idx + 1}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-100 mb-2">
                    {step.label}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                    {step.description}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-border-subtle/50 flex items-center gap-1.5 text-[11px] font-mono text-slate-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                  <span>Cognitive Friction</span>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Downward transition to Structured Clarity */}
        <div className="mt-10 flex flex-col items-center justify-center">
          <div className="w-px h-8 bg-gradient-to-b from-border to-signal/50" />
          <div className="my-2 p-2 rounded-full bg-signal/10 border border-signal/30 text-signal shadow-glow-signal-sm">
            <ArrowDown className="w-4 h-4" />
          </div>
          <div className="w-px h-8 bg-gradient-to-b from-signal/50 to-border" />
        </div>

        {/* Resolution Banner */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mt-6 max-w-3xl mx-auto rounded-2xl bg-gradient-to-r from-surface-card via-surface to-surface-card p-6 sm:p-8 border border-signal/40 shadow-glow-signal-sm"
        >
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
            <div className="p-3 rounded-xl bg-signal text-background shrink-0 shadow-glow-signal">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-signal/15 text-signal text-xs font-mono font-semibold border border-signal/30">
                  The Decision OS Model
                </span>
                <span className="text-xs text-slate-400 font-mono">/ Deterministic MCDA</span>
              </div>
              <h4 className="text-lg sm:text-xl font-bold text-white mt-1.5">
                Structured, transparent comparisons driven by your explicit priorities.
              </h4>
              <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed">
                By weighting what matters and testing sensitivity boundaries, you eliminate gut-feel bias and walk away with a choice you can defend to yourself, your partner, and your team.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};
