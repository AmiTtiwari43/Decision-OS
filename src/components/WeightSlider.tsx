import React from 'react';
import { Lock, Unlock, TrendingUp, DollarSign, Heart, Shield, Award } from 'lucide-react';
import type { Criterion } from '../types/decision';

interface WeightSliderProps {
  criterion: Criterion;
  weight: number;
  isLocked: boolean;
  onWeightChange: (newWeight: number) => void;
  onToggleLock: () => void;
}

const categoryIcons: Record<string, React.ReactNode> = {
  growth: <TrendingUp className="w-3.5 h-3.5 text-signal" />,
  finance: <DollarSign className="w-3.5 h-3.5 text-accent-cyan" />,
  lifestyle: <Heart className="w-3.5 h-3.5 text-accent-rose" />,
  risk: <Shield className="w-3.5 h-3.5 text-accent-amber" />,
  execution: <Award className="w-3.5 h-3.5 text-accent-indigo" />,
};

export const WeightSlider: React.FC<WeightSliderProps> = ({
  criterion,
  weight,
  isLocked,
  onWeightChange,
  onToggleLock,
}) => {
  return (
    <div className="p-3.5 rounded-xl bg-surface border border-border hover:border-border-strong transition-all duration-200 group">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 truncate">
          <span className="p-1 rounded-md bg-surface-subtle border border-border-subtle shrink-0">
            {categoryIcons[criterion.category] || <TrendingUp className="w-3.5 h-3.5 text-signal" />}
          </span>
          <div className="truncate">
            <span className="text-xs sm:text-sm font-semibold text-slate-100 group-hover:text-white transition-colors truncate block">
              {criterion.name}
            </span>
            <p className="text-[11px] text-slate-400 hidden sm:block truncate">
              {criterion.description}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Lock / Unlock Toggle Button */}
          <button
            onClick={onToggleLock}
            className={`px-2 py-1 rounded-md border text-[11px] font-mono flex items-center gap-1 transition-all cursor-pointer ${
              isLocked
                ? 'bg-signal/15 border-signal/40 text-signal shadow-sm'
                : 'bg-surface-subtle border-border-subtle text-slate-500 hover:text-slate-200'
            }`}
            title={isLocked ? 'Locked (Weight will not auto-adjust)' : 'Click to lock this weight'}
            aria-label={isLocked ? `Unlock ${criterion.name}` : `Lock ${criterion.name}`}
          >
            {isLocked ? (
              <>
                <Lock className="w-3 h-3 text-signal" />
                <span className="text-[10px]">Locked</span>
              </>
            ) : (
              <>
                <Unlock className="w-3 h-3 text-slate-500" />
                <span className="text-[10px] text-slate-400">Lock</span>
              </>
            )}
          </button>

          {/* Numerical Percentage Badge */}
          <div className="min-w-[48px] text-right">
            <span className="font-mono text-sm font-bold text-slate-100 px-2 py-0.5 rounded bg-background border border-border">
              {Math.round(weight)}%
            </span>
          </div>
        </div>
      </div>

      {/* Range Input Slider with explicit Drag affordance */}
      <div className="relative flex items-center mt-1.5">
        <input
          type="range"
          min="0"
          max="80"
          step="1"
          value={weight}
          disabled={isLocked}
          onChange={(e) => onWeightChange(Number(e.target.value))}
          className={`w-full ${isLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          aria-label={`Drag to calibrate weight for ${criterion.name}`}
        />
      </div>
    </div>
  );
};
