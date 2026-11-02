import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Sparkles,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Plus,
  Scale,
  Brain,
  FileQuestion,
  Layers,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import {
  apiClient,
  ApiClientError,
  type DecisionDto,
  type AiCapability,
  type AiAnalystResponseDto,
  type AiCriterionProposal,
} from '../api/index.js';

export interface AiAnalystModalProps {
  isOpen: boolean;
  onClose: () => void;
  decision: DecisionDto | null;
  onDecisionUpdated?: (updated: DecisionDto) => void;
}

export const AiAnalystModal: React.FC<AiAnalystModalProps> = ({
  isOpen,
  onClose,
  decision,
  onDecisionUpdated,
}) => {
  const [capability, setCapability] = useState<AiCapability>('all');
  const [analysis, setAnalysis] = useState<AiAnalystResponseDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isUnavailable, setIsUnavailable] = useState<boolean>(false);
  const [adoptingCriterionId, setAdoptingCriterionId] = useState<string | null>(null);
  const [adoptSuccess, setAdoptSuccess] = useState<string | null>(null);

  const activeRequestIdRef = useRef<number>(0);
  const activeDecisionIdRef = useRef<string | null>(null);

  const currentUserRole = decision?.currentUserRole || 'owner';
  const canEdit = currentUserRole === 'owner' || currentUserRole === 'editor';

  const fetchAnalysis = useCallback(
    async (cap: AiCapability) => {
      if (!decision?._id) return;
      const targetDecisionId = decision._id;
      const requestId = ++activeRequestIdRef.current;

      setIsLoading(true);
      setError(null);
      setIsUnavailable(false);
      setAdoptSuccess(null);

      try {
        const result = await apiClient.runAiAnalysis(targetDecisionId, cap);
        if (
          activeRequestIdRef.current === requestId &&
          activeDecisionIdRef.current === targetDecisionId
        ) {
          setAnalysis(result);
        }
      } catch (err: unknown) {
        if (
          activeRequestIdRef.current === requestId &&
          activeDecisionIdRef.current === targetDecisionId
        ) {
          if (err instanceof ApiClientError) {
            if (err.statusCode === 503) {
              setIsUnavailable(true);
              setError(err.message || 'AI Analyst provider is not configured or offline.');
            } else if (err.statusCode === 504) {
              setError('AI Analyst request timed out. Please try again.');
            } else if (err.statusCode === 429) {
              setError('AI rate limit reached. Please wait a moment and try again.');
            } else {
              setError(err.message || 'Failed to generate AI analysis.');
            }
          } else {
            setError('An unexpected error occurred while communicating with the AI Analyst.');
          }
        }
      } finally {
        if (
          activeRequestIdRef.current === requestId &&
          activeDecisionIdRef.current === targetDecisionId
        ) {
          setIsLoading(false);
        }
      }
    },
    [decision?._id]
  );

  // Explicitly reset all cached analysis, proposals, loading, and errors on decision ID change or modal close/open
  useEffect(() => {
    activeDecisionIdRef.current = decision?._id || null;
    activeRequestIdRef.current++;
    setAnalysis(null);
    setError(null);
    setIsUnavailable(false);
    setAdoptSuccess(null);
    setAdoptingCriterionId(null);
    setIsLoading(false);
  }, [decision?._id, isOpen]);

  useEffect(() => {
    if (isOpen && decision?._id && !analysis && !isLoading && !error) {
      fetchAnalysis('all');
    }
  }, [isOpen, decision?._id, analysis, isLoading, error, fetchAnalysis]);

  const handleTabChange = (cap: AiCapability) => {
    setCapability(cap);
    fetchAnalysis(cap);
  };

  const handleAdoptCriterion = async (proposal: AiCriterionProposal) => {
    if (!decision?._id || !canEdit) return;
    setAdoptingCriterionId(proposal.id);
    setError(null);
    setAdoptSuccess(null);

    try {
      const updated = await apiClient.applyAiProposal(decision._id, {
        type: 'add_criterion',
        criterion: {
          id: proposal.id,
          name: proposal.name,
          weight: proposal.suggestedWeight,
          direction: proposal.direction,
          isLocked: false,
        },
      });

      if (onDecisionUpdated) {
        onDecisionUpdated(updated);
      }
      setAdoptSuccess(`Criterion "${proposal.name}" successfully adopted! Scores must be entered to re-evaluate MCDA calculations.`);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to adopt criterion proposal.');
      }
    } finally {
      setAdoptingCriterionId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800/80 bg-neutral-900/60">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-neutral-100">AI Decision Analyst</h2>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300">
                    Advisory • Non-Authoritative
                  </span>
                </div>
                <p className="text-xs text-neutral-400">
                  Evidence-aware insights, trade-offs, and critical gaps for &ldquo;{decision?.title}&rdquo;
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchAnalysis(capability)}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 transition disabled:opacity-50"
                title="Regenerate analysis"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Regenerate</span>
              </button>
              <button
                onClick={onClose}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Capability Tabs */}
          <div className="flex items-center gap-1 px-6 py-2.5 border-b border-neutral-800 bg-neutral-900/30 overflow-x-auto text-xs">
            {[
              { id: 'all', label: 'All Overview', icon: Brain },
              { id: 'executive_summary', label: 'Executive Briefing', icon: Scale },
              { id: 'tradeoff_analysis', label: 'Trade-offs', icon: Layers },
              { id: 'evidence_gaps', label: 'Evidence Gaps', icon: FileQuestion },
              { id: 'expert_perspectives', label: 'Expert Perspectives', icon: HelpCircle },
              { id: 'assumptions_questions', label: 'Assumptions & Questions', icon: HelpCircle },
              { id: 'suggest_criteria', label: 'Suggested Criteria', icon: Plus },
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = capability === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id as AiCapability)}
                  disabled={isLoading}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap ${
                    isActive
                      ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Success Banner */}
          {adoptSuccess && (
            <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{adoptSuccess}</span>
            </div>
          )}

          {/* Error Banner */}
          {error && !isLoading && (
            <div className="mx-6 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
              <button
                onClick={() => fetchAnalysis(capability)}
                className="px-2.5 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-200 font-medium transition"
              >
                Retry
              </button>
            </div>
          )}

          {/* Unavailable State */}
          {isUnavailable && !isLoading && (
            <div className="p-8 text-center flex flex-col items-center justify-center">
              <div className="p-3 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 mb-3">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <h3 className="text-sm font-semibold text-neutral-200 mb-1">AI Analyst Unavailable</h3>
              <p className="text-xs text-neutral-400 max-w-md mb-4">
                The backend AI provider is currently offline or not configured with an API key. You can continue using deterministic MCDA engine evaluations and collaborative features.
              </p>
              <button
                onClick={() => fetchAnalysis(capability)}
                className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 transition"
              >
                Check Again
              </button>
            </div>
          )}

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {isLoading ? (
              <div className="py-20 flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                <p className="text-sm text-neutral-300 font-medium">Synthesizing Evidence-Aware Advisory Analysis...</p>
                <p className="text-xs text-neutral-500 max-w-sm text-center">
                  Extracting MCDA calculations, analyzing sensitivity tipping points, and checking empirical citations.
                </p>
              </div>
            ) : analysis ? (
              <>
                {/* Executive Summary Card */}
                {(capability === 'all' || capability === 'executive_summary') && (
                  <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 space-y-2">
                    <div className="flex items-center gap-2 text-purple-400 text-xs font-semibold uppercase tracking-wider">
                      <Scale className="w-4 h-4" />
                      <span>Executive Briefing</span>
                    </div>
                    <p className="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap">
                      {analysis.output.executiveSummary}
                    </p>
                  </div>
                )}

                {/* Trade-offs & Sensitivity Card */}
                {(capability === 'all' || capability === 'tradeoff_analysis') && analysis.output.tradeoffAnalysis && (
                  <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 space-y-3">
                    <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold uppercase tracking-wider">
                      <Layers className="w-4 h-4" />
                      <span>Trade-off Analysis & Deterministic Engine Facts</span>
                    </div>

                    {analysis.output.tradeoffAnalysis.winnerObservation && (
                      <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-200">
                        <span className="font-semibold text-indigo-300">Authoritative Outcome: </span>
                        {analysis.output.tradeoffAnalysis.winnerObservation}
                      </div>
                    )}

                    {analysis.output.tradeoffAnalysis.keyTradeoffs.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-xs font-medium text-neutral-300">Key Trade-offs:</span>
                        <ul className="space-y-1 pl-4 list-disc text-xs text-neutral-400">
                          {analysis.output.tradeoffAnalysis.keyTradeoffs.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {analysis.output.tradeoffAnalysis.sensitivityNotes.length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-neutral-800/60">
                        <span className="text-xs font-medium text-neutral-300">Sensitivity & Tipping Points:</span>
                        <ul className="space-y-1 pl-4 list-disc text-xs text-neutral-400">
                          {analysis.output.tradeoffAnalysis.sensitivityNotes.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Evidence Gaps Card */}
                {(capability === 'all' || capability === 'evidence_gaps') && (
                  <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 space-y-3">
                    <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider">
                      <FileQuestion className="w-4 h-4" />
                      <span>Evidence & Empirical Gaps</span>
                    </div>

                    {analysis.output.evidenceGaps.length === 0 ? (
                      <p className="text-xs text-neutral-400 italic">
                        No critical evidence gaps detected for current options and criteria.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {analysis.output.evidenceGaps.map((gap, i) => (
                          <div
                            key={i}
                            className="p-3 rounded-lg bg-neutral-900 border border-neutral-800 space-y-1 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-neutral-200">{gap.targetName}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 uppercase font-mono">
                                {gap.targetType}
                              </span>
                            </div>
                            <p className="text-neutral-400">{gap.gapDescription}</p>
                            <div className="pt-1 text-[11px] text-amber-300/90 flex items-start gap-1">
                              <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>{gap.recommendation}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Expert Perspectives Card */}
                {(capability === 'all' || capability === 'expert_perspectives') && analysis.output.expertSummary && (
                  <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
                        <Brain className="w-4 h-4" />
                        <span>Expert Perspectives Synthesis</span>
                      </div>
                      <span className="text-[11px] text-neutral-400">
                        {analysis.output.expertSummary.totalContributionsAnalyzed} contribution(s) analyzed
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {analysis.output.expertSummary.consensusAreas.length > 0 && (
                        <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/15 space-y-1.5">
                          <span className="font-semibold text-emerald-300">Consensus & Alignment:</span>
                          <ul className="space-y-1 pl-4 list-disc text-neutral-300">
                            {analysis.output.expertSummary.consensusAreas.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {analysis.output.expertSummary.divergenceAreas.length > 0 && (
                        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/15 space-y-1.5">
                          <span className="font-semibold text-amber-300">Divergence & Key Debates:</span>
                          <ul className="space-y-1 pl-4 list-disc text-neutral-300">
                            {analysis.output.expertSummary.divergenceAreas.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {analysis.output.expertSummary.keyInsights.length > 0 && (
                      <div className="pt-2 text-xs text-neutral-400">
                        <span className="font-semibold text-neutral-300">Key Qualitative Insights: </span>
                        {analysis.output.expertSummary.keyInsights.join(' ')}
                      </div>
                    )}
                  </div>
                )}

                {/* Assumptions & Questions Card */}
                {(capability === 'all' || capability === 'assumptions_questions') && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {analysis.output.assumptions.length > 0 && (
                      <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 space-y-2">
                        <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
                          Critical Assumptions
                        </span>
                        <ul className="space-y-1.5 pl-4 list-disc text-xs text-neutral-400">
                          {analysis.output.assumptions.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {analysis.output.followUpQuestions.length > 0 && (
                      <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 space-y-2">
                        <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
                          Targeted Clarification Questions
                        </span>
                        <ul className="space-y-1.5 pl-4 list-disc text-xs text-neutral-400">
                          {analysis.output.followUpQuestions.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Suggested Criteria Proposals Card */}
                {(capability === 'all' || capability === 'suggest_criteria') && (
                  <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-cyan-400 text-xs font-semibold uppercase tracking-wider">
                        <Plus className="w-4 h-4" />
                        <span>Advisory Suggested Criteria (Proposals)</span>
                      </div>
                      <span className="text-[11px] text-neutral-500">
                        Requires human confirmation to adopt
                      </span>
                    </div>

                    {analysis.output.suggestedCriteria.length === 0 ? (
                      <p className="text-xs text-neutral-400 italic">
                        No additional criteria proposed at this time.
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {analysis.output.suggestedCriteria.map(proposal => {
                          const alreadyExists = decision?.criteria.some(
                            c => c.id.toLowerCase() === proposal.id.toLowerCase()
                          );
                          const isAdopting = adoptingCriterionId === proposal.id;

                          return (
                            <div
                              key={proposal.id}
                              className="p-3.5 rounded-xl bg-neutral-900 border border-neutral-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
                            >
                              <div className="space-y-1 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-neutral-100">{proposal.name}</span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-cyan-400 font-mono">
                                    Suggested Weight: {proposal.suggestedWeight}%
                                  </span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 uppercase">
                                    {proposal.direction}
                                  </span>
                                </div>
                                <p className="text-neutral-400">{proposal.description}</p>
                                <p className="text-[11px] text-neutral-500 italic">
                                  Rationale: {proposal.rationale}
                                </p>
                              </div>

                              <div className="shrink-0">
                                {alreadyExists ? (
                                  <span className="text-[11px] text-neutral-500 font-medium px-2 py-1 rounded bg-neutral-800/80">
                                    Already Present
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => handleAdoptCriterion(proposal)}
                                    disabled={!canEdit || isAdopting}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                                    title={
                                      canEdit
                                        ? 'Adopt this criterion into the decision model'
                                        : 'Only decision owners or editors can adopt criteria'
                                    }
                                  >
                                    {isAdopting ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Plus className="w-3.5 h-3.5" />
                                    )}
                                    <span>Adopt Criterion</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : null}
          </div>

          {/* Footer Transparency Notice */}
          <div className="px-6 py-3 border-t border-neutral-800 bg-neutral-900/60 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-neutral-400">
            <div>
              <span>Provider: </span>
              <span className="font-mono text-neutral-300">{analysis?.provider || 'server-configured'}</span>
              <span className="mx-2">•</span>
              <span>Model: </span>
              <span className="font-mono text-neutral-300">{analysis?.model || 'standard'}</span>
            </div>
            <div className="text-neutral-500 text-center sm:text-right">
              MCDA mathematical scores are strictly computed by the canonical backend engine.
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
