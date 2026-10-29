import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Sparkles,
  Users,
  CheckCircle2,
  Lock,
  Unlock,
  AlertTriangle,
  Loader2,
  Save,
  Send,
  Undo2,
  Check,
  Award,
} from 'lucide-react';
import {
  apiClient,
  ApiClientError,
  type DecisionDto,
  type DecisionContributionDto,
  type SaveContributionPayload,
} from '../api/index.js';

export interface ContributionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  decision: DecisionDto | null;
  onDecisionUpdated?: (updated: DecisionDto) => void;
}

type Tab = 'mine' | 'submissions';

export const ContributionsModal: React.FC<ContributionsModalProps> = ({
  isOpen,
  onClose,
  decision,
  onDecisionUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('mine');

  // Decision & round state
  const isRoundLocked = Boolean(decision?.isContributionRoundLocked);
  const currentUserRole = decision?.currentUserRole || 'owner';
  const isOwner = currentUserRole === 'owner';
  const isViewer = currentUserRole === 'viewer';

  // My Contribution Form State
  const [preferredOptionId, setPreferredOptionId] = useState<string>('');
  const [rationale, setRationale] = useState<string>('');
  const [confidence, setConfidence] = useState<number>(0.8);
  const [criterionScores, setCriterionScores] = useState<Record<string, number>>({});
  const [criterionReasoning, setCriterionReasoning] = useState<Record<string, string>>({});
  const [predictionStatement, setPredictionStatement] = useState<string>('');
  const [predictionProbability, setPredictionProbability] = useState<number>(0.7);

  // My Contribution Record State
  const [myContribution, setMyContribution] = useState<DecisionContributionDto | null>(null);
  const [isLoadingMine, setIsLoadingMine] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // All Contributions List State
  const [submissions, setSubmissions] = useState<DecisionContributionDto[]>([]);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(false);
  const [submissionsError, setSubmissionsError] = useState<string | null>(null);

  // Round lock in-flight
  const [isTogglingLock, setIsTogglingLock] = useState(false);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);

  // Fetch my contribution
  const fetchMyContribution = useCallback(async () => {
    if (!decision?._id) return;
    setIsLoadingMine(true);
    setFormError(null);
    try {
      const res = await apiClient.getMineContribution(decision._id);
      if (res.item) {
        setMyContribution(res.item);
        setPreferredOptionId(res.item.recommendation.preferredOptionId || '');
        setRationale(res.item.recommendation.rationale || '');
        setConfidence(res.item.confidence !== undefined ? res.item.confidence : 0.8);
        setCriterionScores(res.item.criterionScores || {});
        setCriterionReasoning(res.item.criterionReasoning || {});
        if (res.item.prediction) {
          setPredictionStatement(res.item.prediction.statement || '');
          setPredictionProbability(res.item.prediction.probability ?? 0.7);
        }
      } else {
        setMyContribution(null);
        if (decision.options && decision.options.length > 0) {
          setPreferredOptionId(decision.options[0].id);
        }
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message);
      }
    } finally {
      setIsLoadingMine(false);
    }
  }, [decision]);

  // Fetch all submissions
  const fetchSubmissions = useCallback(async () => {
    if (!decision?._id) return;
    setIsLoadingSubmissions(true);
    setSubmissionsError(null);
    try {
      const res = await apiClient.listContributions(decision._id);
      setSubmissions(res.items);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setSubmissionsError(err.message);
      }
    } finally {
      setIsLoadingSubmissions(false);
    }
  }, [decision]);

  useEffect(() => {
    if (isOpen && decision?._id) {
      fetchMyContribution();
      fetchSubmissions();
      setFormError(null);
      setFormSuccess(null);
    }
  }, [isOpen, decision?._id, fetchMyContribution, fetchSubmissions]);

  if (!isOpen || !decision) return null;

  // Handle saving draft
  const handleSaveDraft = async () => {
    if (!preferredOptionId) {
      setFormError('Please select a preferred option.');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    setFormSuccess(null);

    const payload: SaveContributionPayload = {
      preferredOptionId,
      rationale,
      confidence,
      criterionScores,
      criterionReasoning,
      prediction: predictionStatement
        ? {
            statement: predictionStatement,
            probability: predictionProbability,
          }
        : undefined,
    };

    try {
      const saved = await apiClient.saveContribution(decision._id, payload);
      setMyContribution(saved);
      setFormSuccess('Draft saved successfully.');
      fetchSubmissions();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message);
      } else {
        setFormError('Failed to save draft contribution.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Handle submitting
  const handleSubmit = async () => {
    if (!preferredOptionId) {
      setFormError('Please select a preferred option.');
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      // First save current form data
      const payload: SaveContributionPayload = {
        preferredOptionId,
        rationale,
        confidence,
        criterionScores,
        criterionReasoning,
        prediction: predictionStatement
          ? {
              statement: predictionStatement,
              probability: predictionProbability,
            }
          : undefined,
      };
      await apiClient.saveContribution(decision._id, payload);

      // Submit
      const submitted = await apiClient.submitContribution(decision._id);
      setMyContribution(submitted);
      setFormSuccess(`Contribution submitted (Revision ${submitted.revision})!`);
      fetchSubmissions();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message);
      } else {
        setFormError('Failed to submit contribution.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle withdrawing
  const handleWithdraw = async () => {
    setIsWithdrawing(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      const withdrawn = await apiClient.withdrawContribution(decision._id);
      setMyContribution(withdrawn);
      setFormSuccess('Contribution withdrawn.');
      fetchSubmissions();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message);
      } else {
        setFormError('Failed to withdraw contribution.');
      }
    } finally {
      setIsWithdrawing(false);
    }
  };

  // Handle round lock toggle (Owner only)
  const handleToggleRoundLock = async () => {
    setIsTogglingLock(true);
    try {
      const updated = isRoundLocked
        ? await apiClient.unlockContributionRound(decision._id)
        : await apiClient.lockContributionRound(decision._id);
      if (onDecisionUpdated) {
        onDecisionUpdated(updated);
      }
      setFormSuccess(
        isRoundLocked ? 'Contribution round unlocked.' : 'Contribution round locked.'
      );
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message);
      }
    } finally {
      setIsTogglingLock(false);
    }
  };

  // Handle adopting expert scores (Owner only)
  const handleAdopt = async (contributionId: string) => {
    setAdoptingId(contributionId);
    try {
      const updated = await apiClient.adoptExpertScores(decision._id, contributionId);
      if (onDecisionUpdated) {
        onDecisionUpdated(updated);
      }
      setFormSuccess('Expert scores successfully adopted into the authoritative decision model.');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setSubmissionsError(err.message);
      }
    } finally {
      setAdoptingId(null);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-background/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-3xl flex flex-col rounded-2xl bg-surface-card border border-border shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-border bg-surface shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-signal">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <span>Expert Contributions</span>
                  <span className="text-xs font-mono text-signal bg-signal/10 px-2 py-0.5 rounded border border-signal/20">
                    Phase 7
                  </span>
                  {isRoundLocked ? (
                    <span className="text-[10px] font-mono text-accent-rose bg-accent-rose/10 px-2 py-0.5 rounded border border-accent-rose/30 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      <span>Round Locked</span>
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-signal bg-signal/10 px-2 py-0.5 rounded border border-signal/30 flex items-center gap-1">
                      <Unlock className="w-3 h-3" />
                      <span>Round Open</span>
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-400 truncate max-w-md" title={decision.title}>
                  "{decision.title}"
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isOwner && (
                <button
                  onClick={handleToggleRoundLock}
                  disabled={isTogglingLock}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
                    isRoundLocked
                      ? 'bg-signal/15 text-signal border-signal/30 hover:bg-signal/25'
                      : 'bg-surface-subtle text-slate-300 border-border hover:bg-surface'
                  }`}
                  title={isRoundLocked ? 'Unlock contribution round' : 'Lock contribution round'}
                >
                  {isTogglingLock ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : isRoundLocked ? (
                    <>
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Unlock Round</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5" />
                      <span>Lock Round</span>
                    </>
                  )}
                </button>
              )}

              <button
                onClick={onClose}
                className="p-1.5 rounded-lg bg-surface-subtle hover:bg-surface border border-border text-slate-400 hover:text-white transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center border-b border-border-subtle bg-surface-subtle/50 px-4 pt-2 gap-2 shrink-0">
            <button
              onClick={() => setActiveTab('mine')}
              className={`px-3 py-2 text-xs font-bold rounded-t-lg transition-colors border-b-2 cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'mine'
                  ? 'border-signal text-signal bg-surface'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>My Submission</span>
              {myContribution && (
                <span
                  className={`text-[9px] font-mono uppercase px-1.5 py-0.2 rounded ${
                    myContribution.status === 'submitted'
                      ? 'bg-signal/20 text-signal'
                      : 'bg-surface-card text-slate-400'
                  }`}
                >
                  {myContribution.status}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('submissions')}
              className={`px-3 py-2 text-xs font-bold rounded-t-lg transition-colors border-b-2 cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'submissions'
                  ? 'border-signal text-signal bg-surface'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>All Submissions ({submissions.filter((s) => s.status === 'submitted').length})</span>
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-4 sm:p-6 overflow-y-auto max-h-[72vh] space-y-4">
            {/* TAB 1: MY SUBMISSION */}
            {activeTab === 'mine' && (
              <div className="space-y-4">
                {isViewer ? (
                  <div className="p-4 rounded-xl bg-surface border border-border text-xs text-slate-300 space-y-1">
                    <span className="font-bold text-white block">Viewer Mode</span>
                    <span>
                      You have read-only access to this decision and cannot submit expert contributions.
                      Browse the "All Submissions" tab to view recommendations from contributing experts.
                    </span>
                  </div>
                ) : (
                  <>
                    {/* Status & Revision Banner */}
                    <div className="flex items-center justify-between p-3 rounded-xl bg-surface border border-border text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">Current Status:</span>
                        <span
                          className={`font-mono text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                            myContribution?.status === 'submitted'
                              ? 'bg-signal/20 text-signal border border-signal/30'
                              : myContribution?.status === 'withdrawn'
                              ? 'bg-accent-rose/20 text-accent-rose border border-accent-rose/30'
                              : 'bg-surface-subtle text-slate-300 border border-border'
                          }`}
                        >
                          {myContribution?.status || 'No Submission Yet (Draft)'}
                        </span>
                        {myContribution && (
                          <span className="text-slate-400 text-[11px]">
                            Revision {myContribution.revision}
                          </span>
                        )}
                      </div>

                      {isRoundLocked && (
                        <span className="text-accent-amber text-[11px] flex items-center gap-1 font-medium">
                          <Lock className="w-3 h-3" />
                          <span>Round is locked; edits disabled.</span>
                        </span>
                      )}
                    </div>

                    {formSuccess && (
                      <div className="p-3 rounded-xl bg-signal/10 border border-signal/30 text-xs text-signal flex items-center gap-2">
                        <Check className="w-4 h-4 shrink-0" />
                        <span>{formSuccess}</span>
                      </div>
                    )}

                    {formError && (
                      <div className="p-3 rounded-xl bg-accent-rose/10 border border-accent-rose/30 text-xs text-accent-rose flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{formError}</span>
                      </div>
                    )}

                    {isLoadingMine ? (
                      <div className="py-8 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin text-signal" />
                        <span>Loading your submission...</span>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Preferred Option */}
                        <div>
                          <label className="block text-xs font-mono uppercase text-slate-300 font-semibold mb-1.5">
                            Preferred Option Recommendation *
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {decision.options.map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                disabled={isRoundLocked}
                                onClick={() => setPreferredOptionId(opt.id)}
                                className={`p-3 rounded-xl border text-left transition-all cursor-pointer disabled:cursor-not-allowed ${
                                  preferredOptionId === opt.id
                                    ? 'bg-surface-card border-signal text-white shadow-glow-signal-sm'
                                    : 'bg-surface/50 border-border text-slate-300 hover:border-slate-500'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-sm">{opt.name}</span>
                                  {preferredOptionId === opt.id && (
                                    <CheckCircle2 className="w-4 h-4 text-signal" />
                                  )}
                                </div>
                                {opt.tagline && (
                                  <p className="text-[11px] text-slate-400 mt-0.5">{opt.tagline}</p>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Overall Rationale */}
                        <div>
                          <label className="block text-xs font-mono uppercase text-slate-300 font-semibold mb-1.5">
                            Overall Rationale & Trade-off Explanation
                          </label>
                          <textarea
                            rows={3}
                            disabled={isRoundLocked}
                            value={rationale}
                            onChange={(e) => setRationale(e.target.value)}
                            placeholder="Articulate why this option is superior and what trade-offs you find acceptable..."
                            className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-xs text-slate-200 focus:outline-none focus:border-signal resize-none disabled:opacity-50"
                          />
                        </div>

                        {/* Confidence Slider */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-mono uppercase text-slate-300 font-semibold">
                              Confidence Rating
                            </label>
                            <span className="text-xs font-mono text-signal font-bold">
                              {Math.round(confidence * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            disabled={isRoundLocked}
                            value={confidence}
                            onChange={(e) => setConfidence(parseFloat(e.target.value))}
                            className="w-full accent-signal cursor-pointer disabled:cursor-not-allowed"
                          />
                        </div>

                        {/* Criterion-Level Scores & Reasoning */}
                        <div className="space-y-3 pt-2 border-t border-border-subtle">
                          <label className="block text-xs font-mono uppercase text-slate-300 font-semibold">
                            Criterion-Specific Assessments (For Preferred Option)
                          </label>
                          <div className="space-y-3">
                            {decision.criteria.map((c) => (
                              <div
                                key={c.id}
                                className="p-3 rounded-xl bg-surface border border-border space-y-2"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-white">{c.name}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-mono text-slate-400">Score:</span>
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      disabled={isRoundLocked}
                                      value={criterionScores[c.id] ?? ''}
                                      onChange={(e) => {
                                        const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                                        setCriterionScores((prev) => ({
                                          ...prev,
                                          [c.id]: Math.min(100, Math.max(0, val)),
                                        }));
                                      }}
                                      className="w-16 px-2 py-0.5 rounded bg-surface-card border border-border text-xs font-mono text-signal text-right focus:outline-none focus:border-signal"
                                    />
                                    <span className="text-[10px] text-slate-500">/ 100</span>
                                  </div>
                                </div>
                                <input
                                  type="text"
                                  disabled={isRoundLocked}
                                  placeholder={`Specific reasoning for ${c.name}...`}
                                  value={criterionReasoning[c.id] || ''}
                                  onChange={(e) =>
                                    setCriterionReasoning((prev) => ({
                                      ...prev,
                                      [c.id]: e.target.value,
                                    }))
                                  }
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-surface-subtle border border-border text-[11px] text-slate-300 focus:outline-none focus:border-signal"
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Prediction Section (Optional) */}
                        <div className="p-3 rounded-xl bg-surface border border-border space-y-2.5">
                          <span className="text-xs font-mono uppercase text-slate-400 font-semibold block">
                            Optional Falsifiable Prediction
                          </span>
                          <input
                            type="text"
                            disabled={isRoundLocked}
                            placeholder="e.g. Option A will achieve $1M ARR within 6 months"
                            value={predictionStatement}
                            onChange={(e) => setPredictionStatement(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-surface-subtle border border-border text-xs text-slate-300 focus:outline-none focus:border-signal"
                          />
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400">Estimated Probability:</span>
                            <span className="font-mono text-signal font-bold">
                              {Math.round(predictionProbability * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            disabled={isRoundLocked}
                            value={predictionProbability}
                            onChange={(e) => setPredictionProbability(parseFloat(e.target.value))}
                            className="w-full accent-signal cursor-pointer"
                          />
                        </div>

                        {/* Action Buttons */}
                        {!isRoundLocked && (
                          <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
                            <div>
                              {myContribution?.status === 'submitted' && (
                                <button
                                  type="button"
                                  onClick={handleWithdraw}
                                  disabled={isWithdrawing}
                                  className="px-3.5 py-2 rounded-xl bg-surface border border-accent-rose/40 text-accent-rose hover:bg-accent-rose/10 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                                >
                                  {isWithdrawing ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Undo2 className="w-3.5 h-3.5" />
                                  )}
                                  <span>Withdraw Submission</span>
                                </button>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={handleSaveDraft}
                                disabled={isSaving || isSubmitting}
                                className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-subtle border border-border text-slate-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                              >
                                {isSaving ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Save className="w-3.5 h-3.5" />
                                )}
                                <span>Save Draft</span>
                              </button>

                              <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={isSubmitting || isSaving}
                                className="px-5 py-2 rounded-xl bg-signal hover:bg-signal-light text-background font-bold text-xs flex items-center gap-1.5 shadow-glow-signal-sm cursor-pointer disabled:opacity-50 transition-all"
                              >
                                {isSubmitting ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Send className="w-3.5 h-3.5" />
                                )}
                                <span>
                                  {myContribution?.status === 'submitted'
                                    ? 'Revise & Submit'
                                    : 'Submit Contribution'}
                                </span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* TAB 2: ALL SUBMISSIONS */}
            {activeTab === 'submissions' && (
              <div className="space-y-4">
                {submissionsError && (
                  <div className="p-3 rounded-xl bg-accent-rose/10 border border-accent-rose/30 text-xs text-accent-rose flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{submissionsError}</span>
                  </div>
                )}

                {isLoadingSubmissions ? (
                  <div className="py-8 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin text-signal" />
                    <span>Loading submissions...</span>
                  </div>
                ) : submissions.filter((s) => s.status === 'submitted').length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-400 space-y-2">
                    <Users className="w-8 h-8 text-slate-600 mx-auto" />
                    <p className="font-medium text-slate-300">No submitted expert contributions yet.</p>
                    <p className="text-[11px] text-slate-500">
                      Contributions appear here once experts finalize and submit their recommendations.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {submissions
                      .filter((s) => s.status === 'submitted')
                      .map((sub) => {
                        const contributor =
                          typeof sub.contributorId === 'object'
                            ? sub.contributorId
                            : { id: sub.contributorId, name: 'Contributor', email: '' };
                        const preferredOption = decision.options.find(
                          (o) => o.id === sub.recommendation.preferredOptionId
                        );

                        return (
                          <div
                            key={sub.id}
                            className="p-4 rounded-xl bg-surface border border-border space-y-3"
                          >
                            {/* Contributor Header */}
                            <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full bg-signal/15 border border-signal/30 flex items-center justify-center text-signal text-xs font-bold">
                                  {contributor.name ? contributor.name[0].toUpperCase() : 'E'}
                                </div>
                                <div>
                                  <span className="text-xs font-bold text-white block">
                                    {contributor.name}
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    {contributor.email}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono text-slate-400">
                                  Rev {sub.revision}
                                </span>
                                <span className="text-[10px] font-mono bg-signal/15 text-signal px-2 py-0.5 rounded border border-signal/30">
                                  Confidence: {Math.round(sub.confidence * 100)}%
                                </span>
                              </div>
                            </div>

                            {/* Preferred Option Recommendation */}
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-slate-400">Recommended Choice:</span>
                              <span className="font-bold text-signal flex items-center gap-1.5">
                                <Award className="w-3.5 h-3.5" />
                                <span>{preferredOption?.name || sub.recommendation.preferredOptionId}</span>
                              </span>
                            </div>

                            {/* Rationale */}
                            {sub.recommendation.rationale && (
                              <div className="p-3 rounded-lg bg-surface-subtle border border-border-subtle text-xs text-slate-300 leading-relaxed">
                                <span className="font-mono text-[10px] uppercase text-slate-400 block mb-1">
                                  Rationale
                                </span>
                                {sub.recommendation.rationale}
                              </div>
                            )}

                            {/* Criterion Scores */}
                            {sub.criterionScores && Object.keys(sub.criterionScores).length > 0 && (
                              <div className="space-y-1.5 pt-1">
                                <span className="text-[10px] font-mono uppercase text-slate-400 block">
                                  Criterion Scores & Reasoning
                                </span>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {Object.entries(sub.criterionScores).map(([critId, score]) => {
                                    const critName =
                                      decision.criteria.find((c) => c.id === critId)?.name || critId;
                                    const reasoning = sub.criterionReasoning?.[critId];
                                    return (
                                      <div
                                        key={critId}
                                        className="p-2 rounded bg-surface-card border border-border-subtle text-[11px]"
                                      >
                                        <div className="flex items-center justify-between">
                                          <span className="text-slate-300 font-medium">{critName}</span>
                                          <span className="font-mono text-signal font-bold">{score}</span>
                                        </div>
                                        {reasoning && (
                                          <p className="text-[10px] text-slate-400 mt-1 italic">
                                            "{reasoning}"
                                          </p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Optional Prediction */}
                            {sub.prediction?.statement && (
                              <div className="p-2 rounded bg-surface-subtle border border-border-subtle text-xs text-slate-300">
                                <span className="text-[10px] font-mono uppercase text-slate-400 block mb-0.5">
                                  Prediction ({Math.round((sub.prediction.probability || 0) * 100)}% prob)
                                </span>
                                <span>{sub.prediction.statement}</span>
                              </div>
                            )}

                            {/* Owner Action: Adopt Scores */}
                            {isOwner && (
                              <div className="pt-2 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => handleAdopt(sub.id)}
                                  disabled={adoptingId === sub.id}
                                  className="px-3.5 py-1.5 rounded-lg bg-surface hover:bg-surface-subtle border border-signal/40 text-signal text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                                  title="Adopt these scores into the authoritative decision model"
                                >
                                  {adoptingId === sub.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Award className="w-3.5 h-3.5" />
                                  )}
                                  <span>Adopt Expert Scores</span>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
