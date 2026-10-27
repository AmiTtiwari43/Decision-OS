import React from 'react';
import { ShieldCheck, Zap } from 'lucide-react';

interface DecisionTickerProps {
  leaderName: string;
  leaderScore: number;
  scoreLead: number;
  tippingInfo: string;
}

export const DecisionTicker: React.FC<DecisionTickerProps> = ({
  leaderName,
  leaderScore,
  scoreLead,
  tippingInfo,
}) => {
  return (
    <div className="w-full max-w-full overflow-hidden bg-surface-subtle/80 border-y border-border-subtle py-2.5 px-4 backdrop-blur-md">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs font-mono">
        {/* Left Telemetry Status */}
        <div className="flex items-center gap-3 overflow-hidden text-ellipsis whitespace-nowrap">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="w-2 h-2 rounded-full bg-signal animate-pulse" />
            <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider">
              Telemetry
            </span>
          </div>

          <span className="text-slate-600 hidden sm:inline">|</span>

          <div className="flex items-center gap-2 truncate">
            <span className="text-slate-400 truncate">Leader:</span>
            <span className="text-white font-bold">{leaderName}</span>
            <span className="text-signal font-mono">({leaderScore} pts, +{scoreLead} pts lead)</span>
          </div>
        </div>

        {/* Right Status */}
        <div className="flex items-center gap-3 text-[11px] text-slate-400 shrink-0">
          <div className="flex items-center gap-1 text-accent-amber truncate">
            <Zap className="w-3 h-3 shrink-0" />
            <span className="truncate">{tippingInfo}</span>
          </div>

          <span className="text-slate-600 hidden md:inline">|</span>

          <div className="hidden md:flex items-center gap-1 text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-signal shrink-0" />
            <span>MCDA Verified</span>
          </div>
        </div>
      </div>
    </div>
  );
};
