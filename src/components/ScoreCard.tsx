import React from 'react';
import { motion } from 'framer-motion';
import { Award, Check, AlertCircle } from 'lucide-react';
import type { OptionEvaluation } from '../types/decision';

interface ScoreCardProps {
  evaluation: OptionEvaluation;
  isLeader: boolean;
  totalOptions: number;
}

export const ScoreCard: React.FC<ScoreCardProps> = ({
  evaluation,
  isLeader,
}) => {
  const { option, weightedScore, rank, scoreDifferenceToLeader, contributions } = evaluation;

  return (
    <motion.div
      layout
      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
      className={`rounded-2xl p-5 sm:p-6 transition-all duration-300 relative border ${
        isLeader
          ? 'bg-gradient-to-b from-surface-card to-surface border-signal/50 shadow-glow-signal-sm ring-1 ring-signal/20'
          : 'bg-surface/60 border-border opacity-90 hover:opacity-100 hover:border-slate-600'
      }`}
    >
      {/* Top Header Badge & Rank */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: option.color }}
            />
            <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">
              {option.name}
            </h3>
          </div>
          <span className="text-xs text-slate-400 font-mono block mt-0.5">
            {option.badge}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {isLeader ? (
            <span className="px-2.5 py-1 rounded-md bg-signal text-background font-mono text-xs font-bold flex items-center gap-1 shadow-sm">
              <Award className="w-3.5 h-3.5" />
              <span>Rank #1</span>
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-md bg-surface-subtle border border-border text-slate-400 font-mono text-xs">
              Rank #{rank}
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-300 line-clamp-2 mb-4">
        {option.description}
      </p>

      {/* Big Score Indicator */}
      <div className="flex items-baseline justify-between p-3.5 rounded-xl bg-background/80 border border-border-subtle mb-5">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Calculated Score
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-extrabold font-mono text-white tracking-tight">
              {weightedScore.toFixed(1)}
            </span>
            <span className="text-xs font-mono text-slate-500">/ 100 max</span>
          </div>
        </div>

        {!isLeader && scoreDifferenceToLeader > 0 && (
          <div className="text-right">
            <span className="text-xs font-mono font-semibold text-accent-amber px-2 py-1 rounded bg-accent-amber/10 border border-accent-amber/20">
              -{scoreDifferenceToLeader.toFixed(1)} pts
            </span>
          </div>
        )}
      </div>

      {/* Progress Bar of Overall Score */}
      <div className="w-full h-2 bg-background rounded-full overflow-hidden mb-5 border border-border-subtle">
        <motion.div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(100, weightedScore)}%`,
            backgroundColor: isLeader ? '#B8FF5A' : option.color,
          }}
        />
      </div>

      {/* Criteria Breakdown Mini Table */}
      <div className="space-y-2 mb-5">
        <div className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">
          Criteria Score Breakdown
        </div>
        {contributions.map(item => (
          <div key={item.criterionId} className="text-xs">
            <div className="flex justify-between items-center text-slate-300 mb-1">
              <span className="truncate pr-2">{item.shortName}</span>
              <div className="flex items-center gap-1.5 font-mono text-[11px] shrink-0">
                <span className="text-slate-400">{item.rawScore}</span>
                <span className="text-slate-600">×</span>
                <span className="text-slate-400">{item.weight}%</span>
                <span className="text-slate-600">=</span>
                <span className="font-semibold text-white">+{item.weightedPoints.toFixed(1)}</span>
              </div>
            </div>
            <div className="w-full h-1 bg-background rounded-full overflow-hidden">
              <div
                className="h-full rounded-full opacity-80"
                style={{
                  width: `${item.rawScore}%`,
                  backgroundColor: option.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Strengths / Vulnerabilities Tags */}
      <div className="pt-3 border-t border-border-subtle space-y-1.5 text-xs">
        {option.strengths.slice(0, 1).map((s, idx) => (
          <div key={idx} className="flex items-center gap-1.5 text-slate-300">
            <Check className="w-3.5 h-3.5 text-signal shrink-0" />
            <span className="truncate">{s}</span>
          </div>
        ))}
        {option.vulnerabilities.slice(0, 1).map((v, idx) => (
          <div key={idx} className="flex items-center gap-1.5 text-slate-400">
            <AlertCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="truncate">{v}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
};
