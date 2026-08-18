import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, Play, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { Criterion, Option } from '../types/decision';
import { normalizeWeights, evaluateOption } from '../utils/decisionEngine';
import { sound } from '../utils/audioFx';

interface MonteCarloTesterProps {
  criteria: Criterion[];
  options: Option[];
  weights: Record<string, number>;
}

export const MonteCarloTester: React.FC<MonteCarloTesterProps> = ({
  criteria,
  options,
  weights,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [noiseLevel, setNoiseLevel] = useState<number>(15);

  const simulationResults = useMemo(() => {
    if (options.length < 2) return null;

    const iterations = 1000;
    const winCounts: Record<string, number> = {};
    options.forEach((o) => (winCounts[o.id] = 0));

    const alphaScores: number[] = [];
    const betaScores: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const perturbed: Record<string, number> = {};
      criteria.forEach((c) => {
        const base = weights[c.id] || 20;
        const delta = (Math.random() * 2 - 1) * noiseLevel;
        perturbed[c.id] = Math.max(1, base + delta);
      });

      const norm = normalizeWeights(perturbed, criteria);

      const evals = options.map((opt) => evaluateOption(opt, criteria, norm));
      evals.sort((a, b) => b.weightedScore - a.weightedScore);

      const winId = evals[0].option.id;
      winCounts[winId] = (winCounts[winId] || 0) + 1;

      if (options[0]) alphaScores.push(evals.find((e) => e.option.id === options[0].id)?.weightedScore || 0);
      if (options[1]) betaScores.push(evals.find((e) => e.option.id === options[1].id)?.weightedScore || 0);
    }

    const optA = options[0];
    const optB = options[1];

    const winPercentA = Number(((winCounts[optA.id] / iterations) * 100).toFixed(1));
    const winPercentB = Number(((winCounts[optB.id] / iterations) * 100).toFixed(1));

    const isRobust = winPercentA > 70 || winPercentB > 70;

    return {
      iterations,
      winCounts,
      winPercentA,
      winPercentB,
      isRobust,
      dominantWinner: winPercentA >= winPercentB ? optA : optB,
      dominantPercentage: Math.max(winPercentA, winPercentB),
    };
  }, [criteria, options, weights, noiseLevel]);

  const handleRunTest = () => {
    sound.playTick(900);
    setIsRunning(true);
    setTimeout(() => {
      sound.playCelebrate();
      setIsRunning(false);
    }, 400);
  };

  if (!simulationResults) return null;

  return (
    <div className="rounded-3xl p-6 sm:p-8 bg-surface-card border border-border">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 mb-6 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-surface border border-border text-signal">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-bold text-white">
                Monte Carlo Decision Stress-Tester
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-signal/15 text-signal font-semibold border border-signal/20">
                1,000 Iterations
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Simulates randomized priority noise to measure empirical decision confidence.
            </p>
          </div>
        </div>

        <button
          onClick={handleRunTest}
          disabled={isRunning}
          className="px-4 py-2 rounded-xl bg-signal hover:bg-signal-light text-background font-bold text-xs font-mono flex items-center justify-center gap-2 transition-all shadow-glow-signal-sm shrink-0"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{isRunning ? 'Simulating...' : 'Rerun 1,000 Passes'}</span>
        </button>
      </div>

      {/* Main Results Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
        {/* Left 2 Cols: Distribution Bar & Win Rates */}
        <div className="md:col-span-2 space-y-4">
          <div className="flex justify-between items-baseline text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: options[0]?.color }} />
              <span className="text-slate-200 font-bold">{options[0]?.name}:</span>
              <span className="text-signal font-extrabold text-sm">{simulationResults.winPercentA}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-accent-cyan font-extrabold text-sm">{simulationResults.winPercentB}%</span>
              <span className="text-slate-200 font-bold">:{options[1]?.name}</span>
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: options[1]?.color }} />
            </div>
          </div>

          {/* Probability Distribution Bar */}
          <div className="w-full h-4 bg-background rounded-full overflow-hidden flex p-0.5 border border-border-subtle shadow-inner">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${simulationResults.winPercentA}%` }}
              transition={{ duration: 0.5 }}
              className="h-full rounded-l-full bg-signal shadow-glow-signal-sm"
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${simulationResults.winPercentB}%` }}
              transition={{ duration: 0.5 }}
              className="h-full rounded-r-full bg-accent-cyan"
            />
          </div>

          {/* Noise Level Slider */}
          <div className="flex items-center justify-between pt-2 text-xs text-slate-400">
            <span>Priority Fluctuation Noise (±{noiseLevel}%):</span>
            <div className="flex gap-1">
              {[10, 15, 25].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => {
                    sound.playTick();
                    setNoiseLevel(lvl);
                  }}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono ${
                    noiseLevel === lvl
                      ? 'bg-signal text-background font-bold'
                      : 'bg-surface text-slate-400 border border-border-subtle hover:text-white'
                  }`}
                >
                  ±{lvl}%
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Col: Statistical Robustness Card */}
        <div className="p-4 rounded-2xl bg-surface/80 border border-border flex flex-col justify-between">
          <div className="flex items-center gap-2 text-xs font-mono uppercase text-slate-400">
            {simulationResults.isRobust ? (
              <ShieldCheck className="w-4 h-4 text-signal" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-accent-amber" />
            )}
            <span>Empirical Robustness</span>
          </div>

          <div className="my-2">
            <div className="text-xl font-extrabold text-white">
              {simulationResults.isRobust ? 'High Confidence' : 'Moderate Sensitivity'}
            </div>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              {simulationResults.dominantWinner.name} maintains victory in{' '}
              <strong>{simulationResults.dominantPercentage}%</strong> of random priority fluctuations.
            </p>
          </div>

          <div className="pt-2 border-t border-border-subtle/50 text-[10px] font-mono text-slate-500">
            Standard Gaussian Multi-Criteria Monte Carlo
          </div>
        </div>
      </div>
    </div>
  );
};
