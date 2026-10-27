import React from 'react';
import { ShieldCheck, CheckCircle, Activity, Zap } from 'lucide-react';

export const TransparencySection: React.FC = () => {
  return (
    <section className="py-24 md:py-32 relative border-t border-border-subtle">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-border text-xs font-mono font-medium text-slate-300 mb-3">
            <ShieldCheck className="w-3.5 h-3.5 text-signal" />
            <span>Deterministic Explainability</span>
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
            See why the decision changes.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-400">
            Recommendations are never opaque black boxes. Decision OS decomposes every score into exact criterion-level point contributions.
          </p>
        </div>

        {/* 2-Scenario Comparison Matrix */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {/* Box 1: Why Alpha Wins in Career-First */}
          <div className="rounded-2xl p-6 sm:p-8 bg-surface-card border border-signal/40 shadow-glow-signal-sm">
            <div className="flex items-center justify-between pb-4 mb-5 border-b border-border">
              <div>
                <span className="text-[11px] font-mono text-signal uppercase tracking-wider font-semibold">
                  Scenario A: Career & Learning Priority
                </span>
                <h3 className="text-xl font-bold text-white mt-1">
                  Company Alpha Wins (82.2 pts)
                </h3>
              </div>
              <span className="px-3 py-1 rounded-full bg-signal/15 text-signal text-xs font-mono font-bold border border-signal/30">
                +0.3 pt Lead
              </span>
            </div>

            <p className="text-xs sm:text-sm text-slate-300 mb-6 leading-relaxed">
              When professional acceleration and mentorship take precedence, Alpha’s outsized advantages in high-velocity projects outweigh Beta’s higher base compensation.
            </p>

            <div className="space-y-3">
              <div className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                Key Contributing Factors
              </div>

              <div className="p-3 rounded-xl bg-surface/70 border border-border-subtle flex items-start gap-3">
                <CheckCircle className="w-4 h-4 text-signal shrink-0 mt-0.5" />
                <div className="text-xs">
                  <div className="font-semibold text-slate-200">Career Growth (+28.5 pts contribution)</div>
                  <div className="text-slate-400">95/100 raw score with 30% weight allocation</div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-surface/70 border border-border-subtle flex items-start gap-3">
                <CheckCircle className="w-4 h-4 text-signal shrink-0 mt-0.5" />
                <div className="text-xs">
                  <div className="font-semibold text-slate-200">Learning & Mentorship (+18.4 pts contribution)</div>
                  <div className="text-slate-400">92/100 raw score with 20% weight allocation</div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-surface/40 border border-border-subtle flex items-start gap-3 opacity-75">
                <Activity className="w-4 h-4 text-accent-amber shrink-0 mt-0.5" />
                <div className="text-xs">
                  <div className="font-semibold text-slate-300">Conceded Area: Compensation (-6.25 pts vs Beta)</div>
                  <div className="text-slate-400">Beta’s higher salary does not overturn Alpha’s growth points</div>
                </div>
              </div>
            </div>
          </div>

          {/* Box 2: Why Beta Wins in Money-First */}
          <div className="rounded-2xl p-6 sm:p-8 bg-surface-card border border-accent-cyan/40 shadow-glow-card">
            <div className="flex items-center justify-between pb-4 mb-5 border-b border-border">
              <div>
                <span className="text-[11px] font-mono text-accent-cyan uppercase tracking-wider font-semibold">
                  Scenario B: Compensation Priority (45%)
                </span>
                <h3 className="text-xl font-bold text-white mt-1">
                  Company Beta Takes the Lead (85.2 pts)
                </h3>
              </div>
              <span className="px-3 py-1 rounded-full bg-accent-cyan/15 text-accent-cyan text-xs font-mono font-bold border border-accent-cyan/30">
                +4.8 pt Lead
              </span>
            </div>

            <p className="text-xs sm:text-sm text-slate-300 mb-6 leading-relaxed">
              When financial liquidity and company stability are weighted higher, Beta’s guaranteed base compensation and enterprise runway dominate the calculation.
            </p>

            <div className="space-y-3">
              <div className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                Key Contributing Factors
              </div>

              <div className="p-3 rounded-xl bg-surface/70 border border-border-subtle flex items-start gap-3">
                <CheckCircle className="w-4 h-4 text-accent-cyan shrink-0 mt-0.5" />
                <div className="text-xs">
                  <div className="font-semibold text-slate-200">Total Compensation (+42.7 pts contribution)</div>
                  <div className="text-slate-400">95/100 raw score multiplied by dominant 45% weight</div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-surface/70 border border-border-subtle flex items-start gap-3">
                <CheckCircle className="w-4 h-4 text-accent-cyan shrink-0 mt-0.5" />
                <div className="text-xs">
                  <div className="font-semibold text-slate-200">Company Stability (+13.8 pts contribution)</div>
                  <div className="text-slate-400">92/100 raw score providing robust macroeconomic security</div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-surface/40 border border-border-subtle flex items-start gap-3 opacity-75">
                <Activity className="w-4 h-4 text-signal shrink-0 mt-0.5" />
                <div className="text-xs">
                  <div className="font-semibold text-slate-300">Conceded Area: Promotion Velocity (-3.5 pts vs Alpha)</div>
                  <div className="text-slate-400">Lower career growth weight renders this delta secondary</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic Philosophy Callout */}
        <div className="mt-12 text-center max-w-2xl mx-auto">
          <div className="p-4 rounded-xl bg-surface/40 border border-border-subtle inline-flex items-center gap-3 text-xs sm:text-sm text-slate-300">
            <Zap className="w-4 h-4 text-signal shrink-0" />
            <span>
              <strong>Takeaway:</strong> There is no universally "correct" job offer. The best decision depends on what matters to you.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
