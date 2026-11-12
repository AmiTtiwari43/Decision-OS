import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, Play, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { Criterion, Option } from '../types/decision';
import {
  runMonteCarloSimulation,
  type MonteCarloResult,
  type EngineOption,
  type EngineCriterion,
} from '@decision-os/decision-engine';
import { normalizeWeights } from '../utils/decisionEngine';
import { sound } from '../utils/audioFx';

interface MonteCarloTesterProps {
  criteria: Criterion[];
  options: Option[];
  weights: Record<string, number>;
  lockedIds?: string[];
  initialNoiseLevel?: number;
  initialSeed?: number;
}

export const MonteCarloTester: React.FC<MonteCarloTesterProps> = ({
  criteria,
  options,
  weights,
  lockedIds = [],
  initialNoiseLevel = 15,
  initialSeed = 42,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [noiseLevel, setNoiseLevel] = useState<number>(initialNoiseLevel);
  const [seed, setSeed] = useState<number>(initialSeed);

  const simulationResults = useMemo(() => {
    // Handle zero, one, or missing inputs safely without runtime errors
    if (!options || options.length < 2 || !criteria || criteria.length === 0) return null;

    // Strict validation: check that required scores exist and are finite numbers in [0, 100]
    for (const opt of options) {
      if (!opt.scores || typeof opt.scores !== 'object') return null;
      for (const c of criteria) {
        const val = opt.scores[c.id];
        if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 100) {
          return null;
        }
      }
    }

    const iterations = 1000;
    const sigmaRelative = noiseLevel / 100.0;

    const engineCriteria: EngineCriterion[] = criteria.map((c) => ({
      id: c.id,
      name: c.name,
      shortName: c.shortName,
      weight: Math.max(0, weights[c.id] ?? c.defaultWeight ?? 0),
      isLocked: lockedIds.includes(c.id),
    }));

    const engineOptions: EngineOption[] = options.map((o) => ({
      id: o.id,
      name: o.name,
      scores: o.scores,
    }));

    let baseNorm: Record<string, number>;
    try {
      baseNorm = normalizeWeights(weights, criteria, lockedIds);
    } catch {
      return null;
    }

    const mcResult: MonteCarloResult = runMonteCarloSimulation(
      engineOptions,
      engineCriteria,
      baseNorm,
      lockedIds,
      {
        iterations,
        seed,
        sigmaRelative,
      }
    );

    const optionsMap = new Map<string, Option>(options.map((o) => [o.id, o]));
    const PALETTE = ['#B8FF5A', '#38BDF8', '#F59E0B', '#FB7185', '#A78BFA', '#34D399', '#F472B6'];

    // Map all alternatives returned by simulation with colors and win probabilities
    const optionDistributions = mcResult.optionResults.map((r, idx) => {
      const opt = optionsMap.get(r.optionId);
      const color = opt?.color || PALETTE[idx % PALETTE.length];
      return {
        optionId: r.optionId,
        name: r.optionName,
        color,
        winCount: r.winCount,
        winProbability: r.winProbability,
      };
    });

    const totalProbability = Number(
      optionDistributions.reduce((sum, item) => sum + item.winProbability, 0).toFixed(1)
    );

    const isRobust = mcResult.robustnessRating === 'robust';

    // Correctly locate the dominant winner across all alternatives
    // Strictly preserve canonical engine truth: if dominantOptionId is null (e.g. tie), do NOT fall back to options[0]
    const dominantWinner = mcResult.dominantOptionId
      ? (options.find((o) => o.id === mcResult.dominantOptionId) ?? null)
      : null;
    const dominantPercentage = mcResult.dominantWinProbability;

    const optA = options[0];
    const optB = options[1];
    const resA = mcResult.optionResults.find((r) => r.optionId === optA?.id);
    const resB = mcResult.optionResults.find((r) => r.optionId === optB?.id);

    return {
      iterations,
      optionDistributions,
      totalProbability,
      isRobust,
      dominantWinner,
      dominantPercentage,
      robustnessRating: mcResult.robustnessRating,
      criterionStats: mcResult.criterionStats,
      seed,
      noiseLevel,
      winPercentA: resA ? resA.winProbability : 0,
      winPercentB: resB ? resB.winProbability : 0,
    };
  }, [criteria, options, weights, lockedIds, noiseLevel, seed]);

  const handleRunTest = () => {
    sound.playTick(900);
    setIsRunning(true);
    setSeed((prev) => (prev + 1) >>> 0);
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
        {/* Left 2 Cols: Distribution Bar & Win Rates for All Alternatives */}
        <div className="md:col-span-2 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono">
            {simulationResults.optionDistributions.map((opt) => (
              <div
                key={opt.optionId}
                className="flex items-center justify-between p-2 rounded-xl bg-surface/70 border border-border-subtle gap-2"
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: opt.color }}
                  />
                  <span className="text-slate-200 font-bold truncate">{opt.name}:</span>
                </div>
                <span className="font-extrabold text-sm shrink-0" style={{ color: opt.color }}>
                  {opt.winProbability}%
                </span>
              </div>
            ))}
          </div>

          {/* Multi-segment Probability Distribution Bar */}
          <div className="w-full h-4 bg-background rounded-full overflow-hidden flex p-0.5 border border-border-subtle shadow-inner">
            {simulationResults.optionDistributions.map((opt, idx) => (
              <motion.div
                key={opt.optionId}
                initial={{ width: 0 }}
                animate={{ width: `${opt.winProbability}%` }}
                transition={{ duration: 0.5 }}
                style={{ backgroundColor: opt.color }}
                className={`h-full ${idx === 0 ? 'rounded-l-full' : ''} ${
                  idx === simulationResults.optionDistributions.length - 1 ? 'rounded-r-full' : ''
                }`}
                title={`${opt.name}: ${opt.winProbability}%`}
              />
            ))}
          </div>

          {/* Distribution Totals & Rounding Notice */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] font-mono text-slate-400">
            <span>{`Total Distribution: ${simulationResults.totalProbability}% (±0.1% display rounding)`}</span>
            <span>Simulated with Mulberry32 PRNG</span>
          </div>

          {/* Noise Level Controls */}
          <div className="flex items-center justify-between pt-2 text-xs text-slate-400 border-t border-border-subtle">
            <span>{`Priority Fluctuation Noise (±${noiseLevel}%):`}</span>
            <div className="flex gap-1">
              {[10, 15, 25].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => {
                    sound.playTick();
                    setNoiseLevel(lvl);
                  }}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono cursor-pointer transition-colors ${
                    noiseLevel === lvl
                      ? 'bg-signal text-background font-bold'
                      : 'bg-surface text-slate-400 border border-border-subtle hover:text-white'
                  }`}
                >
                  {`±${lvl}%`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Col: Statistical Robustness Card */}
        <div className="p-4 rounded-2xl bg-surface/80 border border-border flex flex-col justify-between">
          <div className="flex items-center gap-2 text-xs font-mono uppercase text-slate-400">
            {simulationResults.dominantWinner && simulationResults.isRobust ? (
              <ShieldCheck className="w-4 h-4 text-signal" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-accent-amber" />
            )}
            <span>Empirical Robustness</span>
          </div>

          <div className="my-2">
            <div className="text-xl font-extrabold text-white">
              {!simulationResults.dominantWinner
                ? 'No Dominant Option'
                : simulationResults.isRobust
                ? 'High Confidence'
                : 'Moderate Sensitivity'}
            </div>
            {simulationResults.dominantWinner ? (
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                <strong className="text-white">{simulationResults.dominantWinner.name}</strong> maintains victory in{' '}
                <strong className="text-signal">{simulationResults.dominantPercentage}%</strong> of random priority fluctuations.
              </p>
            ) : (
              <p className="text-xs text-amber-300/90 mt-1 leading-relaxed">
                No single option dominates under priority noise. Leading alternatives share identical win rates ({simulationResults.dominantPercentage}%).
              </p>
            )}
          </div>

          <div className="pt-2 border-t border-border-subtle/50 text-[10px] font-mono text-slate-500">
            Canonical Mulberry32 Gaussian Monte Carlo (v1.0.0)
          </div>
        </div>
      </div>
    </div>
  );
};
