import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  BarChart3,
  RefreshCw,
  Loader2,
  AlertCircle,
  Sliders,
  Dices,
  BookOpen,
  Users,
  AlertTriangle,
  Scale,
  Check,
  TrendingUp,
  Shield,
  HelpCircle,
} from 'lucide-react';
import {
  apiClient,
  ApiClientError,
  type DecisionDto,
  type DecisionAnalyticsDto,
} from '../api/index.js';

export interface AnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  decision: DecisionDto | null;
}

type AnalyticsTab = 'overview' | 'options' | 'sensitivity' | 'uncertainty' | 'evidence' | 'deliberation';

export const AnalyticsModal: React.FC<AnalyticsModalProps> = ({
  isOpen,
  onClose,
  decision,
}) => {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview');
  const [data, setData] = useState<DecisionAnalyticsDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Monte Carlo simulation controls
  const [iterations, setIterations] = useState<number>(1000);
  const seed = 42;
  const sigmaRelative = 0.15;

  const fetchAnalytics = useCallback(async () => {
    if (!decision?._id) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await apiClient.getDecisionAnalytics(decision._id, {
        includeMonteCarlo: true,
        iterations,
        seed,
        sigmaRelative,
      });
      setData(res);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message || 'Failed to load decision analytics.');
      } else {
        setError('An unexpected error occurred while loading decision analytics.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [decision, iterations]);

  useEffect(() => {
    if (isOpen && decision?._id) {
      fetchAnalytics();
    }
  }, [isOpen, decision?._id, fetchAnalytics]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-5xl max-h-[92vh] bg-surface border border-border rounded-2xl shadow-glow-card flex flex-col overflow-hidden text-slate-100"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 sm:p-6 border-b border-border bg-surface-subtle/50 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-signal/10 border border-signal/20 flex items-center justify-center text-signal shrink-0">
                <BarChart3 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white truncate">
                    Advanced Analytics
                  </h2>
                  {data?.outcome === 'decisive' && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-signal/10 text-signal border border-signal/20">
                      DECISIVE
                    </span>
                  )}
                  {data?.outcome === 'tie' && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      TIED OUTCOME
                    </span>
                  )}
                  {data?.outcome === 'unscored' && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">
                      UNSCORED
                    </span>
                  )}
                  {data?.isAuthoritative && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center gap-1">
                      <Shield className="w-3 h-3" /> VERIFIED MCDA
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {decision?.title || 'Decision Analysis'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={fetchAnalytics}
                disabled={isLoading}
                className="p-2 rounded-lg bg-surface hover:bg-surface-hover border border-border text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh Analytics"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg bg-surface hover:bg-surface-hover border border-border text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1.5 p-2 px-4 sm:px-6 border-b border-border bg-surface-subtle/30 overflow-x-auto text-xs shrink-0 scrollbar-none">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'overview'
                  ? 'bg-signal/15 text-signal border border-signal/30'
                  : 'text-slate-400 hover:text-white hover:bg-surface-hover'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Overview
            </button>
            <button
              onClick={() => setActiveTab('options')}
              className={`px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'options'
                  ? 'bg-signal/15 text-signal border border-signal/30'
                  : 'text-slate-400 hover:text-white hover:bg-surface-hover'
              }`}
            >
              <Scale className="w-3.5 h-3.5" />
              Option & Criteria Matrix
            </button>
            <button
              onClick={() => setActiveTab('sensitivity')}
              className={`px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'sensitivity'
                  ? 'bg-signal/15 text-signal border border-signal/30'
                  : 'text-slate-400 hover:text-white hover:bg-surface-hover'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Sensitivity & Counterfactuals
            </button>
            <button
              onClick={() => setActiveTab('uncertainty')}
              className={`px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'uncertainty'
                  ? 'bg-signal/15 text-signal border border-signal/30'
                  : 'text-slate-400 hover:text-white hover:bg-surface-hover'
              }`}
            >
              <Dices className="w-3.5 h-3.5" />
              Uncertainty & Monte Carlo
            </button>
            <button
              onClick={() => setActiveTab('evidence')}
              className={`px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'evidence'
                  ? 'bg-signal/15 text-signal border border-signal/30'
                  : 'text-slate-400 hover:text-white hover:bg-surface-hover'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              Evidence Coverage
              {data && data.evidenceCoverage.missingEvidenceTargets.options.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-amber-400" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('deliberation')}
              className={`px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'deliberation'
                  ? 'bg-signal/15 text-signal border border-signal/30'
                  : 'text-slate-400 hover:text-white hover:bg-surface-hover'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Deliberation
            </button>
          </div>

          {/* Modal Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            {isLoading && !data && (
              <div className="py-20 flex flex-col items-center justify-center text-center">
                <Loader2 className="w-8 h-8 text-signal animate-spin mb-3" />
                <p className="text-sm font-medium text-slate-300">Computing analytics from authoritative engine data...</p>
                <p className="text-xs text-slate-500 mt-1">Evaluating sensitivity, Monte Carlo models, and evidence coverage</p>
              </div>
            )}

            {error && (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-start gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-rose-200">Unable to load analytics</h4>
                  <p className="text-xs text-rose-300 mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {data && (
              <>
                {/* 1. OVERVIEW TAB */}
                {activeTab === 'overview' && (
                  <div className="space-y-6">
                    {/* Top KPI Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                      <div className="p-4 rounded-xl bg-surface-subtle border border-border">
                        <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                          Leading Alternative
                        </div>
                        <div className="text-lg sm:text-xl font-bold text-white mt-1 truncate">
                          {data.winner ? data.winner.name : 'No Winner Yet'}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                          {data.pointLead > 0 ? (
                            <span className="text-signal font-mono font-semibold">+{data.pointLead} pts lead</span>
                          ) : (
                            <span className="text-slate-500">Tied or unscored</span>
                          )}
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-surface-subtle border border-border">
                        <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                          Uncertainty Robustness
                        </div>
                        <div className="text-lg sm:text-xl font-bold mt-1 capitalize flex items-center gap-1.5">
                          {data.uncertaintyAnalysis.robustnessRating === 'robust' && (
                            <span className="text-signal font-bold">Robust</span>
                          )}
                          {data.uncertaintyAnalysis.robustnessRating === 'moderate' && (
                            <span className="text-amber-400 font-bold">Moderate</span>
                          )}
                          {data.uncertaintyAnalysis.robustnessRating === 'sensitive' && (
                            <span className="text-rose-400 font-bold">Sensitive</span>
                          )}
                          {data.uncertaintyAnalysis.robustnessRating === 'unavailable' && (
                            <span className="text-slate-400">Unavailable</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 truncate">
                          {data.uncertaintyAnalysis.dominantWinProbability !== null
                            ? `${data.uncertaintyAnalysis.dominantWinProbability}% win probability`
                            : 'Requires complete matrix'}
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-surface-subtle border border-border">
                        <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                          Evidence Coverage
                        </div>
                        <div className="text-lg sm:text-xl font-bold text-white mt-1">
                          {data.evidenceCoverage.totalEvidenceCount} items
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          {data.evidenceCoverage.missingEvidenceTargets.options.length === 0
                            ? 'All options cited'
                            : `${data.evidenceCoverage.missingEvidenceTargets.options.length} options missing citations`}
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-surface-subtle border border-border">
                        <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                          Expert Deliberation
                        </div>
                        <div className="text-lg sm:text-xl font-bold text-white mt-1">
                          {data.expertParticipation.submittedCount} submissions
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          {data.expertParticipation.isRoundLocked ? 'Round locked' : 'Round open'}
                        </div>
                      </div>
                    </div>

                    {/* Criteria Weight Importance Breakdown */}
                    <div className="p-5 rounded-xl bg-surface-subtle/50 border border-border space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <Sliders className="w-4 h-4 text-signal" />
                          Criterion Weights & Relative Importance
                        </h3>
                        <span className="text-[11px] font-mono text-slate-400">
                          Sum: strictly 100.0%
                        </span>
                      </div>

                      <div className="space-y-3">
                        {data.criteriaImportance.map(crit => (
                          <div key={crit.id} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-200 flex items-center gap-1.5">
                                {crit.name}
                                {crit.isLocked && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                    LOCKED
                                  </span>
                                )}
                              </span>
                              <span className="font-mono text-slate-400">
                                {crit.weight}%
                              </span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-surface border border-border/80 overflow-hidden">
                              <div
                                className="h-full bg-signal rounded-full transition-all duration-300"
                                style={{ width: `${Math.min(100, Math.max(0, crit.weight))}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Quick Trade-off Summary Callout */}
                    {data.runnerUp && data.winner && (
                      <div className="p-4 rounded-xl bg-surface-subtle border border-border flex items-start gap-3">
                        <TrendingUp className="w-5 h-5 text-signal shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                            Primary Decision Trade-Off
                          </h4>
                          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                            <strong className="text-white">{data.winner.name}</strong> leads{' '}
                            <strong className="text-slate-300">{data.runnerUp.name}</strong> by{' '}
                            <span className="text-signal font-mono font-semibold">
                              {data.pointLead} points
                            </span>
                            . Check the <em className="text-slate-300 not-italic">Sensitivity & Counterfactuals</em> tab
                            to see what weight shifts or option score changes could reverse this outcome.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. OPTION & CRITERIA MATRIX TAB */}
                {activeTab === 'options' && (
                  <div className="space-y-6">
                    <div className="p-5 rounded-xl bg-surface-subtle border border-border space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <Scale className="w-4 h-4 text-signal" />
                          Ranked Alternatives & Score Breakdown
                        </h3>
                        <span className="text-xs text-slate-400">
                          Dual-precision canonical evaluation
                        </span>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-border text-slate-400 font-mono">
                              <th className="py-2.5 px-3">Rank</th>
                              <th className="py-2.5 px-3">Alternative</th>
                              <th className="py-2.5 px-3 text-right">Weighted Score</th>
                              <th className="py-2.5 px-3 text-right">Exact Score</th>
                              <th className="py-2.5 px-3">Criterion Contributions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {data.optionsPerformance.map(opt => (
                              <tr key={opt.id} className="hover:bg-surface/50">
                                <td className="py-3 px-3 font-mono font-bold">
                                  {opt.rank === 1 ? (
                                    <span className="text-signal flex items-center gap-1">
                                      #1 <Check className="w-3.5 h-3.5" />
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">#{opt.rank}</span>
                                  )}
                                </td>
                                <td className="py-3 px-3 font-semibold text-white">
                                  {opt.name}
                                </td>
                                <td className="py-3 px-3 text-right font-mono font-bold text-white">
                                  {opt.weightedScore.toFixed(1)}
                                </td>
                                <td className="py-3 px-3 text-right font-mono text-slate-400">
                                  {opt.unroundedScore.toFixed(3)}
                                </td>
                                <td className="py-3 px-3">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {opt.contributions.map(c => (
                                      <span
                                        key={c.criterionId}
                                        className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface border border-border text-slate-300"
                                        title={`${c.criterionName}: Raw ${c.rawScore} * Weight -> ${c.weightedPoints.toFixed(1)} pts (${c.percentageOfTotal.toFixed(1)}% of total)`}
                                      >
                                        {c.criterionName.substring(0, 8)}:{' '}
                                        <strong className="text-slate-200">{c.rawScore}</strong>
                                      </span>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. SENSITIVITY & COUNTERFACTUALS TAB */}
                {activeTab === 'sensitivity' && (
                  <div className="space-y-6">
                    {/* Multi-Parameter Counterfactual Card */}
                    <div className="p-5 rounded-xl bg-surface-subtle border border-border space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <Sliders className="w-4 h-4 text-signal" />
                          Multi-Parameter Counterfactual (Smallest Weight Shift)
                        </h3>
                        <span className="text-[11px] font-mono text-slate-400">
                          $L_1$ Norm Optimization
                        </span>
                      </div>

                      <p className="text-xs text-slate-400 leading-relaxed">
                        {data.sensitivityAnalysis.multiParameterCounterfactual.summary}
                      </p>

                      {data.sensitivityAnalysis.multiParameterCounterfactual.isFeasible && (
                        <div className="mt-3 p-3 rounded-lg bg-surface border border-border space-y-2">
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span>Minimal Weight Shift Required:</span>
                            <span className="font-mono text-signal font-bold">
                              {data.sensitivityAnalysis.multiParameterCounterfactual.netShiftAmount}% total weight
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                            {data.sensitivityAnalysis.multiParameterCounterfactual.shifts
                              .filter(s => Math.abs(s.delta) > 0.05)
                              .map(s => (
                                <div
                                  key={s.criterionId}
                                  className="p-2 rounded bg-surface-subtle border border-border/80 text-xs"
                                >
                                  <div className="text-slate-300 font-medium truncate">
                                    {s.criterionName}
                                  </div>
                                  <div className="flex items-center justify-between font-mono text-[11px] mt-1">
                                    <span className="text-slate-500">{s.currentWeight}%</span>
                                    <span
                                      className={
                                        s.delta > 0
                                          ? 'text-signal font-semibold'
                                          : 'text-rose-400 font-semibold'
                                      }
                                    >
                                      {s.delta > 0 ? `+${s.delta}%` : `${s.delta}%`}
                                    </span>
                                    <span className="text-white font-bold">{s.counterfactualWeight}%</span>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Single-Criterion Analytical Tipping Points */}
                    <div className="p-5 rounded-xl bg-surface-subtle border border-border space-y-4">
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Scale className="w-4 h-4 text-signal" />
                        Single-Criterion Analytical Tipping Points
                      </h3>
                      <p className="text-xs text-slate-400">
                        Exact weight threshold where a single unlocked criterion causes an outcome reversal.
                      </p>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-border text-slate-400 font-mono">
                              <th className="py-2.5 px-3">Criterion</th>
                              <th className="py-2.5 px-3">Current</th>
                              <th className="py-2.5 px-3">Tipping Weight</th>
                              <th className="py-2.5 px-3">Shift Needed</th>
                              <th className="py-2.5 px-3">Feasibility</th>
                              <th className="py-2.5 px-3">Overturning Option</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {data.sensitivityAnalysis.analyticalTippingPoints.map(tp => (
                              <tr key={tp.criterionId} className="hover:bg-surface/50">
                                <td className="py-2.5 px-3 font-semibold text-white">
                                  {tp.criterionName}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-300">
                                  {tp.currentWeight}%
                                </td>
                                <td className="py-2.5 px-3 font-mono font-bold text-white">
                                  {tp.tippingPointWeight !== null ? `${tp.tippingPointWeight}%` : '—'}
                                </td>
                                <td className="py-2.5 px-3 font-mono">
                                  {tp.weightDeltaNeeded !== null ? (
                                    <span className={tp.weightDeltaNeeded > 0 ? 'text-signal' : 'text-rose-400'}>
                                      {tp.weightDeltaNeeded > 0 ? `+${tp.weightDeltaNeeded}%` : `${tp.weightDeltaNeeded}%`}
                                    </span>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td className="py-2.5 px-3">
                                  {tp.feasibility === 'low-threshold' && (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/20">
                                      LOW THRESHOLD (≤15%)
                                    </span>
                                  )}
                                  {tp.feasibility === 'medium-threshold' && (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                      MEDIUM (≤35%)
                                    </span>
                                  )}
                                  {tp.feasibility === 'unreachable' && (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">
                                      UNREACHABLE
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-slate-300">
                                  {tp.wouldFlipToOptionName || 'None'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Option-Score Sensitivity */}
                    <div className="p-5 rounded-xl bg-surface-subtle border border-border space-y-4">
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-cyan-400" />
                        Option-Score Sensitivity (Raw Score Shift to Breakeven)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Shows the raw capability score shift needed on any single criterion to invert the lead.
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {data.sensitivityAnalysis.optionScoreSensitivity.map(oss => (
                          <div key={oss.criterionId} className="p-3 rounded-lg bg-surface border border-border space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-white">{oss.criterionName}</span>
                              <span className="font-mono text-[10px] text-slate-500">{oss.weight}% weight</span>
                            </div>
                            <div className="text-xs text-slate-300">
                              {oss.feasibility === 'feasible' ? (
                                <span className="font-mono font-bold text-cyan-400">
                                  ±{oss.scoreDeltaNeeded} pts needed
                                </span>
                              ) : (
                                <span className="text-slate-500">Score shift unreachable</span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400 leading-tight">
                              {oss.summary}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. UNCERTAINTY & MONTE CARLO TAB */}
                {activeTab === 'uncertainty' && (
                  <div className="space-y-6">
                    <div className="p-5 rounded-xl bg-surface-subtle border border-border space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <Dices className="w-4 h-4 text-signal" />
                            Gaussian Monte Carlo Robustness Simulation
                          </h3>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Seeded Mulberry32 PRNG testing weight volatility under Gaussian noise
                          </p>
                        </div>

                        <div className="flex items-center gap-2 text-xs">
                          <label className="text-slate-400">Iterations:</label>
                          <select
                            value={iterations}
                            onChange={e => setIterations(Number(e.target.value))}
                            className="bg-surface border border-border rounded px-2 py-1 text-slate-200 text-xs font-mono"
                          >
                            <option value={500}>500</option>
                            <option value={1000}>1,000</option>
                            <option value={5000}>5,000</option>
                          </select>
                          <button
                            onClick={fetchAnalytics}
                            disabled={isLoading}
                            className="px-2.5 py-1 rounded bg-signal/15 hover:bg-signal/25 text-signal font-semibold border border-signal/30 text-xs cursor-pointer"
                          >
                            Re-run
                          </button>
                        </div>
                      </div>

                      {/* Distribution Bars */}
                      <div className="space-y-4 pt-2">
                        {data.uncertaintyAnalysis.optionResults.map(opt => (
                          <div key={opt.optionId} className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-white flex items-center gap-2">
                                {opt.optionName}
                                {opt.optionId === data.uncertaintyAnalysis.dominantOptionId && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-signal/10 text-signal border border-signal/20">
                                    DOMINANT
                                  </span>
                                )}
                              </span>
                              <span className="font-mono font-bold text-white">
                                {opt.winProbability.toFixed(1)}%{' '}
                                <span className="text-[10px] text-slate-500 font-normal">
                                  ({opt.winCount} / {data.uncertaintyAnalysis.iterations} runs)
                                </span>
                              </span>
                            </div>
                            <div className="w-full h-3 rounded-full bg-surface border border-border overflow-hidden">
                              <div
                                className="h-full bg-signal rounded-full transition-all duration-300"
                                style={{ width: `${Math.min(100, Math.max(0, opt.winProbability))}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Strict Interpretation Note */}
                      <div className="p-3 rounded-lg bg-surface border border-border flex items-start gap-2.5 text-xs text-slate-400">
                        <HelpCircle className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                        <div>
                          <strong className="text-slate-200">Metric Interpretation Contract:</strong>{' '}
                          Win probability measures the percentage of simulated iterations won under the specified
                          Gaussian uncertainty model ($\sigma = {data.uncertaintyAnalysis.sigmaRelative}$, seed ={' '}
                          {data.uncertaintyAnalysis.seed}). In accordance with Decision OS principles, this metric is{' '}
                          <span className="text-white font-semibold">
                            never labeled as prediction accuracy or certainty of real-world outcomes
                          </span>
                          .
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. EVIDENCE COVERAGE TAB */}
                {activeTab === 'evidence' && (
                  <div className="space-y-6">
                    {/* Missing Evidence Indicators */}
                    {data.evidenceCoverage.missingEvidenceTargets.options.length > 0 && (
                      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 space-y-2">
                        <div className="flex items-center gap-2 font-bold text-amber-200">
                          <AlertTriangle className="w-4 h-4" />
                          Missing Evidence Detected on Alternatives
                        </div>
                        <p className="text-amber-300/90">
                          The following options do not have any attached citations, documentation, or evidence:
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {data.evidenceCoverage.missingEvidenceTargets.options.map(opt => (
                            <span
                              key={opt.id}
                              className="px-2 py-1 rounded bg-amber-500/20 text-amber-200 font-semibold text-[11px]"
                            >
                              {opt.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Coverage Matrix */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Option Coverage */}
                      <div className="p-4 rounded-xl bg-surface-subtle border border-border space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                          <span>Option Evidence Coverage</span>
                          <span className="font-mono text-slate-500">
                            {data.evidenceCoverage.optionsCoverage.filter(o => o.hasEvidence).length} /{' '}
                            {data.evidenceCoverage.optionsCoverage.length}
                          </span>
                        </h4>
                        <div className="space-y-2">
                          {data.evidenceCoverage.optionsCoverage.map(o => (
                            <div
                              key={o.optionId}
                              className="p-2.5 rounded-lg bg-surface border border-border flex items-center justify-between text-xs"
                            >
                              <span className="font-medium text-slate-200">{o.optionName}</span>
                              <span
                                className={`font-mono text-[11px] px-2 py-0.5 rounded ${
                                  o.hasEvidence
                                    ? 'bg-signal/15 text-signal font-semibold'
                                    : 'bg-rose-500/15 text-rose-300'
                                }`}
                              >
                                {o.evidenceCount} {o.evidenceCount === 1 ? 'citation' : 'citations'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Criteria Coverage */}
                      <div className="p-4 rounded-xl bg-surface-subtle border border-border space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                          <span>Criterion Evidence Coverage</span>
                          <span className="font-mono text-slate-500">
                            {data.evidenceCoverage.criteriaCoverage.filter(c => c.hasEvidence).length} /{' '}
                            {data.evidenceCoverage.criteriaCoverage.length}
                          </span>
                        </h4>
                        <div className="space-y-2">
                          {data.evidenceCoverage.criteriaCoverage.map(c => (
                            <div
                              key={c.criterionId}
                              className="p-2.5 rounded-lg bg-surface border border-border flex items-center justify-between text-xs"
                            >
                              <span className="font-medium text-slate-200">{c.criterionName}</span>
                              <span
                                className={`font-mono text-[11px] px-2 py-0.5 rounded ${
                                  c.hasEvidence
                                    ? 'bg-signal/15 text-signal font-semibold'
                                    : 'bg-rose-500/15 text-rose-300'
                                }`}
                              >
                                {c.evidenceCount} {c.evidenceCount === 1 ? 'citation' : 'citations'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Source Type Distribution */}
                    <div className="p-4 rounded-xl bg-surface-subtle border border-border space-y-2 text-xs">
                      <h4 className="font-bold text-slate-200">Source Types Distribution</h4>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2.5 rounded bg-surface border border-border text-center">
                          <div className="text-slate-400 text-[10px] uppercase">URLs</div>
                          <div className="text-base font-bold font-mono text-white mt-0.5">
                            {data.evidenceCoverage.bySourceType.url}
                          </div>
                        </div>
                        <div className="p-2.5 rounded bg-surface border border-border text-center">
                          <div className="text-slate-400 text-[10px] uppercase">Documents</div>
                          <div className="text-base font-bold font-mono text-white mt-0.5">
                            {data.evidenceCoverage.bySourceType.document}
                          </div>
                        </div>
                        <div className="p-2.5 rounded bg-surface border border-border text-center">
                          <div className="text-slate-400 text-[10px] uppercase">Excerpts</div>
                          <div className="text-base font-bold font-mono text-white mt-0.5">
                            {data.evidenceCoverage.bySourceType.excerpt}
                          </div>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500 pt-1 leading-relaxed">
                        {data.evidenceCoverage.methodologyDisclaimer}
                      </p>
                    </div>
                  </div>
                )}

                {/* 6. DELIBERATION TAB */}
                {activeTab === 'deliberation' && (
                  <div className="space-y-6">
                    <div className="p-5 rounded-xl bg-surface-subtle border border-border space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <Users className="w-4 h-4 text-signal" />
                          Expert Deliberation & Recommendations Tally
                        </h3>
                        <span className="text-xs text-slate-400">
                          Total: {data.expertParticipation.totalContributions} ({data.expertParticipation.submittedCount}{' '}
                          submitted)
                        </span>
                      </div>

                      {/* Preferred Option Tally */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold text-slate-300">Preferred Alternatives</h4>
                        {data.expertParticipation.recommendationTally.length === 0 ? (
                          <p className="text-xs text-slate-500 italic">No submitted expert recommendations yet.</p>
                        ) : (
                          data.expertParticipation.recommendationTally.map(rec => (
                            <div
                              key={rec.optionId}
                              className="p-3 rounded-lg bg-surface border border-border flex items-center justify-between text-xs"
                            >
                              <span className="font-semibold text-white">{rec.optionName}</span>
                              <span className="font-mono px-2 py-0.5 rounded bg-signal/15 text-signal font-bold">
                                {rec.count} {rec.count === 1 ? 'expert' : 'experts'}
                              </span>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Score Spreads per Criterion */}
                      <div className="space-y-2 pt-2">
                        <h4 className="text-xs font-semibold text-slate-300">
                          Criterion Score Spreads Across Experts
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b border-border text-slate-400 font-mono">
                                <th className="py-2 px-3">Criterion</th>
                                <th className="py-2 px-3 text-right">Min</th>
                                <th className="py-2 px-3 text-right">Max</th>
                                <th className="py-2 px-3 text-right">Average</th>
                                <th className="py-2 px-3 text-right">Range</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                              {data.expertParticipation.scoreSpreadByCriterion.map(sp => (
                                <tr key={sp.criterionId} className="hover:bg-surface/50">
                                  <td className="py-2 px-3 font-semibold text-white">{sp.criterionName}</td>
                                  <td className="py-2 px-3 text-right font-mono text-slate-400">
                                    {sp.minScore !== null ? sp.minScore : '—'}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono text-slate-400">
                                    {sp.maxScore !== null ? sp.maxScore : '—'}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono text-white font-bold">
                                    {sp.averageScore !== null ? sp.averageScore : '—'}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono text-cyan-400">
                                    {sp.scoreRange !== null ? `Δ ${sp.scoreRange}` : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-500 pt-1 leading-relaxed">
                        {data.expertParticipation.methodologyDisclaimer}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
