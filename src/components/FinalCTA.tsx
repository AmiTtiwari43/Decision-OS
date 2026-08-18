import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';

interface FinalCTAProps {
  onOpenSandbox: () => void;
}

export const FinalCTA: React.FC<FinalCTAProps> = ({ onOpenSandbox }) => {
  return (
    <section className="py-24 md:py-32 relative overflow-hidden">
      {/* Subtle radial glow backdrop */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-radial-fade opacity-60 pointer-events-none" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="rounded-3xl p-8 sm:p-14 bg-gradient-to-b from-surface-card via-surface to-surface-card border border-signal/40 shadow-glow-signal text-center relative overflow-hidden">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-signal/15 border border-signal/30 text-xs font-mono font-semibold text-signal mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Ready to Decide</span>
          </div>

          <h2 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight max-w-2xl mx-auto">
            The right decision starts with knowing what matters.
          </h2>

          <p className="mt-6 text-base sm:text-lg text-slate-300 max-w-xl mx-auto font-normal">
            Turn your next high-stakes choice into a transparent, structured model you can explain to anyone.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={onOpenSandbox}
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-signal hover:bg-signal-light text-background font-bold text-sm sm:text-base flex items-center justify-center gap-3 transition-all duration-200 shadow-glow-signal hover:shadow-glow-signal transform hover:-translate-y-0.5"
            >
              <span>Make your first decision</span>
              <ArrowRight className="w-4 h-4 text-background" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
