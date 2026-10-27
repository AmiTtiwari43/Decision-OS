import React, { useState } from 'react';
import { TrendingUp, Zap, Target } from 'lucide-react';
import type { Criterion, Option, SensitivityAnalysis } from '../types/decision';

interface SensitivityCurveProps {
  criteria: Criterion[];
  options: Option[];
  weights: Record<string, number>;
  sensitivity: SensitivityAnalysis[];
  onSelectWeight: (criterionId: string, weight: number) => void;
}

export const SensitivityCurve: React.FC<SensitivityCurveProps> = ({
  criteria,
  options,
  weights,
  sensitivity,
  onSelectWeight,
}) => {
  const [selectedCriterionId, setSelectedCriterionId] = useState<string>(criteria[1]?.id || criteria[0]?.id);

  if (options.length < 2) return null;

  const optA = options[0];
  const optB = options[1];
  const currentWeight = weights[selectedCriterionId] || 0;

  const criterion = criteria.find((c) => c.id === selectedCriterionId) || criteria[0];
  const sensItem = sensitivity.find((s) => s.criterionId === selectedCriterionId);

  let otherSumA = 0;
  let otherSumB = 0;
  let otherWeightSum = 0;

  criteria.forEach((c) => {
    if (c.id !== selectedCriterionId) {
      const w = weights[c.id] || 0;
      otherWeightSum += w;
      otherSumA += (optA.scores[c.id] || 50) * (w / 100);
      otherSumB += (optB.scores[c.id] || 50) * (w / 100);
    }
  });

  const calculateScoreAtWeight = (w: number, isA: boolean) => {
    const s_k = isA ? optA.scores[selectedCriterionId] || 50 : optB.scores[selectedCriterionId] || 50;
    const directPoints = (s_k * w) / 100;
    const scaleFactor = otherWeightSum > 0 ? (100 - w) / (100 - currentWeight || 1) : 1;
    const remainingPoints = (isA ? otherSumA : otherSumB) * scaleFactor;
    return directPoints + remainingPoints;
  };

  const width = 460;
  const height = 190;
  const padding = { top: 20, right: 25, bottom: 30, left: 35 };

  const graphW = width - padding.left - padding.right;
  const graphH = height - padding.top - padding.bottom;

  const yMin = 50;
  const yMax = 100;

  const getX = (w: number) => padding.left + (w / 100) * graphW;
  const getY = (score: number) => padding.top + graphH - ((score - yMin) / (yMax - yMin)) * graphH;

  const steps = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const pointsA = steps.map((w) => `${getX(w)},${getY(calculateScoreAtWeight(w, true))}`).join(' ');
  const pointsB = steps.map((w) => `${getX(w)},${getY(calculateScoreAtWeight(w, false))}`).join(' ');

  const currentX = getX(currentWeight);
  const currentScoreA = calculateScoreAtWeight(currentWeight, true);
  const currentScoreB = calculateScoreAtWeight(currentWeight, false);

  const tippingWeight = sensItem?.tippingPointWeight;
  const tippingX = tippingWeight ? getX(tippingWeight) : null;
  const tippingY = tippingWeight ? getY(calculateScoreAtWeight(tippingWeight, true)) : null;

  return (
    <div className="p-4 sm:p-6 rounded-2xl sm:rounded-3xl bg-surface-card border border-border w-full overflow-hidden">
      {/* Header & Criterion Selector Chips */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 mb-4 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-signal shrink-0" />
          <span className="text-xs font-mono font-bold uppercase text-slate-200 tracking-wider truncate">
            Continuous Breakeven Curve
          </span>
        </div>

        <div className="flex flex-wrap gap-1 max-w-full">
          {criteria.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCriterionId(c.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-all ${
                selectedCriterionId === c.id
                  ? 'bg-signal text-background font-bold shadow-sm'
                  : 'bg-surface-subtle text-slate-400 hover:text-slate-200 border border-border-subtle'
              }`}
            >
              {c.shortName}
            </button>
          ))}
        </div>
      </div>

      {/* SVG Sensitivity Curve with ViewBox */}
      <div className="w-full max-w-[460px] mx-auto flex justify-center overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto select-none overflow-visible"
        >
          {[60, 70, 80, 90, 100].map((score) => (
            <g key={score}>
              <line
                x1={padding.left}
                y1={getY(score)}
                x2={padding.left + graphW}
                y2={getY(score)}
                stroke="#1B202C"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <text
                x={padding.left - 6}
                y={getY(score)}
                textAnchor="end"
                dominantBaseline="central"
                fill="#64748B"
                fontSize="9"
                fontFamily="var(--font-mono)"
              >
                {score}
              </text>
            </g>
          ))}

          {[0, 25, 50, 75, 100].map((w) => (
            <g key={w}>
              <line
                x1={getX(w)}
                y1={padding.top + graphH}
                x2={getX(w)}
                y2={padding.top + graphH + 4}
                stroke="#3B4254"
                strokeWidth="1"
              />
              <text
                x={getX(w)}
                y={padding.top + graphH + 14}
                textAnchor="middle"
                fill="#64748B"
                fontSize="9"
                fontFamily="var(--font-mono)"
              >
                {w}%
              </text>
            </g>
          ))}

          <line
            x1={currentX}
            y1={padding.top}
            x2={currentX}
            y2={padding.top + graphH}
            stroke="#B8FF5A"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />

          <polyline
            points={pointsA}
            fill="none"
            stroke={optA.color}
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          <polyline
            points={pointsB}
            fill="none"
            stroke={optB.color}
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          <circle cx={currentX} cy={getY(currentScoreA)} r="4" fill={optA.color} stroke="#08090A" strokeWidth="2" />
          <circle cx={currentX} cy={getY(currentScoreB)} r="4" fill={optB.color} stroke="#08090A" strokeWidth="2" />

          {tippingX && tippingY && (
            <g>
              <circle
                cx={tippingX}
                cy={tippingY}
                r="6"
                fill="#F59E0B"
                stroke="#08090A"
                strokeWidth="2"
                className="animate-pulse"
              />
              <text
                x={Math.min(width - 90, tippingX + 8)}
                y={Math.max(15, tippingY - 8)}
                fill="#F59E0B"
                fontSize="10"
                fontFamily="var(--font-mono)"
                fontWeight="bold"
              >
                Tipping: {tippingWeight}%
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Dynamic Interpretation Bar */}
      <div className="mt-4 p-3 rounded-xl bg-background/80 border border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Target className="w-3.5 h-3.5 text-signal shrink-0" />
          <span className="text-slate-300">
            Active: <strong className="font-mono text-signal">{currentWeight}%</strong> ({criterion.name})
          </span>
        </div>

        {tippingWeight ? (
          <button
            onClick={() => onSelectWeight(selectedCriterionId, tippingWeight)}
            className="text-[11px] font-mono text-accent-amber hover:underline flex items-center gap-1 self-start sm:self-auto"
          >
            <Zap className="w-3 h-3" />
            <span>Apply Breakeven ({tippingWeight}%)</span>
          </button>
        ) : (
          <span className="text-[11px] font-mono text-slate-500">
            No single-criterion flip threshold in [0-100%]
          </span>
        )}
      </div>
    </div>
  );
};
