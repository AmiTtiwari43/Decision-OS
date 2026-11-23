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
  ChevronDown,
  ChevronUp,
  Award,
  AlertTriangle,
  Lightbulb,
  UserCheck,
  Info,
} from 'lucide-react';
import {
  apiClient,
  ApiClientError,
  type DecisionDto,
  type AiCapability,
  type AiAnalystResponseDto,
  type AiCriterionProposal,
  type AiAlternativeProposal,
  type AiRankedSuggestion,
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
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(isOpen && decision?._id));
  const [error, setError] = useState<string | null>(null);
  const [isUnavailable, setIsUnavailable] = useState<boolean>(false);
  const [adoptingCriterionId, setAdoptingCriterionId] = useState<string | null>(null);
  const [adoptingOptionId, setAdoptingOptionId] = useState<string | null>(null);
  const [adoptSuccess, setAdoptSuccess] = useState<string | null>(null);
  const [expandedSuggestionIds, setExpandedSuggestionIds] = useState<Record<string, boolean>>({});

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
          // Default first 2 suggestions expanded
          if (result.output.rankedSuggestions && result.output.rankedSuggestions.length > 0) {
            const initialExpanded: Record<string, boolean> = {};
            result.output.rankedSuggestions.slice(0, 2).forEach(s => {
              initialExpanded[s.id] = true;
            });
            setExpandedSuggestionIds(initialExpanded);
          }
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

  // Reset all cached analysis, proposals, loading and errors on decision change or
  // modal open/close, then start the initial analysis in the same step.
  // Previously this effect set isLoading=true and a separate effect only fetched
  // when !isLoading, so the request never started and the spinner never ended.
  useEffect(() => {
    activeDecisionIdRef.current = decision?._id || null;
    activeRequestIdRef.current++;
    setAnalysis(null);
    setError(null);
    setIsUnavailable(false);
    setAdoptSuccess(null);
    setAdoptingCriterionId(null);
    setAdoptingOptionId(null);
    setExpandedSuggestionIds({});
    setIsLoading(false);
    if (isOpen && decision?._id) {
      void fetchAnalysis('all');
    }
  }, [decision?._id, isOpen, fetchAnalysis]);

  // Keyboard navigation: Escape key closes AI analyst modal
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleTabChange = (cap: AiCapability) => {
    setCapability(cap);
    fetchAnalysis(cap);
  };

  const toggleSuggestionExpand = (id: string) => {
    setExpandedSuggestionIds(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
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

  const handleAdoptOption = async (proposal: AiAlternativeProposal) => {
    if (!decision?._id || !canEdit) return;
    setAdoptingOptionId(proposal.id);
    setError(null);
    setAdoptSuccess(null);

    try {
      const updated = await apiClient.applyAiProposal(decision._id, {
        type: 'add_option',
        option: {
          id: proposal.id,
          name: proposal.name,
          description: proposal.description,
        },
      });

      if (onDecisionUpdated) {
        onDecisionUpdated(updated);
      }
      setAdoptSuccess(`Alternative option "${proposal.name}" successfully added! Scoring must be entered to recalculate MCDA results.`);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to adopt alternative option.');
      }
    } finally {
      setAdoptingOptionId(null);
    }
  };

  const renderRankedSuggestionCard = (s: AiRankedSuggestion) => {
    const isExpanded = Boolean(expandedSuggestionIds[s.id]);
    const isAdoptingCriterion = adoptingCriterionId === s.id.replace(/^criterion-/, '');
    const isAdoptingOption = adoptingOptionId === s.id.replace(/^alt-/, '');

    const criterionExists =
      s.category === 'criterion' &&
      decision?.criteria.some(
        c => c.id.toLowerCase() === s.id.replace(/^criterion-/, '').toLowerCase()
      );

    const optionExists =
      s.category === 'alternative' &&
      decision?.options.some(
        o => o.id.toLowerCase() === s.id.replace(/^alt-/, '').toLowerCase()
      );

    const getCategoryBadge = () => {
      switch (s.category) {
        case 'criterion':
          return { label: 'Criterion Proposal', bg: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' };
        case 'alternative':
          return { label: 'Alternative Option', bg: 'bg-purple-500/15 text-purple-300 border-purple-500/30' };
        case 'evidence':
          return { label: 'Evidence Need', bg: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
        case 'expert':
          return { label: 'Expert Recommendation', bg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
        case 'risk_mitigation':
          return { label: 'Risk Mitigation', bg: 'bg-rose-500/15 text-rose-300 border-rose-500/30' };
        default:
          return { label: 'Advisory Note', bg: 'bg-surface-subtle text-slate-300 border-border' };
      }
    };

    const badge = getCategoryBadge();

    return (
      <div
        key={s.id}
        className="rounded-xl bg-surface border border-border overflow-hidden text-xs transition-all hover:border-border-strong"
      >
        {/* Card Header & Summary Bar */}
        <div className="p-4 flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1">
            {/* Rank Pill */}
            <div className="flex flex-col items-center justify-center w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 font-bold shrink-0">
              <span className="text-[10px] text-purple-400 font-mono">RANK</span>
              <span className="text-sm leading-none font-black">#{s.rank}</span>
            </div>

            <div className="space-y-1.5 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase tracking-wider ${badge.bg}`}>
                  {badge.label}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-subtle text-slate-300 font-mono border border-border">
                  Priority Score: {s.rankingScore}/100
                </span>
                <span className="text-[10px] text-slate-400">
                  {Math.round(s.confidence * 100)}% Confidence • {s.uncertaintyLevel} uncertainty
                </span>
              </div>

              <h4 className="text-sm font-semibold text-white">{s.title}</h4>
              <p className="text-xs text-slate-300 leading-relaxed">{s.explanation}</p>
            </div>
          </div>

          {/* Action Area */}
          <div className="flex items-center gap-2 shrink-0 md:self-start pt-2 md:pt-0">
            {s.category === 'criterion' && (
              criterionExists ? (
                <span className="text-[11px] px-2.5 py-1 rounded bg-surface-subtle border border-border text-slate-500 font-medium">
                  Already in Model
                </span>
              ) : (
                <button
                  onClick={() => {
                    const rawCritId = s.id.replace(/^criterion-/, '');
                    const matchingCrit = analysis?.output.suggestedCriteria.find(c => c.id === rawCritId);
                    if (matchingCrit) {
                      handleAdoptCriterion(matchingCrit);
                    }
                  }}
                  disabled={!canEdit || isAdoptingCriterion}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-signal hover:bg-signal-light text-slate-950 transition disabled:opacity-40 disabled:cursor-not-allowed shadow-glow-signal-sm"
                  title={canEdit ? 'Adopt this criterion into the decision model' : 'Only decision owners or editors can adopt criteria'}
                >
                  {isAdoptingCriterion ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  <span>Adopt Criterion</span>
                </button>
              )
            )}

            {s.category === 'alternative' && (
              optionExists ? (
                <span className="text-[11px] px-2.5 py-1 rounded bg-surface-subtle border border-border text-slate-500 font-medium">
                  Already in Model
                </span>
              ) : (
                <button
                  onClick={() => {
                    const rawAltId = s.id.replace(/^alt-/, '');
                    const matchingAlt = analysis?.output.suggestedAlternatives?.find(a => a.id === rawAltId);
                    if (matchingAlt) {
                      handleAdoptOption(matchingAlt);
                    }
                  }}
                  disabled={!canEdit || isAdoptingOption}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-accent-indigo hover:bg-indigo-400 text-slate-950 transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                  title={canEdit ? 'Add this alternative option into the decision model' : 'Only decision owners or editors can add options'}
                >
                  {isAdoptingOption ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  <span>Add Option</span>
                </button>
              )
            )}

            <button
              onClick={() => toggleSuggestionExpand(s.id)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface hover:bg-surface-subtle border border-border text-slate-300 hover:text-white font-medium transition cursor-pointer"
              title="Toggle ranking explainability"
            >
              <span className="text-[11px]">{isExpanded ? 'Hide Details' : 'Explain Rank'}</span>
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Explainability Drawer */}
        {isExpanded && (
          <div className="px-4 pb-4 pt-2 border-t border-border bg-surface-card space-y-3">
            {/* Why This Rank */}
            <div className="p-3 rounded-lg bg-purple-500/5 border border-purple-500/15 space-y-1">
              <div className="flex items-center gap-1.5 text-purple-300 font-semibold text-[11px] uppercase tracking-wider">
                <Award className="w-3.5 h-3.5" />
                <span>Deterministic Ranking Explanation</span>
              </div>
              <p className="text-xs text-slate-200">{s.whyThisRank}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {/* Influencing Criteria */}
              <div className="p-3 rounded-lg bg-surface border border-border space-y-1">
                <div className="flex items-center gap-1.5 text-cyan-400 font-semibold text-[11px] uppercase tracking-wider">
                  <Scale className="w-3.5 h-3.5" />
                  <span>Influencing Criteria</span>
                </div>
                <p className="text-slate-300">{s.criteriaInfluence}</p>
                {s.relevantCriteria.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {s.relevantCriteria.map(c => (
                      <span key={c.id} className="text-[10px] px-2 py-0.5 rounded bg-surface-subtle border border-border text-cyan-300 font-mono">
                        {c.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Supporting Evidence */}
              <div className="p-3 rounded-lg bg-surface border border-border space-y-1">
                <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-[11px] uppercase tracking-wider">
                  <FileQuestion className="w-3.5 h-3.5" />
                  <span>Supporting Evidence</span>
                </div>
                <p className="text-slate-300">{s.evidenceSupport}</p>
                {s.supportingEvidence.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {s.supportingEvidence.map(e => (
                      <span key={e.id} className="text-[10px] px-2 py-0.5 rounded bg-surface-subtle border border-border text-amber-300 font-mono">
                        {e.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Assumptions & What Could Change */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {s.assumptionsMade.length > 0 && (
                <div className="p-3 rounded-lg bg-surface border border-border space-y-1">
                  <span className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">
                    Assumptions Made:
                  </span>
                  <ul className="space-y-1 pl-4 list-disc text-slate-400">
                    {s.assumptionsMade.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {s.missingInformation.length > 0 && (
                <div className="p-3 rounded-lg bg-surface border border-border space-y-1">
                  <span className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">
                    Missing Information:
                  </span>
                  <ul className="space-y-1 pl-4 list-disc text-amber-300/80">
                    {s.missingInformation.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* What Could Change Recommendation */}
            <div className="p-2.5 rounded-lg bg-surface border border-border text-xs text-slate-300 space-y-1">
              <span className="font-semibold text-indigo-300 text-[11px] uppercase tracking-wider">
                What Could Change This Recommendation:
              </span>
              <p className="text-slate-400">{s.whatCouldChangeRecommendation}</p>
            </div>

            {/* Potential Bias or Limitations */}
            {s.potentialBiasOrLimitations.length > 0 && (
              <div className="p-2.5 rounded-lg bg-surface border border-border text-xs text-slate-400 space-y-1">
                <span className="font-semibold text-slate-400 text-[11px] uppercase tracking-wider">
                  Potential Bias or Limitations:
                </span>
                <p className="text-slate-500 italic">{s.potentialBiasOrLimitations.join(' • ')}</p>
              </div>
            )}

            {/* Formula & Score Breakdown */}
            <div className="p-2.5 rounded-lg bg-surface border border-border text-[11px] text-slate-400 space-y-1.5 font-mono">
              <div className="flex items-center justify-between text-slate-300">
                <span className="font-bold">Ranking Methodology (MDAR v1):</span>
                <span>Total Score: {s.rankingScore}/100</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center pt-1 text-[10px]">
                <div className="p-1.5 rounded bg-surface-subtle border border-border-subtle">
                  <div className="text-slate-500">Relevance</div>
                  <div className="text-slate-200 font-bold">{s.scoreBreakdown.criteriaRelevance}/100</div>
                </div>
                <div className="p-1.5 rounded bg-surface-subtle border border-border-subtle">
                  <div className="text-slate-500">Evidence</div>
                  <div className="text-slate-200 font-bold">{s.scoreBreakdown.evidenceGrounding}/100</div>
                </div>
                <div className="p-1.5 rounded bg-surface-subtle border border-border-subtle">
                  <div className="text-slate-500">Sensitivity</div>
                  <div className="text-slate-200 font-bold">{s.scoreBreakdown.sensitivityUrgency}/100</div>
                </div>
                <div className="p-1.5 rounded bg-surface-subtle border border-border-subtle">
                  <div className="text-slate-500">Confidence</div>
                  <div className="text-slate-200 font-bold">{s.scoreBreakdown.confidenceScore}/100</div>
                </div>
                <div className="p-1.5 rounded bg-surface-subtle border border-border-subtle">
                  <div className="text-slate-500">Deductions</div>
                  <div className="text-rose-400 font-bold">-{s.scoreBreakdown.penalties} pts</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-background/80 backdrop-blur-md"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-analyst-title"
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-6xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col bg-surface-card border border-border rounded-2xl shadow-2xl overflow-hidden text-slate-100"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 id="ai-analyst-title" className="text-lg font-semibold text-white">AI Decision Analyst</h2>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300">
                    Advisory • Non-Authoritative
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Evidence-aware insights, trade-offs, and critical gaps for &ldquo;{decision?.title}&rdquo;
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchAnalysis(capability)}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-surface hover:bg-surface-subtle border border-border transition disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none"
                title="Regenerate analysis"
                aria-label="Regenerate analysis"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Regenerate</span>
              </button>
              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-surface-subtle border border-transparent hover:border-border transition cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Capability Tabs */}
          <div
            role="tablist"
            aria-label="AI Analyst capabilities"
            className="shrink-0 flex flex-wrap items-center gap-1 px-4 sm:px-6 py-2 border-b border-border-subtle bg-surface-subtle/50 text-xs"
          >
            {[
              { id: 'all', label: 'All Overview', icon: Brain },
              { id: 'ranked_suggestions', label: 'Ranked Advice', icon: Award },
              { id: 'tradeoff_analysis', label: 'Trade-offs & Risks', icon: Layers },
              { id: 'evidence_gaps', label: 'Evidence Gaps', icon: FileQuestion },
              { id: 'suggest_alternatives', label: 'Alternatives', icon: Lightbulb },
              { id: 'suggest_criteria', label: 'Criteria Proposals', icon: Plus },
              { id: 'expert_perspectives', label: 'Expert Perspectives', icon: UserCheck },
              { id: 'executive_summary', label: 'Executive Briefing', icon: Scale },
              { id: 'assumptions_questions', label: 'Assumptions & Questions', icon: HelpCircle },
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = capability === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleTabChange(tab.id as AiCapability)}
                  disabled={isLoading}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none ${isActive
                      ? 'bg-accent-indigo/20 text-accent-indigo border border-accent-indigo/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-surface'
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
              <h3 className="text-sm font-semibold text-slate-200 mb-1">AI Analyst Unavailable</h3>
              <p className="text-xs text-slate-400 max-w-md mb-4">
                The backend AI provider is currently offline or not configured with an API key. You can continue using deterministic MCDA engine evaluations and collaborative features.
              </p>
              <button
                onClick={() => fetchAnalysis(capability)}
                className="px-4 py-2 rounded-lg bg-surface hover:bg-surface-subtle border border-border text-xs font-medium text-slate-200 transition cursor-pointer"
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
                <p className="text-sm text-slate-300 font-medium">Synthesizing Evidence-Aware Advisory Analysis...</p>
                <p className="text-xs text-slate-500 max-w-sm text-center">
                  Extracting MCDA calculations, analyzing sensitivity tipping points, ranking suggestions deterministically, and checking empirical citations.
                </p>
              </div>
            ) : analysis ? (
              <>
                {/* RANKED ADVICE (PRIMARY EXPLAINABLE RANKING VIEW) */}
                {(capability === 'all' || capability === 'ranked_suggestions') && (
                  <div className="p-4 rounded-xl bg-surface border border-border space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-purple-400 text-xs font-semibold uppercase tracking-wider">
                        <Award className="w-4 h-4" />
                        <span>Explainable Advisory Recommendation Ranking</span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        Multi-Factor Deterministic Advisory Ranking (MDAR v1)
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-surface-card border border-border-subtle text-[11px] text-slate-400 flex items-start gap-2">
                      <Info className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-slate-200">Advisory Non-Authoritative Guarantee: </strong>
                        Suggestions are prioritized using transparent multi-factor scoring (Criterion weight relevance, empirical grounding, sensitivity tipping points, stated heuristic confidence). They do NOT alter or replace canonical MCDA engine calculations.
                      </div>
                    </div>

                    {!analysis.output.rankedSuggestions || analysis.output.rankedSuggestions.length === 0 ? (
                      <p className="text-xs text-slate-400 italic py-2">
                        No actionable advisory suggestions generated for this decision state.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
                        {analysis.output.rankedSuggestions.map(s => renderRankedSuggestionCard(s))}
                      </div>
                    )}
                  </div>
                )}

                {/* Executive Summary Card */}
                {(capability === 'all' || capability === 'executive_summary') && (
                  <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
                    <div className="flex items-center gap-2 text-purple-400 text-xs font-semibold uppercase tracking-wider">
                      <Scale className="w-4 h-4" />
                      <span>Executive Briefing</span>
                    </div>
                    <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                      {analysis.output.executiveSummary}
                    </p>
                  </div>
                )}

                {/* Trade-offs & Risks Card */}
                {(capability === 'all' || capability === 'tradeoff_analysis') && analysis.output.tradeoffAnalysis && (
                  <div className="p-4 rounded-xl bg-surface border border-border space-y-3">
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
                        <span className="text-xs font-medium text-slate-300">Key Trade-offs:</span>
                        <ul className="space-y-1 pl-4 list-disc text-xs text-slate-400">
                          {analysis.output.tradeoffAnalysis.keyTradeoffs.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {analysis.output.tradeoffAnalysis.sensitivityNotes.length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-border-subtle">
                        <span className="text-xs font-medium text-slate-300">Sensitivity & Tipping Points:</span>
                        <ul className="space-y-1 pl-4 list-disc text-xs text-slate-400">
                          {analysis.output.tradeoffAnalysis.sensitivityNotes.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Operational Risks & Mitigations */}
                    {analysis.output.tradeoffAnalysis.risks && analysis.output.tradeoffAnalysis.risks.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-border-subtle">
                        <span className="text-xs font-medium text-rose-300 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Identified Risks & Mitigations:</span>
                        </span>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                          {analysis.output.tradeoffAnalysis.risks.map((r, i) => (
                            <div key={i} className="p-2.5 rounded-lg bg-rose-500/5 border border-rose-500/20 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-rose-200">{r.risk}</span>
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 uppercase font-mono">
                                  {r.severity}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400"><strong>Mitigation:</strong> {r.mitigation}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Evidence Gaps Card */}
                {(capability === 'all' || capability === 'evidence_gaps') && (
                  <div className="p-4 rounded-xl bg-surface border border-border space-y-3">
                    <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider">
                      <FileQuestion className="w-4 h-4" />
                      <span>Evidence & Empirical Gaps</span>
                    </div>

                    {analysis.output.evidenceGaps.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">
                        No critical evidence gaps detected for current options and criteria.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {analysis.output.evidenceGaps.map((gap, i) => (
                          <div
                            key={i}
                            className="p-3 rounded-lg bg-surface-card border border-border space-y-1 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-200">{gap.targetName}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-slate-400 uppercase font-mono">
                                {gap.targetType}
                              </span>
                            </div>
                            <p className="text-slate-400">{gap.gapDescription}</p>
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

                {/* Suggested Alternatives Card */}
                {(capability === 'all' || capability === 'suggest_alternatives') && analysis.output.suggestedAlternatives && (
                  <div className="p-4 rounded-xl bg-surface border border-border space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-purple-400 text-xs font-semibold uppercase tracking-wider">
                        <Lightbulb className="w-4 h-4" />
                        <span>Alternative Suggestions (Unexplored Options)</span>
                      </div>
                      <span className="text-[11px] text-slate-500">
                        Requires human confirmation to adopt
                      </span>
                    </div>

                    {analysis.output.suggestedAlternatives.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">
                        No alternative options suggested for this decision.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {analysis.output.suggestedAlternatives.map(alt => {
                          const alreadyExists = decision?.options.some(
                            o => o.id.toLowerCase() === alt.id.toLowerCase()
                          );
                          const isAdopting = adoptingOptionId === alt.id;

                          return (
                            <div
                              key={alt.id}
                              className="p-3.5 rounded-xl bg-surface-card border border-border space-y-2 text-xs"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <h4 className="font-semibold text-white">{alt.name}</h4>
                                  <p className="text-slate-400">{alt.description}</p>
                                </div>
                                <div className="shrink-0">
                                  {alreadyExists ? (
                                    <span className="text-[11px] text-slate-500 font-medium px-2 py-1 rounded bg-surface border border-border">
                                      Already Present
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => handleAdoptOption(alt)}
                                      disabled={!canEdit || isAdopting}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-accent-indigo hover:bg-indigo-400 text-slate-950 transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                                      title={canEdit ? 'Add this option into decision model' : 'Only decision owners or editors can add options'}
                                    >
                                      {isAdopting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                                      <span>Add Option</span>
                                    </button>
                                  )}
                                </div>
                              </div>

                              <p className="text-[11px] text-slate-400 italic">
                                <strong>Rationale: </strong>{alt.rationale}
                              </p>

                              {alt.tradeoffs && (
                                <p className="text-[11px] text-slate-400">
                                  <strong>Trade-offs: </strong>{alt.tradeoffs}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Suggested Criteria Proposals Card */}
                {(capability === 'all' || capability === 'suggest_criteria') && (
                  <div className="p-4 rounded-xl bg-surface border border-border space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-accent-cyan text-xs font-semibold uppercase tracking-wider">
                        <Plus className="w-4 h-4" />
                        <span>Advisory Suggested Criteria (Proposals)</span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        Requires human confirmation to adopt
                      </span>
                    </div>

                    {analysis.output.suggestedCriteria.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">
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
                              className="p-3.5 rounded-xl bg-surface-card border border-border-subtle hover:border-border transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
                            >
                              <div className="space-y-1 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-white">{proposal.name}</span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border-subtle text-accent-cyan font-mono">
                                    Suggested Weight: {proposal.suggestedWeight}%
                                  </span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border-subtle text-slate-400 uppercase">
                                    {proposal.direction}
                                  </span>
                                </div>
                                <p className="text-slate-300">{proposal.description}</p>
                                <p className="text-[11px] text-slate-400 italic">
                                  Rationale: {proposal.rationale}
                                </p>
                              </div>

                              <div className="shrink-0">
                                {alreadyExists ? (
                                  <span className="text-[11px] text-slate-400 font-medium px-2 py-1 rounded bg-surface border border-border-subtle">
                                    Already Present
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => handleAdoptCriterion(proposal)}
                                    disabled={!canEdit || isAdopting}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-signal hover:bg-signal-light text-slate-950 transition disabled:opacity-40 disabled:cursor-not-allowed shadow-glow-signal-sm"
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

                {/* Expert Perspectives & Recommendations Card */}
                {(capability === 'all' || capability === 'expert_perspectives') && (
                  <div className="p-4 rounded-xl bg-surface border border-border space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
                        <Brain className="w-4 h-4" />
                        <span>Expert Perspectives Synthesis & Recommendations</span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {analysis.output.expertSummary?.totalContributionsAnalyzed || 0} contribution(s) analyzed
                      </span>
                    </div>

                    {analysis.output.expertSummary && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        {analysis.output.expertSummary.consensusAreas.length > 0 && (
                          <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-1.5">
                            <span className="font-semibold text-emerald-300">Consensus & Alignment:</span>
                            <ul className="space-y-1 pl-4 list-disc text-slate-300">
                              {analysis.output.expertSummary.consensusAreas.map((item, i) => (
                                <li key={i}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {analysis.output.expertSummary.divergenceAreas.length > 0 && (
                          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-1.5">
                            <span className="font-semibold text-amber-300">Divergence & Key Debates:</span>
                            <ul className="space-y-1 pl-4 list-disc text-slate-300">
                              {analysis.output.expertSummary.divergenceAreas.map((item, i) => (
                                <li key={i}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Recommendations for Additional Expert Input */}
                    {analysis.output.expertRecommendations && analysis.output.expertRecommendations.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-border-subtle text-xs">
                        <span className="font-medium text-emerald-300 flex items-center gap-1.5">
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Recommended Additional Expert Disciplines to Engage:</span>
                        </span>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {analysis.output.expertRecommendations.map((exp, i) => (
                            <div key={i} className="p-3 rounded-lg bg-surface-card border border-border-subtle space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-slate-200">{exp.domain}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
                                  Role: {exp.role}
                                </span>
                              </div>
                              <p className="text-slate-300">{exp.rationale}</p>
                              <div className="text-[11px] text-slate-400">
                                <strong>Expected Contribution: </strong>{exp.expectedContribution}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Assumptions & Questions Card */}
                {(capability === 'all' || capability === 'assumptions_questions') && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {analysis.output.assumptions.length > 0 && (
                      <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
                        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                          Critical Assumptions
                        </span>
                        <ul className="space-y-1.5 pl-4 list-disc text-xs text-slate-400">
                          {analysis.output.assumptions.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {analysis.output.followUpQuestions.length > 0 && (
                      <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
                        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                          Targeted Clarification Questions
                        </span>
                        <ul className="space-y-1.5 pl-4 list-disc text-xs text-slate-400">
                          {analysis.output.followUpQuestions.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : null}
          </div>

          {/* Footer Transparency Notice */}
          <div className="px-6 py-3 border-t border-border bg-surface flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-400 font-mono">
            <div>
              <span>Provider: </span>
              <span className="font-mono text-slate-300">{analysis?.provider || 'server-configured'}</span>
              <span className="mx-2">•</span>
              <span>Model: </span>
              <span className="font-mono text-slate-300">{analysis?.model || 'standard'}</span>
            </div>
            <div className="text-slate-500 text-center sm:text-right">
              MCDA mathematical scores are strictly computed by the canonical backend engine.
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
