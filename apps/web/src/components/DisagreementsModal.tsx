import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  RefreshCw,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Scale,
  Sparkles,
  CheckCircle2,
  HelpCircle,
  Users,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  apiClient,
  ApiClientError,
  type DecisionDto,
  type DecisionDisagreementsDto,
  type DisagreementItemDto,
  type DisagreementResolutionStatus,
  type AiDisagreementExplanationDto,
} from '../api/index.js';

export interface DisagreementsModalProps {
  isOpen: boolean;
  onClose: () => void;
  decision: DecisionDto | null;
}

export const DisagreementsModal: React.FC<DisagreementsModalProps> = ({
  isOpen,
  onClose,
  decision,
}) => {
  const [data, setData] = useState<DecisionDisagreementsDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [criticalOnly, setCriticalOnly] = useState<boolean>(false);

  // AI Explanations cache: disagreementId -> AiDisagreementExplanationDto
  const [aiExplanations, setAiExplanations] = useState<Record<string, AiDisagreementExplanationDto>>({});
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);

  // Expanded items state: disagreementId -> boolean
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  // Resolution edit state: disagreementId -> { isEditing, status, explanation }
  const [resolutionForms, setResolutionForms] = useState<
    Record<string, { isEditing: boolean; status: DisagreementResolutionStatus; explanation: string }>
  >({});
  const [savingResolutionId, setSavingResolutionId] = useState<string | null>(null);

  const fetchDisagreements = useCallback(async () => {
    if (!decision?._id) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await apiClient.getDecisionDisagreements(decision._id);
      setData(res);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message || 'Failed to load disagreement intelligence.');
      } else {
        setError('An unexpected error occurred while loading disagreement intelligence.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [decision]);

  useEffect(() => {
    if (isOpen && decision?._id) {
      fetchDisagreements();
    }
  }, [isOpen, decision?._id, fetchDisagreements]);

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleRequestAiExplanation = async (disagreementId: string) => {
    if (!decision?._id || aiLoadingId) return;
    setAiLoadingId(disagreementId);

    try {
      const res = await apiClient.explainDisagreementWithAi(decision._id, disagreementId);
      setAiExplanations(prev => ({ ...prev, [disagreementId]: res }));
    } catch (err: unknown) {
      alert(err instanceof ApiClientError ? err.message : 'Failed to generate AI explanation.');
    } finally {
      setAiLoadingId(null);
    }
  };

  const handleStartResolutionEdit = (item: DisagreementItemDto) => {
    setResolutionForms(prev => ({
      ...prev,
      [item.id]: {
        isEditing: true,
        status: item.resolution?.status || 'acknowledged',
        explanation: item.resolution?.explanation || '',
      },
    }));
  };

  const handleSaveResolution = async (disagreementId: string) => {
    if (!decision?._id) return;
    const form = resolutionForms[disagreementId];
    if (!form) return;

    setSavingResolutionId(disagreementId);
    try {
      await apiClient.updateDisagreementResolution(decision._id, disagreementId, {
        status: form.status,
        resolutionExplanation: form.explanation,
      });

      // Update local state
      setData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          items: prev.items.map(it => {
            if (it.id === disagreementId) {
              return {
                ...it,
                resolution: {
                  ...it.resolution,
                  status: form.status,
                  explanation: form.explanation,
                },
              };
            }
            return it;
          }),
        };
      });

      setResolutionForms(prev => ({
        ...prev,
        [disagreementId]: { ...form, isEditing: false },
      }));
    } catch (err: unknown) {
      alert(err instanceof ApiClientError ? err.message : 'Failed to update resolution.');
    } finally {
      setSavingResolutionId(null);
    }
  };

  if (!isOpen) return null;

  // Filter items
  const filteredItems = (data?.items ?? []).filter(item => {
    if (categoryFilter !== 'all' && item.category !== categoryFilter) {
      return false;
    }
    if (criticalOnly && !item.isDecisionCritical) {
      return false;
    }
    return true;
  });

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
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                <Scale className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white truncate">
                    Disagreement Intelligence
                  </h2>
                  {data && data.decisionCriticalCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/20 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {data.decisionCriticalCount} DECISION-CRITICAL
                    </span>
                  )}
                  {data && data.hasSufficientData && data.decisionCriticalCount === 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-signal/10 text-signal border border-signal/20 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> WINNER ROBUST
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {decision?.title || 'Decision Deliberation Analysis'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={fetchDisagreements}
                disabled={isLoading}
                className="p-2 rounded-lg bg-surface hover:bg-surface-hover border border-border text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh Disagreements"
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

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            {isLoading && !data && (
              <div className="py-20 flex flex-col items-center justify-center text-center">
                <Loader2 className="w-8 h-8 text-signal animate-spin mb-3" />
                <p className="text-sm font-medium text-slate-300">Analyzing participant disagreements...</p>
              </div>
            )}

            {error && (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-start gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-rose-200">Unable to load disagreement intelligence</h4>
                  <p className="text-xs text-rose-300 mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {data && !data.hasSufficientData && (
              <div className="py-16 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-surface-subtle border border-border flex items-center justify-center text-slate-500 mx-auto">
                  <Users className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-white">Insufficient Deliberation Data</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  {data.summary} Invite collaborators to contribute expert scores and recommendations to unlock
                  disagreement detection, score dispersion calculus, and scenario sensitivity analysis.
                </p>
              </div>
            )}

            {data && data.hasSufficientData && (
              <div className="space-y-6">
                {/* KPI Overview Banner */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-4 rounded-xl bg-surface-subtle border border-border">
                    <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      Total Disagreements
                    </div>
                    <div className="text-xl sm:text-2xl font-bold font-mono text-white mt-1">
                      {data.totalDisagreements}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      Across {data.totalContributors} expert contributors
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-surface-subtle border border-border">
                    <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      Decision-Critical
                    </div>
                    <div
                      className={`text-xl sm:text-2xl font-bold font-mono mt-1 ${
                        data.decisionCriticalCount > 0 ? 'text-rose-400' : 'text-signal'
                      }`}
                    >
                      {data.decisionCriticalCount}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      {data.decisionCriticalCount > 0 ? 'Flips or threatens winner' : 'Invariant to spread'}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-surface-subtle border border-border">
                    <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      Resolved / Acknowledged
                    </div>
                    <div className="text-xl sm:text-2xl font-bold font-mono text-cyan-400 mt-1">
                      {data.items.filter(i => i.resolution.status !== 'open').length} / {data.totalDisagreements}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">Human governance tracked</div>
                  </div>

                  <div className="p-4 rounded-xl bg-surface-subtle border border-border">
                    <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      Preferred Options Split
                    </div>
                    <div className="text-xl sm:text-2xl font-bold font-mono text-purple-400 mt-1">
                      {data.priorityBreakdown.length}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">Distinct recommended alternatives</div>
                  </div>
                </div>

                {/* Priority Breakdown Card (if multiple options recommended) */}
                {data.priorityBreakdown.length > 1 && (
                  <div className="p-4 rounded-xl bg-surface-subtle border border-border space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                      <span>Conflicting Preferred Alternatives (Priority Disagreement)</span>
                      <span className="font-mono text-purple-400 font-semibold">
                        {data.priorityBreakdown.length} Alternatives Favored
                      </span>
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {data.priorityBreakdown.map(p => (
                        <div key={p.optionId} className="p-3 rounded-lg bg-surface border border-border text-xs">
                          <div className="flex items-center justify-between font-semibold text-white">
                            <span>{p.optionName}</span>
                            <span className="font-mono text-purple-400">{p.percentage}%</span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1">
                            {p.recommendationCount} {p.recommendationCount === 1 ? 'expert' : 'experts'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Filter Bar */}
                <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-b border-border pb-3">
                  <div className="flex items-center gap-1.5 flex-wrap text-xs">
                    {(['all', 'score', 'priority', 'interpretation', 'assumption', 'evidence'] as const).map(cat => (
                      <button
                        key={cat}
                        onClick={() => setCategoryFilter(cat)}
                        className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer capitalize ${
                          categoryFilter === cat
                            ? 'bg-signal/15 text-signal border border-signal/30'
                            : 'text-slate-400 hover:text-white hover:bg-surface-hover'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={criticalOnly}
                      onChange={e => setCriticalOnly(e.target.checked)}
                      className="rounded bg-surface border-border text-rose-500 focus:ring-rose-500"
                    />
                    <span>Decision-Critical Only</span>
                  </label>
                </div>

                {/* Disagreement Items List */}
                <div className="space-y-4">
                  {filteredItems.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-500 italic">
                      No disagreements match the selected category filter.
                    </div>
                  ) : (
                    filteredItems.map(item => {
                      const isExpanded = !!expandedItems[item.id];
                      const aiExp = aiExplanations[item.id];
                      const isAiLoading = aiLoadingId === item.id;
                      const resForm = resolutionForms[item.id];

                      return (
                        <div
                          key={item.id}
                          className={`rounded-xl border transition-all ${
                            item.isDecisionCritical
                              ? 'bg-surface border-rose-500/30 shadow-sm'
                              : 'bg-surface-subtle border-border'
                          }`}
                        >
                          {/* Card Header */}
                          <div className="p-4 sm:p-5 flex items-start justify-between gap-3 flex-wrap">
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                                    item.category === 'score'
                                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                                      : item.category === 'priority'
                                      ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                                      : item.category === 'interpretation'
                                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                      : 'bg-slate-500/10 text-slate-300 border border-slate-500/20'
                                  }`}
                                >
                                  {item.category}
                                </span>

                                {item.isDecisionCritical && (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" /> DECISION-CRITICAL
                                  </span>
                                )}

                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                                    item.resolution.status === 'resolved'
                                      ? 'bg-signal/15 text-signal border border-signal/30'
                                      : item.resolution.status === 'acknowledged'
                                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                      : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                                  }`}
                                >
                                  {item.resolution.status.toUpperCase()}
                                </span>
                              </div>

                              <h4 className="text-sm font-bold text-white pt-1">{item.title}</h4>
                              <p className="text-xs text-slate-400">{item.description}</p>
                            </div>

                            <button
                              onClick={() => toggleExpand(item.id)}
                              className="p-1.5 rounded-lg bg-surface-hover hover:bg-surface border border-border text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0"
                              title={isExpanded ? 'Collapse' : 'Expand'}
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </div>

                          {/* Numerical Explanation Box */}
                          <div className="px-4 sm:px-5 pb-3">
                            <div className="p-3 rounded-lg bg-surface-subtle/80 border border-border/80 text-xs font-mono text-slate-300 leading-relaxed">
                              {item.numericalExplanation}
                            </div>
                          </div>

                          {/* Expanded Content */}
                          {isExpanded && (
                            <div className="px-4 sm:px-5 pb-5 space-y-4 border-t border-border pt-4">
                              {/* Statistical Metrics Table (if score disagreement) */}
                              {item.scoreMetrics && (
                                <div className="space-y-2">
                                  <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                    Dispersion Calculus & Counterfactual Scenarios
                                  </h5>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                    <div className="p-2.5 rounded bg-surface border border-border text-center">
                                      <div className="text-[10px] font-mono text-slate-400">Score Range (Δ)</div>
                                      <div className="text-base font-bold font-mono text-white mt-0.5">
                                        {item.scoreMetrics.scoreRange} pts
                                      </div>
                                    </div>
                                    <div className="p-2.5 rounded bg-surface border border-border text-center">
                                      <div className="text-[10px] font-mono text-slate-400">Sample Std Dev (s)</div>
                                      <div className="text-base font-bold font-mono text-white mt-0.5">
                                        ±{item.scoreMetrics.sampleStdDev} pts
                                      </div>
                                    </div>
                                    <div className="p-2.5 rounded bg-surface border border-border text-center">
                                      <div className="text-[10px] font-mono text-slate-400">Median Score</div>
                                      <div className="text-base font-bold font-mono text-white mt-0.5">
                                        {item.scoreMetrics.medianScore} pts
                                      </div>
                                    </div>
                                    <div className="p-2.5 rounded bg-surface border border-border text-center">
                                      <div className="text-[10px] font-mono text-slate-400">Confidence-Weighted</div>
                                      <div className="text-base font-bold font-mono text-signal mt-0.5">
                                        {item.scoreMetrics.confidenceWeightedMean} pts
                                      </div>
                                    </div>
                                  </div>

                                  {/* Scenarios Flip Status */}
                                  <div className="p-2.5 rounded bg-surface border border-border flex items-center justify-between text-xs flex-wrap gap-2">
                                    <span className="text-slate-400">Deterministic Expert Scenarios:</span>
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                                          item.scoreMetrics.scenarioResults.minScenarioWinnerFlips
                                            ? 'bg-rose-500/15 text-rose-300 font-bold'
                                            : 'bg-signal/15 text-signal'
                                        }`}
                                      >
                                        Min Score: {item.scoreMetrics.scenarioResults.minScenarioWinnerFlips ? 'Flips Winner' : 'Safe'}
                                      </span>
                                      <span
                                        className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                                          item.scoreMetrics.scenarioResults.maxScenarioWinnerFlips
                                            ? 'bg-rose-500/15 text-rose-300 font-bold'
                                            : 'bg-signal/15 text-signal'
                                        }`}
                                      >
                                        Max Score: {item.scoreMetrics.scenarioResults.maxScenarioWinnerFlips ? 'Flips Winner' : 'Safe'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Participant Breakdown */}
                              {item.participants.length > 0 && (
                                <div className="space-y-2">
                                  <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                    Participant Perspectives
                                  </h5>
                                  <div className="space-y-1.5">
                                    {item.participants.map((p, idx) => (
                                      <div
                                        key={idx}
                                        className="p-3 rounded-lg bg-surface border border-border text-xs flex items-start justify-between gap-3 flex-wrap"
                                      >
                                        <div>
                                          <div className="font-semibold text-white">
                                            {p.contributorName || `Participant ${p.contributorId.substring(0, 6)}`}
                                          </div>
                                          {p.reasoning && (
                                            <p className="text-[11px] text-slate-400 mt-1 italic">
                                              &ldquo;{p.reasoning}&rdquo;
                                            </p>
                                          )}
                                        </div>
                                        <div className="text-right font-mono">
                                          <span className="font-bold text-white px-2 py-0.5 rounded bg-surface-subtle border border-border">
                                            {p.value}
                                          </span>
                                          {p.confidence !== undefined && (
                                            <div className="text-[10px] text-slate-500 mt-1">
                                              {Math.round(p.confidence * 100)}% confidence
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* AI Explanation / Mediation Section */}
                              <div className="p-3.5 rounded-lg bg-surface border border-signal/20 space-y-2.5">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 text-xs font-bold text-signal">
                                    <Sparkles className="w-3.5 h-3.5" />
                                    <span>AI Neutral Mediation & Clarification Questions</span>
                                  </div>
                                  {!aiExp && (
                                    <button
                                      onClick={() => handleRequestAiExplanation(item.id)}
                                      disabled={isAiLoading}
                                      className="px-2.5 py-1 rounded bg-signal/15 hover:bg-signal/25 text-signal border border-signal/30 text-xs font-semibold cursor-pointer disabled:opacity-50 flex items-center gap-1"
                                    >
                                      {isAiLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                                      Explain with AI
                                    </button>
                                  )}
                                </div>

                                {aiExp ? (
                                  <div className="space-y-2 text-xs text-slate-300">
                                    <p className="leading-relaxed">{aiExp.neutralSummary}</p>

                                    {aiExp.suggestedClarificationQuestions.length > 0 && (
                                      <div className="space-y-1 pt-1">
                                        <span className="font-semibold text-slate-200">
                                          Suggested Clarification Questions:
                                        </span>
                                        <ul className="list-disc list-inside space-y-1 text-slate-400 pl-1">
                                          {aiExp.suggestedClarificationQuestions.map((q, qIdx) => (
                                            <li key={qIdx}>{q}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    <div className="text-[10px] text-slate-500 pt-1 italic">{aiExp.disclaimer}</div>
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <span className="text-[11px] font-semibold text-slate-400">
                                      Default Clarification Prompts:
                                    </span>
                                    <ul className="list-disc list-inside space-y-0.5 text-xs text-slate-400 pl-1">
                                      {item.suggestedClarificationQuestions.map((q, qIdx) => (
                                        <li key={qIdx}>{q}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>

                              {/* Governance Resolution Workflow */}
                              <div className="p-3.5 rounded-lg bg-surface border border-border space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                                    <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
                                    <span>Governance Resolution State</span>
                                  </div>

                                  {!resForm?.isEditing && (
                                    <button
                                      onClick={() => handleStartResolutionEdit(item)}
                                      className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
                                    >
                                      Update Resolution
                                    </button>
                                  )}
                                </div>

                                {resForm?.isEditing ? (
                                  <div className="space-y-2.5 pt-1 text-xs">
                                    <div className="flex items-center gap-2">
                                      <label className="text-slate-400">Status:</label>
                                      <select
                                        value={resForm.status}
                                        onChange={e =>
                                          setResolutionForms(prev => ({
                                            ...prev,
                                            [item.id]: {
                                              ...prev[item.id],
                                              status: e.target.value as DisagreementResolutionStatus,
                                            },
                                          }))
                                        }
                                        className="bg-surface-subtle border border-border rounded px-2.5 py-1 text-slate-200 text-xs"
                                      >
                                        <option value="open">Open (Unresolved)</option>
                                        <option value="acknowledged">Acknowledged (Noted)</option>
                                        <option value="resolved">Resolved (Consensus / Decided)</option>
                                      </select>
                                    </div>

                                    <div>
                                      <label className="text-slate-400 block mb-1">
                                        Resolution Explanation / Consensus Notes:
                                      </label>
                                      <textarea
                                        value={resForm.explanation}
                                        onChange={e =>
                                          setResolutionForms(prev => ({
                                            ...prev,
                                            [item.id]: { ...prev[item.id], explanation: e.target.value },
                                          }))
                                        }
                                        rows={2}
                                        placeholder="Record how this disagreement was addressed or why this variance is acceptable..."
                                        className="w-full bg-surface-subtle border border-border rounded-lg p-2 text-slate-200 text-xs focus:ring-1 focus:ring-signal outline-none"
                                      />
                                    </div>

                                    <div className="flex items-center gap-2 justify-end">
                                      <button
                                        onClick={() =>
                                          setResolutionForms(prev => ({
                                            ...prev,
                                            [item.id]: { ...prev[item.id], isEditing: false },
                                          }))
                                        }
                                        className="px-2.5 py-1 rounded bg-surface hover:bg-surface-hover border border-border text-slate-400 text-xs cursor-pointer"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => handleSaveResolution(item.id)}
                                        disabled={savingResolutionId === item.id}
                                        className="px-3 py-1 rounded bg-signal/15 hover:bg-signal/25 text-signal border border-signal/30 font-semibold text-xs cursor-pointer disabled:opacity-50 flex items-center gap-1"
                                      >
                                        {savingResolutionId === item.id && <Loader2 className="w-3 h-3 animate-spin" />}
                                        Save Resolution
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-xs text-slate-300">
                                    {item.resolution.explanation ? (
                                      <p className="italic text-slate-400">&ldquo;{item.resolution.explanation}&rdquo;</p>
                                    ) : (
                                      <p className="text-slate-500 italic">No resolution explanation recorded.</p>
                                    )}
                                    {item.resolution.resolvedByName && (
                                      <div className="text-[10px] text-slate-500 mt-1">
                                        Updated by {item.resolution.resolvedByName} on{' '}
                                        {item.resolution.resolvedAt
                                          ? new Date(item.resolution.resolvedAt).toLocaleDateString()
                                          : 'recently'}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
