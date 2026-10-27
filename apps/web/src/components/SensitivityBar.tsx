import React from 'react';
import { GitCompare, ArrowRight, Zap, MousePointerClick } from 'lucide-react';
import type { SensitivityAnalysis } from '../types/decision';

interface SensitivityBarProps {
  sensitivity: SensitivityAnalysis[];
  runnerUpName: string | null;
  onApplyTippingWeight: (criterionId: string, tippingWeight: number) => void;
}

export const SensitivityBar: React.FC<SensitivityBarProps> = ({
  sensitivity,
  runnerUpName,
  onApplyTippingWeight,
}) => {
  const accessiblePoints = sensitivity.filter(
    s => s.tippingPointWeight !== null && s.weightDeltaNeeded !== null && s.wouldFlipToOptionId !== null
  );

  if (accessiblePoints.length === 0 || !runnerUpName) {
    return (
      <div className="p-4 rounded-xl bg-surface/50 border border-border flex items-center gap-3 text-xs text-slate-400">
        <GitCompare className="w-4 h-4 text-slate-500" />
        <span>Current lead is mathematically stable across individual criteria variations.</span>
      </div>
    );
  }

  const primaryTipping = accessiblePoints.sort(
    (a, b) => Math.abs(a.weightDeltaNeeded || 999) - Math.abs(b.weightDeltaNeeded || 999)
  )[0];

  const delta = primaryTipping.weightDeltaNeeded ?? 0;
  const isIncrease = delta > 0;

  return (
    <div className="rounded-xl p-4 sm:p-5 bg-gradient-to-r from-surface-card via-surface to-surface-card border border-accent-amber/40 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-accent-amber/15 text-accent-amber border border-accent-amber/30 shrink-0 mt-0.5">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-accent-amber font-semibold">
                Sensitivity Tipping Point
              </span>
              <span className="text-slate-500 font-mono text-xs">/ Live Analysis</span>
            </div>
            <p className="text-xs sm:text-sm text-slate-200 mt-1 font-medium">
              If <span className="text-white font-bold">{primaryTipping.criterionName}</span> weight shifts from{' '}
              <span className="font-mono text-signal font-semibold">{primaryTipping.currentWeight}%</span> to{' '}
              <span className="font-mono text-accent-amber font-semibold">{primaryTipping.tippingPointWeight}%</span> (
              {isIncrease ? `+${delta}%` : `${delta}%`}),{' '}
              <span className="text-white font-bold">{runnerUpName}</span> overtakes the lead.
            </p>
          </div>
        </div>

        {primaryTipping.tippingPointWeight !== null && (
          <button
            onClick={() => onApplyTippingWeight(primaryTipping.criterionId, primaryTipping.tippingPointWeight!)}
            className="shrink-0 px-3.5 py-2.5 rounded-xl bg-accent-amber/15 hover:bg-accent-amber/25 border border-accent-amber/40 text-accent-amber text-xs font-mono font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm hover:scale-[1.02]"
          >
            <MousePointerClick className="w-3.5 h-3.5" />
            <span>Click to simulate flip</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
