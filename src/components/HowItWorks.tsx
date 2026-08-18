import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, SlidersHorizontal, Lightbulb, Check, Sparkles, MousePointerClick } from 'lucide-react';
import { sound } from '../utils/audioFx';

const workflowSteps = [
  {
    step: '01',
    title: 'Define',
    tagline: 'Establish options and criteria',
    description:
      'Frame the core question (e.g., "Which job should I accept?") and define the 4–6 core criteria that dictate long-term success.',
    badge: 'Input & Framing',
    icon: Target,
    previewContent: {
      heading: 'Job Offer Matrix',
      items: ['Company Alpha (Startup)', 'Company Beta (Enterprise)'],
      tags: ['Career Growth', 'Compensation', 'Learning', 'WLB', 'Stability'],
    },
  },
  {
    step: '02',
    title: 'Prioritize',
    tagline: 'Calibrate what actually matters to you',
    description:
      'Allocate proportional percentage weights to each criterion. Lock non-negotiables and let the system balance the remainder to 100%.',
    badge: 'Weight Calibration',
    icon: SlidersHorizontal,
    previewContent: {
      heading: 'Active Weight Allocation',
      items: ['Career Growth: 30%', 'Compensation: 25%', 'Learning: 20%'],
      tags: ['Normalized to 100%', 'Zero Math Errors', 'Locked Constraints'],
    },
  },
  {
    step: '03',
    title: 'Decide',
    tagline: 'Stress-test scenarios with full transparency',
    description:
      'Instantly see which option leads, inspect the exact sensitivity tipping point, and review deterministic natural-language reasoning.',
    badge: 'Explainable Outcome',
    icon: Lightbulb,
    previewContent: {
      heading: 'Company Alpha Leads (+6.0 pts)',
      items: ['Primary Driver: Career Growth (+18 raw pts)', 'Tipping Point: Comp > 36.4% flips to Beta'],
      tags: ['Deterministic', 'Scenario-Aware', 'Defensible Briefing'],
    },
  },
];

export const HowItWorks: React.FC = () => {
  const [activeStep, setActiveStep] = useState(0);

  const handleStepClick = (idx: number) => {
    sound.playTick();
    setActiveStep(idx);
  };

  return (
    <section id="how-it-works" className="py-24 md:py-32 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto">
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-signal">
            Methodology
          </span>
          <h2 className="mt-2 text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
            From ambiguity to explainable confidence in 3 steps.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-400">
            A structured workflow that guides your judgment without taking away your control.
          </p>
        </div>

        {/* Step Navigation Tabs with explicit Click cues */}
        <div className="mt-14 max-w-2xl mx-auto grid grid-cols-3 gap-2 p-1.5 rounded-xl bg-surface border border-border">
          {workflowSteps.map((s, idx) => (
            <button
              key={s.step}
              onClick={() => handleStepClick(idx)}
              className={`py-2.5 px-3 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeStep === idx
                  ? 'bg-signal text-background shadow-glow-signal-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="font-mono text-xs opacity-75">{s.step}</span>
              <span>{s.title}</span>
              {activeStep === idx && <span className="w-1.5 h-1.5 rounded-full bg-background shrink-0" />}
            </button>
          ))}
        </div>

        {/* Dynamic Step Display */}
        <div className="mt-10 max-w-4xl mx-auto">
          <AnimatePresence mode="wait">
            {workflowSteps.map((s, idx) => {
              if (idx !== activeStep) return null;
              const Icon = s.icon;
              return (
                <motion.div
                  key={s.step}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.35 }}
                  className="rounded-2xl bg-surface-card border border-border p-6 sm:p-10 shadow-glow-card grid grid-cols-1 md:grid-cols-2 gap-8 items-center"
                >
                  {/* Left Explanation Column */}
                  <div>
                    <div className="flex items-center gap-2 text-xs font-mono text-signal mb-3">
                      <span className="p-1.5 rounded-md bg-signal/10 border border-signal/30">
                        <Icon className="w-4 h-4 text-signal" />
                      </span>
                      <span>STEP {s.step} — {s.badge}</span>
                    </div>

                    <h3 className="text-2xl sm:text-3xl font-bold text-white mb-2">
                      {s.title}: {s.tagline}
                    </h3>

                    <p className="text-sm sm:text-base text-slate-300 leading-relaxed mb-6">
                      {s.description}
                    </p>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleStepClick((idx + 1) % workflowSteps.length)}
                        className="px-4 py-2 rounded-lg bg-surface border border-border-strong text-xs font-mono text-slate-200 hover:text-white hover:border-signal/50 flex items-center gap-2 transition-all cursor-pointer"
                      >
                        <MousePointerClick className="w-3.5 h-3.5 text-signal" />
                        <span>Next Step</span>
                        <span className="text-signal">→</span>
                      </button>
                      <span className="text-xs font-mono text-slate-500">
                        Step {idx + 1} of 3
                      </span>
                    </div>
                  </div>

                  {/* Right Mini Visual Representation */}
                  <div className="rounded-xl bg-background/90 border border-border-subtle p-5 font-mono text-xs shadow-inner">
                    <div className="flex items-center justify-between pb-3 mb-3 border-b border-border-subtle">
                      <div className="flex items-center gap-2 text-slate-300 font-semibold">
                        <Sparkles className="w-3.5 h-3.5 text-signal" />
                        <span>{s.previewContent.heading}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-surface border border-border text-[10px] text-slate-400">
                        Live Preview
                      </span>
                    </div>

                    <div className="space-y-2 mb-4">
                      {s.previewContent.items.map((item, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 p-2 rounded-lg bg-surface/60 border border-border-subtle text-slate-200"
                        >
                          <Check className="w-3.5 h-3.5 text-signal shrink-0" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border-subtle/60">
                      {s.previewContent.tags.map((tag, i) => (
                        <span
                          key={i}
                          className="px-2 py-1 rounded bg-surface-subtle text-[11px] text-slate-400 border border-border-subtle"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
};
