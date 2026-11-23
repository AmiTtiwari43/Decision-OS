import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  RefreshCw,
  Loader2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Target,
  BarChart3,
  Calendar,
  Layers,
  Award,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import {
  apiClient,
  ApiClientError,
  type DecisionDto,
  type DecisionCalibrationDto,
  type PredictionDto,
} from '../api/index.js';

export interface ExpertCalibrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  decision: DecisionDto | null;
}

export const ExpertCalibrationModal: React.FC<ExpertCalibrationModalProps> = ({
  isOpen,
  onClose,
  decision,
}) => {
  const [activeTab, setActiveTab] = useState<'calibration' | 'predictions'>('calibration');
  const [calibrationData, setCalibrationData] = useState<DecisionCalibrationDto | null>(null);
  const [predictions, setPredictions] = useState<PredictionDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Predictions filter
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // New prediction form state
  const [isCreatingPrediction, setIsCreatingPrediction] = useState<boolean>(false);
  const [statement, setStatement] = useState<string>('');
  const [probability, setProbability] = useState<number>(0.75);
  const [targetDate, setTargetDate] = useState<string>('');
  const [domain, setDomain] = useState<string>('engineering');
  const [evidenceRef, setEvidenceRef] = useState<string>('');
  const [isSubmittingPred, setIsSubmittingPred] = useState<boolean>(false);

  // Record outcome state
  const [recordingPredictionId, setRecordingPredictionId] = useState<string | null>(null);
  const [observedOutcome, setObservedOutcome] = useState<number>(1);
  const [outcomeDate, setOutcomeDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [verificationSource, setVerificationSource] = useState<string>('');
  const [isSavingOutcome, setIsSavingOutcome] = useState<boolean>(false);

  // Dispute state
  const [disputingPredictionId, setDisputingPredictionId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState<string>('');
  const [isSavingDispute, setIsSavingDispute] = useState<boolean>(false);

  const fetchData = useCallback(async () => {
    if (!decision?._id) return;
    setIsLoading(true);
    setError(null);
    try {
      const [calRes, predRes] = await Promise.all([
        apiClient.getDecisionCalibration(decision._id),
        apiClient.getDecisionPredictions(decision._id),
      ]);
      setCalibrationData(calRes);
      setPredictions(predRes.items);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to load expert calibration intelligence.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [decision]);

  useEffect(() => {
    if (isOpen && decision?._id) {
      fetchData();
    }
  }, [isOpen, decision?._id, fetchData]);

  // Keyboard navigation: Escape key closes calibration modal
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

  const handleCreatePrediction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decision?._id || !statement.trim() || !targetDate) return;
    setIsSubmittingPred(true);
    setError(null);
    try {
      await apiClient.createPrediction(decision._id, {
        statement: statement.trim(),
        probability,
        targetDate: new Date(targetDate).toISOString(),
        domain,
        evidenceReferences: evidenceRef.trim() ? [evidenceRef.trim()] : [],
      });
      setStatement('');
      setTargetDate('');
      setEvidenceRef('');
      setIsCreatingPrediction(false);
      await fetchData();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to submit prospective prediction.');
      }
    } finally {
      setIsSubmittingPred(false);
    }
  };

  const handleRecordOutcome = async (predictionId: string) => {
    if (!decision?._id || !verificationSource.trim()) return;
    setIsSavingOutcome(true);
    setError(null);
    try {
      await apiClient.recordPredictionOutcome(decision._id, predictionId, {
        observedOutcome,
        outcomeDate: new Date(outcomeDate).toISOString(),
        verificationSource: verificationSource.trim(),
        verificationStatus: 'verified',
      });
      setRecordingPredictionId(null);
      setVerificationSource('');
      await fetchData();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to record outcome.');
      }
    } finally {
      setIsSavingOutcome(false);
    }
  };

  const handleDispute = async (predictionId: string) => {
    if (!decision?._id || !disputeReason.trim()) return;
    setIsSavingDispute(true);
    setError(null);
    try {
      await apiClient.disputePredictionOutcome(decision._id, predictionId, {
        disputeReason: disputeReason.trim(),
      });
      setDisputingPredictionId(null);
      setDisputeReason('');
      await fetchData();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to dispute outcome.');
      }
    } finally {
      setIsSavingDispute(false);
    }
  };

  if (!isOpen) return null;

  const filteredPredictions = predictions.filter(p => {
    if (statusFilter === 'all') return true;
    return p.status === statusFilter;
  });

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-sm overflow-y-auto"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="expert-calibration-title"
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-[1600px] bg-surface-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-hidden text-slate-100"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-accent-indigo/10 border border-accent-indigo/30 rounded-lg text-accent-indigo">
                <Target className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 id="expert-calibration-title" className="text-lg font-bold text-white tracking-wide">
                    Expert Calibration & Prediction Intelligence
                  </h2>
                  <span className="px-2 py-0.5 text-xs font-semibold bg-accent-indigo/10 text-accent-indigo border border-accent-indigo/20 rounded font-mono">
                    Methodology v1.0.0
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Verifiable empirical forecasts evaluated against observed real-world outcomes
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={fetchData}
                disabled={isLoading}
                title="Refresh Calibration Intelligence"
                aria-label="Refresh calibration intelligence"
                className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-surface-subtle transition cursor-pointer focus-visible:ring-2 focus-visible:ring-accent-indigo focus-visible:outline-none"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-surface-subtle transition cursor-pointer focus-visible:ring-2 focus-visible:ring-accent-indigo focus-visible:outline-none"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div
            role="tablist"
            aria-label="Calibration views"
            className="shrink-0 flex items-center justify-between px-4 sm:px-6 border-b border-border-subtle bg-surface-subtle/50 overflow-x-auto scrollbar-none"
          >
            <div className="flex space-x-4">
              <button
                role="tab"
                aria-selected={activeTab === 'calibration'}
                onClick={() => setActiveTab('calibration')}
                className={`py-3 text-sm font-medium border-b-2 transition flex items-center space-x-2 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent-indigo focus-visible:outline-none ${
                  activeTab === 'calibration'
                    ? 'border-accent-indigo text-accent-indigo'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span>Calibration & Dimensions</span>
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'predictions'}
                onClick={() => setActiveTab('predictions')}
                className={`py-3 text-sm font-medium border-b-2 transition flex items-center space-x-2 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent-indigo focus-visible:outline-none ${
                  activeTab === 'predictions'
                    ? 'border-accent-indigo text-accent-indigo'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Calendar className="w-4 h-4" />
                <span>Forecasts & Outcomes ({predictions.length})</span>
              </button>
            </div>

            <div className="text-xs text-slate-400 italic">
              Strictly Observational &bull; Never Modifies MCDA Scores or Weights
            </div>
          </div>

          {/* Main Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {error && (
              <div className="p-3 bg-red-950/50 border border-red-800 text-red-200 rounded-lg text-sm flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            {isLoading && !calibrationData && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-accent-indigo" />
                <p className="text-sm font-mono">Calculating empirical calibration metrics...</p>
              </div>
            )}

            {/* TAB 1: CALIBRATION & DIMENSIONS */}
            {activeTab === 'calibration' && calibrationData && (
              <div className="space-y-6">
                {/* Safeguard Alert for Sample Size */}
                {!calibrationData.hasSufficientSample && (
                  <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start space-x-3 text-amber-200 text-sm">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-amber-300">
                        Preliminary Sample Size ({calibrationData.verifiedCount} of {calibrationData.minimumSampleThreshold} required observations)
                      </h4>
                      <p className="text-xs text-amber-200/80 mt-1">
                        Statistical calibration requires at least {calibrationData.minimumSampleThreshold} verified prospective forecasts to compute reliable probabilistic metrics. Performance metrics below are preliminary and should not be used for evaluative ranking.
                      </p>
                    </div>
                  </div>
                )}

                {/* KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Brier Score Card */}
                  <div className="p-4 bg-surface border border-border rounded-xl">
                    <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                      <span>Brier Score (Probabilistic Error)</span>
                      <TrendingUp className="w-4 h-4 text-accent-indigo" />
                    </div>
                    <div className="text-2xl font-bold text-white tracking-tight font-mono">
                      {calibrationData.brierScore !== null ? calibrationData.brierScore : 'N/A'}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Lower is better (0.0 = perfect, 0.25 = uninformative 50/50 guessing).
                    </p>
                  </div>

                  {/* Expected Calibration Error */}
                  <div className="p-4 bg-surface border border-border rounded-xl">
                    <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                      <span>Expected Calibration Error (ECE)</span>
                      <Target className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="text-2xl font-bold text-white tracking-tight font-mono">
                      {calibrationData.expectedCalibrationError !== null
                        ? calibrationData.expectedCalibrationError
                        : 'N/A'}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Weighted gap between predicted probabilities and observed frequencies.
                    </p>
                  </div>

                  {/* Verified Observations */}
                  <div className="p-4 bg-surface border border-border rounded-xl">
                    <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                      <span>Verified Forecasts</span>
                      <ShieldCheck className="w-4 h-4 text-sky-400" />
                    </div>
                    <div className="text-2xl font-bold text-white tracking-tight font-mono">
                      {calibrationData.verifiedCount}
                      <span className="text-sm font-normal text-slate-400 ml-1.5">
                        / {calibrationData.totalPredictions} total
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {calibrationData.awaitingOutcomeCount} pending outcome &bull; {calibrationData.disputedCount} disputed.
                    </p>
                  </div>

                  {/* Climatology Skill Score */}
                  <div className="p-4 bg-surface border border-border rounded-xl">
                    <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                      <span>Brier Skill Score (BSS)</span>
                      <Award className="w-4 h-4 text-purple-400" />
                    </div>
                    <div className="text-2xl font-bold text-white tracking-tight font-mono">
                      {calibrationData.climatologyBss !== null
                        ? `${Math.round(calibrationData.climatologyBss * 100)}%`
                        : 'N/A'}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Skill relative to empirical sample base-rate reference.
                    </p>
                  </div>
                </div>

                {/* Reliability Diagram: Calibration Bins Table */}
                <div className="p-4 bg-surface border border-border rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                        <BarChart3 className="w-4 h-4 text-accent-indigo" />
                        <span>Reliability Diagram &bull; Calibration Bins</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Compares average forecast probability against observed event frequency across standard confidence intervals
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-surface-subtle text-slate-400 uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-3 py-2">Probability Range</th>
                          <th className="px-3 py-2">Forecast Count</th>
                          <th className="px-3 py-2">Mean Probability (p̄)</th>
                          <th className="px-3 py-2">Observed Rate (ō)</th>
                          <th className="px-3 py-2">Calibration Gap (|p̄ - ō|)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle">
                        {calibrationData.calibrationBins.map(bin => (
                          <tr key={bin.binIndex} className="hover:bg-surface-subtle/50 transition">
                            <td className="px-3 py-2 font-mono text-accent-indigo font-medium">
                              {bin.range}
                            </td>
                            <td className="px-3 py-2 text-slate-200 font-mono">
                              {bin.count}
                            </td>
                            <td className="px-3 py-2 text-slate-300 font-mono">
                              {bin.count > 0 ? `${Math.round(bin.meanPredictedProbability * 100)}%` : '—'}
                            </td>
                            <td className="px-3 py-2 text-slate-300 font-mono">
                              {bin.count > 0 ? `${Math.round(bin.observedFrequency * 100)}%` : '—'}
                            </td>
                            <td className="px-3 py-2 font-mono">
                              {bin.count > 0 ? (
                                <span
                                  className={
                                    bin.calibrationError <= 0.1
                                      ? 'text-emerald-400'
                                      : bin.calibrationError <= 0.25
                                      ? 'text-amber-400'
                                      : 'text-red-400'
                                  }
                                >
                                  {bin.calibrationError}
                                </span>
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Domain Breakdown */}
                {calibrationData.domainBreakdown.length > 0 && (
                  <div className="p-4 bg-surface border border-border rounded-xl space-y-3">
                    <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                      <Layers className="w-4 h-4 text-sky-400" />
                      <span>Domain Performance Segregation</span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      Predictive accuracy in one domain does not imply generalizable skill in others.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {calibrationData.domainBreakdown.map(dom => (
                        <div
                          key={dom.domain}
                          className="p-3 bg-surface-card border border-border-subtle rounded-lg flex flex-col justify-between"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                              {dom.domain}
                            </span>
                            <span className="text-xs text-slate-500 font-mono">
                              {dom.count} forecasts
                            </span>
                          </div>
                          <div className="mt-2 flex items-baseline justify-between">
                            <span className="text-xs text-slate-400">Brier Score:</span>
                            <span className="text-sm font-bold font-mono text-accent-indigo">
                              {dom.brierScore}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Separated Performance Dimensions (Participant Profiles) */}
                <div className="p-4 bg-surface border border-border rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                        <Award className="w-4 h-4 text-purple-400" />
                        <span>Separated Expert Dimensions</span>
                      </h3>
                      <p className="text-xs text-slate-400">
                        Individual participant profiles keeping calibration, experience, citations, recency, and social consensus separate.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {calibrationData.expertProfiles.map(prof => (
                      <div
                        key={prof.contributorId}
                        className="p-3.5 bg-surface-card border border-border-subtle rounded-lg space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm text-white">
                            {prof.contributorName}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded bg-surface border border-border text-slate-300 font-mono">
                            {prof.experience.verifiedPredictions} verified forecasts
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          {/* Calibration */}
                          <div className="p-2 bg-surface rounded border border-border-subtle">
                            <span className="text-slate-400 block text-[10px] uppercase">Calibration</span>
                            <span className="font-mono font-semibold text-accent-indigo">
                              {prof.calibration.hasSufficientSample
                                ? `BS: ${prof.calibration.brierScore}`
                                : 'Sample < 3'}
                            </span>
                          </div>

                          {/* Experience */}
                          <div className="p-2 bg-surface rounded border border-border-subtle">
                            <span className="text-slate-400 block text-[10px] uppercase">Experience</span>
                            <span className="text-slate-200 font-mono">
                              {prof.experience.totalContributions} contr. &bull; {prof.experience.totalPredictions} preds
                            </span>
                          </div>

                          {/* Evidence Quality */}
                          <div className="p-2 bg-surface rounded border border-border-subtle">
                            <span className="text-slate-400 block text-[10px] uppercase">Evidence Citations</span>
                            <span className="text-emerald-400 font-semibold font-mono">
                              {prof.evidenceQuality.citationsProvided} citations
                            </span>
                          </div>

                          {/* Popularity (Social Signal) */}
                          <div className="p-2 bg-surface rounded border border-border-subtle">
                            <span className="text-slate-400 block text-[10px] uppercase">Social Consensus</span>
                            <span className="text-slate-300 font-mono">
                              {prof.popularity.preferredOptionAgreementRate !== null
                                ? `${Math.round(prof.popularity.preferredOptionAgreementRate * 100)}% agreement`
                                : 'N/A'}
                            </span>
                          </div>
                        </div>

                        <p className="text-[10px] text-slate-500 italic">
                          {prof.popularity.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Mathematical Transparency Documentation */}
                <div className="p-3.5 bg-surface border border-border rounded-lg text-xs space-y-1 text-slate-400">
                  <div className="font-semibold text-slate-300 text-[11px] uppercase tracking-wider">
                    Mathematical Governance & Formula Transparency
                  </div>
                  <div className="font-mono text-[11px] text-accent-indigo">
                    Brier Score: {calibrationData.formulaDocumentation.brierScore}
                  </div>
                  <div className="font-mono text-[11px] text-accent-indigo">
                    ECE: {calibrationData.formulaDocumentation.ece}
                  </div>
                  <div className="font-mono text-[11px] text-accent-indigo">
                    BSS: {calibrationData.formulaDocumentation.bss}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: FORECASTS & OUTCOMES */}
            {activeTab === 'predictions' && (
              <div className="space-y-6">
                {/* Actions Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-slate-400 font-mono">Status:</span>
                    {['all', 'awaiting_outcome', 'verified', 'disputed'].map(st => (
                      <button
                        key={st}
                        onClick={() => setStatusFilter(st)}
                        className={`px-2.5 py-1 text-xs rounded-lg transition capitalize ${
                          statusFilter === st
                            ? 'bg-accent-indigo text-slate-950 font-bold shadow-glow-indigo-sm'
                            : 'bg-surface border border-border text-slate-400 hover:text-white'
                        }`}
                      >
                        {st.replace('_', ' ')}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => setIsCreatingPrediction(prev => !prev)}
                    className="px-3 py-1.5 bg-signal hover:bg-signal-light text-slate-950 text-xs font-bold rounded-lg shadow-glow-signal-sm transition flex items-center space-x-1.5"
                  >
                    <Target className="w-3.5 h-3.5" />
                    <span>{isCreatingPrediction ? 'Cancel' : 'Submit Prospective Forecast'}</span>
                  </button>
                </div>

                {/* New Prediction Form */}
                {isCreatingPrediction && (
                  <form
                    onSubmit={handleCreatePrediction}
                    className="p-4 bg-surface border border-border rounded-xl space-y-4"
                  >
                    <div className="flex items-center justify-between border-b border-border-subtle pb-2">
                      <h4 className="text-sm font-semibold text-white flex items-center space-x-2">
                        <Target className="w-4 h-4 text-accent-indigo" />
                        <span>Submit Prospective Forecast</span>
                      </h4>
                      <span className="text-xs text-amber-300 font-mono">
                        Must precede real-world outcome
                      </span>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-slate-300 block">
                        Prediction Statement (verifiable empirical proposition)
                      </label>
                      <textarea
                        value={statement}
                        onChange={e => setStatement(e.target.value)}
                        placeholder="e.g. Option Alpha will process over 50,000 requests/second under sustained load."
                        className="w-full bg-surface-subtle border border-border rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent-indigo"
                        rows={2}
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-slate-300 block mb-1">
                          Probability: <span className="font-bold text-accent-indigo font-mono">{Math.round(probability * 100)}%</span>
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={probability}
                          onChange={e => setProbability(parseFloat(e.target.value))}
                          className="w-full accent-accent-indigo"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-slate-300 block mb-1">
                          Target Date (future deadline)
                        </label>
                        <input
                          type="date"
                          value={targetDate}
                          onChange={e => setTargetDate(e.target.value)}
                          min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                          className="w-full bg-surface-subtle border border-border rounded-lg p-2 text-xs text-white focus:outline-none focus:border-accent-indigo"
                          required
                        />
                      </div>

                      <div>
                        <label className="text-xs text-slate-300 block mb-1">
                          Domain
                        </label>
                        <select
                          value={domain}
                          onChange={e => setDomain(e.target.value)}
                          className="w-full bg-surface-subtle border border-border rounded-lg p-2 text-xs text-white focus:outline-none focus:border-accent-indigo"
                        >
                          <option value="engineering">Engineering</option>
                          <option value="finance">Finance</option>
                          <option value="security">Security</option>
                          <option value="operations">Operations</option>
                          <option value="legal">Legal</option>
                          <option value="general">General</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-slate-300 block mb-1">
                        Supporting Evidence Citation / Benchmark Reference (optional)
                      </label>
                      <input
                        type="text"
                        value={evidenceRef}
                        onChange={e => setEvidenceRef(e.target.value)}
                        placeholder="https://..."
                        className="w-full bg-surface-subtle border border-border rounded-lg p-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent-indigo"
                      />
                    </div>

                    <div className="flex justify-end space-x-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setIsCreatingPrediction(false)}
                        className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmittingPred}
                        className="px-4 py-1.5 bg-signal hover:bg-signal-light text-slate-950 text-xs font-bold rounded-lg shadow-glow-signal-sm transition flex items-center space-x-1.5"
                      >
                        {isSubmittingPred ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        <span>Submit Prospective Forecast</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* Predictions Listing */}
                {filteredPredictions.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 space-y-2">
                    <Calendar className="w-8 h-8 mx-auto text-slate-600" />
                    <p className="text-sm font-medium">No predictions found matching the filter.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredPredictions.map(p => (
                      <div
                        key={p.predictionId}
                        className="p-4 bg-surface border border-border rounded-xl space-y-3"
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <span className="font-semibold text-sm text-white">
                                {p.statement}
                              </span>
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded capitalize font-mono ${
                                  p.status === 'verified'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : p.status === 'disputed'
                                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                    : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                                }`}
                              >
                                {p.status.replace('_', ' ')}
                              </span>
                            </div>

                            <div className="flex items-center space-x-3 text-xs text-slate-400">
                              <span>By: <strong className="text-slate-300">{p.contributorName}</strong></span>
                              <span>&bull;</span>
                              <span>Domain: <strong className="text-slate-300 capitalize">{p.domain}</strong></span>
                              <span>&bull;</span>
                              <span>Submitted: {new Date(p.submittedAt).toLocaleDateString()}</span>
                              <span>&bull;</span>
                              <span>Target: {new Date(p.targetDate).toLocaleDateString()}</span>
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-xs text-slate-400 block">Stated Probability</span>
                            <span className="text-lg font-bold font-mono text-accent-indigo">
                              {Math.round(p.probability * 100)}%
                            </span>
                          </div>
                        </div>

                        {/* Outcome Details */}
                        {p.outcome && (
                          <div className="p-3 bg-surface-card border border-border-subtle rounded-lg text-xs space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-300 flex items-center space-x-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                <span>
                                  Observed Outcome:{' '}
                                  <strong className={p.outcome.observedOutcome === 1 ? 'text-emerald-400' : 'text-rose-400'}>
                                    {p.outcome.observedOutcome === 1 ? 'Event Occurred (1)' : 'Event Did Not Occur (0)'}
                                  </strong>
                                </span>
                              </span>
                              <span className="text-[11px] text-slate-500 font-mono">
                                Verified by {p.outcome.verifiedByName || 'Authorized User'} on{' '}
                                {new Date(p.outcome.outcomeDate).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="text-slate-400 text-[11px]">
                              Verification Source: <span className="text-slate-300 font-mono">{p.outcome.verificationSource}</span>
                            </div>
                            {p.outcome.disputeReason && (
                              <div className="p-2 bg-rose-500/10 border border-rose-500/20 rounded text-rose-300 text-[11px]">
                                Disputed: {p.outcome.disputeReason}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Outcome & Dispute Action Drawers */}
                        <div className="flex items-center justify-end space-x-2 pt-1 border-t border-border-subtle text-xs">
                          {p.status === 'awaiting_outcome' && (
                            <button
                              onClick={() => setRecordingPredictionId(p.predictionId)}
                              className="px-3 py-1 bg-surface hover:bg-surface-subtle border border-border text-slate-200 rounded transition flex items-center space-x-1 cursor-pointer"
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Record Verified Outcome</span>
                            </button>
                          )}

                          {p.status === 'verified' && (
                            <button
                              onClick={() => setDisputingPredictionId(p.predictionId)}
                              className="px-3 py-1 bg-surface hover:bg-surface-subtle border border-border text-slate-200 rounded transition flex items-center space-x-1 text-rose-300 hover:text-rose-200 cursor-pointer"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Dispute Outcome</span>
                            </button>
                          )}
                        </div>

                        {/* Record Outcome Drawer */}
                        {recordingPredictionId === p.predictionId && (
                          <div className="p-3 bg-surface-card border border-emerald-500/30 rounded-lg space-y-3 mt-2">
                            <h5 className="font-semibold text-xs text-emerald-300">
                              Record Verified Real-World Outcome
                            </h5>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                              <div>
                                <label className="text-slate-400 block mb-1">Observed Outcome</label>
                                <select
                                  value={observedOutcome}
                                  onChange={e => setObservedOutcome(parseInt(e.target.value, 10))}
                                  className="w-full bg-surface-subtle border border-border rounded p-1.5 text-white"
                                >
                                  <option value={1}>1 — Event Occurred as Predicted</option>
                                  <option value={0}>0 — Event Did Not Occur</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-slate-400 block mb-1">Outcome Date</label>
                                <input
                                  type="date"
                                  value={outcomeDate}
                                  onChange={e => setOutcomeDate(e.target.value)}
                                  className="w-full bg-surface-subtle border border-border rounded p-1.5 text-white"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-slate-400 block mb-1 text-xs">
                                Verification Source / Empirical Benchmark Reference
                              </label>
                              <input
                                type="text"
                                value={verificationSource}
                                onChange={e => setVerificationSource(e.target.value)}
                                placeholder="e.g. Audit log #214, Datadog metric report, Third-party benchmark URL"
                                className="w-full bg-surface-subtle border border-border rounded p-1.5 text-xs text-white placeholder-slate-500"
                              />
                            </div>
                            <div className="flex justify-end space-x-2">
                              <button
                                onClick={() => setRecordingPredictionId(null)}
                                className="px-2.5 py-1 text-slate-400 hover:text-white text-xs"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleRecordOutcome(p.predictionId)}
                                disabled={isSavingOutcome || !verificationSource.trim()}
                                className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded shadow-sm"
                              >
                                {isSavingOutcome ? 'Saving...' : 'Confirm Outcome'}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Dispute Drawer */}
                        {disputingPredictionId === p.predictionId && (
                          <div className="p-3 bg-surface-card border border-rose-500/30 rounded-lg space-y-3 mt-2">
                            <h5 className="font-semibold text-xs text-rose-300">
                              Dispute Outcome Verification
                            </h5>
                            <textarea
                              value={disputeReason}
                              onChange={e => setDisputeReason(e.target.value)}
                              placeholder="Document the technical or empirical reason this verified outcome is disputed..."
                              className="w-full bg-surface-subtle border border-border rounded p-2 text-xs text-white placeholder-slate-500"
                              rows={2}
                            />
                            <div className="flex justify-end space-x-2">
                              <button
                                onClick={() => setDisputingPredictionId(null)}
                                className="px-2.5 py-1 text-slate-400 hover:text-white text-xs"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleDispute(p.predictionId)}
                                disabled={isSavingDispute || !disputeReason.trim()}
                                className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded"
                              >
                                {isSavingDispute ? 'Saving...' : 'Submit Dispute'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
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

