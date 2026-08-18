import React from 'react';
import { Eye, UserCheck, Sliders, User } from 'lucide-react';

const principles = [
  {
    icon: Eye,
    title: 'Transparent',
    tagline: 'Zero black-box math',
    description:
      'Every score, weight multiplication, and sensitivity threshold is explicitly visible. You can inspect the arithmetic behind every recommendation.',
  },
  {
    icon: UserCheck,
    title: 'Personal',
    tagline: 'Rooted in your values',
    description:
      'There is no generic consensus. The model adapts to your life stage, risk appetite, and personal definition of success.',
  },
  {
    icon: Sliders,
    title: 'Scenario-Aware',
    tagline: 'Built for trade-off exploration',
    description:
      'Easily toggle between life scenarios to discover the exact tipping point where priorities invert the outcome.',
  },
  {
    icon: User,
    title: 'Human-Controlled',
    tagline: 'Informs, never replaces judgment',
    description:
      'Decision OS is an analytical instrument for clear thinking, not an AI oracle that pretends to know your future.',
  },
];

export const Principles: React.FC = () => {
  return (
    <section id="principles" className="py-24 md:py-32 relative bg-surface-subtle/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-signal">
            Core Tenets
          </span>
          <h2 className="mt-2 text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
            Designed for clear, defensible judgment.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-400">
            Engineered around four foundational principles that respect human agency and intellectual honesty.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {principles.map((p, idx) => {
            const Icon = p.icon;
            return (
              <div
                key={p.title}
                className="p-6 rounded-2xl bg-surface-card border border-border hover:border-border-strong transition-all duration-200 flex flex-col justify-between group"
              >
                <div>
                  <div className="w-10 h-10 rounded-xl bg-surface border border-border-subtle flex items-center justify-center text-signal group-hover:shadow-glow-signal-sm transition-all mb-4">
                    <Icon className="w-5 h-5" />
                  </div>

                  <span className="text-[11px] font-mono text-slate-500 block mb-1">
                    0{idx + 1}
                  </span>
                  <h3 className="text-lg font-bold text-white mb-1">
                    {p.title}
                  </h3>
                  <div className="text-xs font-mono text-signal mb-3">
                    {p.tagline}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                    {p.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
