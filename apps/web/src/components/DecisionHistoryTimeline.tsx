import React from 'react';
import { motion } from 'framer-motion';
import { History, ArrowRight, CheckCircle2 } from 'lucide-react';
import { sound } from '../utils/audioFx';

interface DecisionHistoryTimelineProps {
  onOpenSandbox: () => void;
}

const historyEvents = [
  {
    version: 'v1.0',
    title: 'Gut-Feel Default (Salary Anchoring)',
    timestamp: 'Initial Dilemma',
    summary: 'Subjectively favored Company Beta purely due to top base salary ($240k), ignoring slow promotion velocity and corporate bureaucracy.',
    winner: 'Company Beta (Intuitive Bias)',
    tag: 'Unstructured',
    tagColor: 'text-accent-rose bg-accent-rose/10 border-accent-rose/20',
  },
  {
    version: 'v1.1',
    title: 'Multi-Criteria Parameterization',
    timestamp: '+15 mins',
    summary: 'Framed 5 explicit criteria: Career Growth (30%), Comp (25%), Learning (20%), WLB (15%), Stability (10%). Company Alpha surges ahead by +6.0 pts.',
    winner: 'Company Alpha (84.0 pts)',
    tag: 'MCDA Applied',
    tagColor: 'text-signal bg-signal/10 border-signal/20',
  },
  {
    version: 'v1.2',
    title: 'Sensitivity Stress-Test Discovery',
    timestamp: '+25 mins',
    summary: 'Discovered the exact analytical tipping point: If Compensation exceeds 36.4%, Beta flips to the winning choice. Confirmed career acceleration is the dominant goal.',
    winner: 'Tipping Point Validated',
    tag: 'Sensitivity Solved',
    tagColor: 'text-accent-amber bg-accent-amber/10 border-accent-amber/20',
  },
  {
    version: 'v1.3',
    title: 'Verified Decision Briefing Exported',
    timestamp: 'Final Choice',
    summary: 'Generated a deterministic briefing ticket to explain the choice to mentors and partner. 100% confidence, zero second-guessing.',
    winner: 'Company Alpha Accepted 🏆',
    tag: 'Airtight Defense',
    tagColor: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/20',
  },
];

export const DecisionHistoryTimeline: React.FC<DecisionHistoryTimelineProps> = ({ onOpenSandbox }) => {
  return (
    <section className="py-24 md:py-32 relative border-t border-border-subtle bg-surface-subtle/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-border text-xs font-mono font-medium text-slate-300 mb-3">
            <History className="w-3.5 h-3.5 text-signal" />
            <span>Decision Evolution</span>
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
            How a decision evolves.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-400">
            From intuitive uncertainty to mathematical clarity. See how the decision trajectory develops across 4 structured iterations.
          </p>
        </div>

        {/* Timeline Grid */}
        <div className="max-w-4xl mx-auto relative">
          <div className="hidden sm:block absolute left-8 top-6 bottom-6 w-px bg-gradient-to-b from-signal/40 via-accent-cyan/30 to-border" />

          <div className="space-y-6">
            {historyEvents.map((evt, idx) => (
              <motion.div
                key={evt.version}
                initial={{ opacity: 0, x: -15 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: idx * 0.1 }}
                className="relative flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6 p-6 rounded-2xl bg-surface-card border border-border hover:border-border-strong transition-all group"
              >
                <div className="flex sm:flex-col items-center justify-between sm:justify-start gap-2 shrink-0">
                  <div className="w-10 h-10 rounded-xl bg-surface border border-border flex items-center justify-center text-signal font-mono font-bold text-xs group-hover:border-signal/50 group-hover:shadow-glow-signal-sm transition-all">
                    {evt.version}
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">
                    {evt.timestamp}
                  </span>
                </div>

                <div className="flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <h3 className="text-base sm:text-lg font-bold text-white group-hover:text-signal transition-colors">
                      {evt.title}
                    </h3>
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold border ${evt.tagColor}`}>
                      {evt.tag}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-3">
                    {evt.summary}
                  </p>

                  <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                    <CheckCircle2 className="w-3.5 h-3.5 text-signal" />
                    <span>Outcome: <strong className="text-slate-200">{evt.winner}</strong></span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="mt-12 text-center">
          <button
            onClick={() => {
              sound.playTick();
              onOpenSandbox();
            }}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-surface hover:bg-surface-hover border border-border hover:border-signal/50 text-xs sm:text-sm font-mono text-slate-200 hover:text-white transition-all shadow-sm"
          >
            <span>Model Your Own Decision Trajectory</span>
            <ArrowRight className="w-4 h-4 text-signal" />
          </button>
        </div>
      </div>
    </section>
  );
};
