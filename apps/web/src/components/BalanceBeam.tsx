import React from 'react';
import { motion } from 'framer-motion';
import { Scale, ArrowRightLeft } from 'lucide-react';
import type { OptionEvaluation } from '../types/decision';

interface BalanceBeamProps {
  evaluations: OptionEvaluation[];
}

export const BalanceBeam: React.FC<BalanceBeamProps> = ({ evaluations }) => {
  if (evaluations.length < 2) return null;

  const optA = evaluations[0];
  const optB = evaluations[1];

  const delta = optA.weightedScore - optB.weightedScore;
  // Beam rotation tilt in degrees
  const tiltAngle = Math.max(-12, Math.min(12, -delta * 1.5));

  const totalPoints = optA.weightedScore + optB.weightedScore || 1;
  const massRatioA = Number(((optA.weightedScore / totalPoints) * 100).toFixed(1));
  const massRatioB = Number(((optB.weightedScore / totalPoints) * 100).toFixed(1));

  return (
    <div className="p-4 sm:p-6 rounded-2xl sm:rounded-3xl bg-surface-card border border-border w-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-4 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-signal shrink-0" />
          <span className="text-xs font-mono font-bold uppercase text-slate-200 tracking-wider">
            Trade-off Torque Physics Scale
          </span>
        </div>
        <div className="text-xs font-mono text-slate-400">
          Tilt Delta: <strong className="text-signal">{delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)} pts</strong>
        </div>
      </div>

      {/* Responsive SVG Physics Visualization */}
      <div className="w-full max-w-[380px] mx-auto py-2 flex items-center justify-center overflow-hidden">
        <svg viewBox="0 0 380 150" className="w-full h-auto select-none overflow-visible">
          {/* Static Fulcrum Triangle */}
          <polygon
            points="190,75 178,115 202,115"
            fill="#1B202C"
            stroke="#3B4254"
            strokeWidth="1.5"
          />
          <line x1="150" y1="115" x2="230" y2="115" stroke="#3B4254" strokeWidth="2" strokeLinecap="round" />

          {/* Center Pivot Bolt */}
          <circle cx="190" cy="75" r="4" fill="#B8FF5A" stroke="#08090A" strokeWidth="1.5" />

          {/* Rotating Beam Assembly */}
          <motion.g
            animate={{ rotate: tiltAngle }}
            transition={{ type: 'spring', stiffness: 140, damping: 18 }}
            style={{ originX: '190px', originY: '75px' }}
          >
            {/* The Main Beam */}
            <rect
              x="50"
              y="72"
              width="280"
              height="6"
              rx="3"
              fill="#262B3B"
              stroke="#383F54"
              strokeWidth="1"
            />

            {/* Left Pan (Option A) Suspension */}
            <line x1="75" y1="75" x2="75" y2="95" stroke="#475569" strokeWidth="1.5" />
            <ellipse cx="75" cy="98" rx="26" ry="5" fill="#141720" stroke={optA.option.color} strokeWidth="1.5" />
            <rect
              x="62"
              y={98 - Math.min(24, Math.max(12, optA.weightedScore * 0.25))}
              width="26"
              height={Math.min(24, Math.max(12, optA.weightedScore * 0.25))}
              rx="4"
              fill={optA.option.color}
              fillOpacity="0.85"
            />
            <text
              x="75"
              y="120"
              textAnchor="middle"
              fill={optA.option.color}
              fontSize="10"
              fontFamily="var(--font-mono)"
              fontWeight="bold"
            >
              {optA.weightedScore} pts
            </text>

            {/* Right Pan (Option B) Suspension */}
            <line x1="305" y1="75" x2="305" y2="95" stroke="#475569" strokeWidth="1.5" />
            <ellipse cx="305" cy="98" rx="26" ry="5" fill="#141720" stroke={optB.option.color} strokeWidth="1.5" />
            <rect
              x="292"
              y={98 - Math.min(24, Math.max(12, optB.weightedScore * 0.25))}
              width="26"
              height={Math.min(24, Math.max(12, optB.weightedScore * 0.25))}
              rx="4"
              fill={optB.option.color}
              fillOpacity="0.85"
            />
            <text
              x="305"
              y="120"
              textAnchor="middle"
              fill={optB.option.color}
              fontSize="10"
              fontFamily="var(--font-mono)"
              fontWeight="bold"
            >
              {optB.weightedScore} pts
            </text>
          </motion.g>
        </svg>
      </div>

      {/* Physics Mass Metrics */}
      <div className="mt-4 p-3 rounded-xl bg-background/80 border border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-3.5 h-3.5 text-signal shrink-0" />
          <span className="text-slate-300">
            Torque distribution: <strong className="text-signal">{optA.option.name} ({massRatioA}%)</strong> vs{' '}
            <strong className="text-accent-cyan">{optB.option.name} ({massRatioB}%)</strong>
          </span>
        </div>

        <span className="text-[11px] font-mono text-slate-400">
          Net tilt moment: {Math.abs(tiltAngle).toFixed(1)}° {delta > 0 ? `towards ${optA.option.name}` : `towards ${optB.option.name}`}
        </span>
      </div>
    </div>
  );
};
