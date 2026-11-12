import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Layers,
  Copy,
  Check,
  Award,
  Sliders,
  RotateCcw,
  Save,
  Database,
  Plus,
  AlertTriangle,
  Loader2,
  Table,
  CheckCircle2,
  Clock,
  Sparkles,
  ChevronDown,
  Share2,
  Eye,
  Users,
  Lock,
  BookOpen,
  BarChart3,
  Scale,
  Target,
  History,
  ShieldCheck,
  Calculator,
  RefreshCw,
  Hash,
  Zap,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { templateDatasets } from '../data/decisionData.js';
import { useDecisionModel } from '../hooks/useDecisionModel.js';
import { WeightSlider } from './WeightSlider.js';
import { RealtimePresenceBar } from './RealtimePresenceBar.js';
import { AlternativesManager } from './AlternativesManager.js';
import { CriteriaManager } from './CriteriaManager.js';
import { ScoreMatrix } from './ScoreMatrix.js';
import { useRealtimeCollaboration } from '../hooks/useRealtimeCollaboration.js';
import type { DecisionDto } from '../api/types.js';
import { sound } from '../utils/audioFx.js';
import { useAuth } from '../hooks/useAuth.js';

// Lazy-load secondary modal dialogs for code-splitting and bundle reduction
const ShareModal = React.lazy(() => import('./ShareModal.js').then(m => ({ default: m.ShareModal })));
const ContributionsModal = React.lazy(() => import('./ContributionsModal.js').then(m => ({ default: m.ContributionsModal })));
const EvidenceModal = React.lazy(() => import('./EvidenceModal.js').then(m => ({ default: m.EvidenceModal })));
const AiAnalystModal = React.lazy(() => import('./AiAnalystModal.js').then(m => ({ default: m.AiAnalystModal })));
const AnalyticsModal = React.lazy(() => import('./AnalyticsModal.js').then(m => ({ default: m.AnalyticsModal })));
const DisagreementsModal = React.lazy(() => import('./DisagreementsModal.js').then(m => ({ default: m.DisagreementsModal })));
const ExpertCalibrationModal = React.lazy(() => import('./ExpertCalibrationModal.js').then(m => ({ default: m.ExpertCalibrationModal })));
const AuditExportModal = React.lazy(() => import('./AuditExportModal.js').then(m => ({ default: m.AuditExportModal })));

interface InteractiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  model?: ReturnType<typeof useDecisionModel>;
}

export type ActiveWorkspaceTab = 'matrix' | 'weights' | 'alternatives' | 'analysis';

export const InteractiveModal: React.FC<InteractiveModalProps> = ({
  isOpen,
  onClose,
  model: externalModel,
}) => {
  const localModel = useDecisionModel(templateDatasets[0]);
  const model = externalModel ?? localModel;

  const {
    dataset,
    criteria,
    options,
    weights,
    lockedIds,
    engineResult,
    setCriterionWeight,
    toggleLock,
    resetToDefaults,
    switchDataset,
    mode,
    decisionId,
    serverDecision,
    currentUserRole = 'owner',
    isDirty,
    isAuthoritative,
    isEvaluationStale,
    saveStatus,
    apiError,
    conflictState,
    dismissConflict,
    saveDecision,
    loadDecision,
    listSavedDecisions,
    createNewDecision,
    updateOptionScore,
    updateDecisionMetadata,
    clearApiError,
    scoreProvenance,
    clearSyntheticScores,
    populateSyntheticDemo,

    // Batch 3 CRUD & Calculation
    addAlternative,
    renameAlternative,
    updateAlternative,
    removeAlternative,
    addCriterion,
    renameCriterion,
    updateCriterion,
    removeCriterion,
    calculateAuthoritative,
    getMissingScores,
    isScoreMatrixComplete,
  } = model;

  const { isAuthenticated, openAuthModal } = useAuth();

  const [activeTab, setActiveTab] = useState<ActiveWorkspaceTab>('matrix');
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState<number | null>(0);
  const [copied, setCopied] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isContributionsModalOpen, setIsContributionsModalOpen] = useState(false);
  const [isEvidenceModalOpen, setIsEvidenceModalOpen] = useState(false);
  const [isAiAnalystModalOpen, setIsAiAnalystModalOpen] = useState(false);
  const [isAnalyticsModalOpen, setIsAnalyticsModalOpen] = useState(false);
  const [isDisagreementsModalOpen, setIsDisagreementsModalOpen] = useState(false);
  const [isCalibrationModalOpen, setIsCalibrationModalOpen] = useState(false);
  const [isAuditExportModalOpen, setIsAuditExportModalOpen] = useState(false);
  const [isSavedListOpen, setIsSavedListOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(dataset.title);
  const [editContext, setEditContext] = useState(dataset.context);
  const [savedDecisions, setSavedDecisions] = useState<DecisionDto[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);

  const isOperationInFlight = saveStatus === 'in_flight' || isCalculating;
  const missingScoresList = getMissingScores();
  const isComplete = isScoreMatrixComplete();

  const { winner, runnerUp, explainability, sensitivity } = engineResult;

  const accessibleTipping = sensitivity?.find(
    (s) => s.tippingPointWeight !== null && s.weightDeltaNeeded !== null && s.wouldFlipToOptionId !== null
  );

  const {
    connectionStatus,
    activeParticipants,
    conflictState: realtimeConflict,
    dismissConflict: dismissRealtimeConflict,
    reconnect,
  } = useRealtimeCollaboration({
    decisionId,
    enabled: isOpen && !!decisionId && mode === 'saved',
    isDirty,
    currentView: 'workspace',
    onDecisionUpdated: () => {
      if (decisionId) {
        loadDecision(decisionId);
      }
    },
    onCalculationUpdated: () => {
      if (decisionId) {
        loadDecision(decisionId);
      }
    },
  });

  const handleStartEditTitle = () => {
    if (isOperationInFlight) return;
    setEditTitle(dataset.title);
    setEditContext(dataset.context);
    setIsEditingTitle(true);
  };

  const handleTemplateChange = (idx: number) => {
    if (isOperationInFlight) return;
    setSelectedTemplateIndex(idx);
    setIsSavedListOpen(false);
    switchDataset(templateDatasets[idx]);
  };

  const handleOpenSavedList = async () => {
    if (isOperationInFlight) return;
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    setIsSavedListOpen((prev) => !prev);
    if (!isSavedListOpen) {
      setIsLoadingSaved(true);
      try {
        const res = await listSavedDecisions({ limit: 15 });
        setSavedDecisions(res.items);
      } catch {
        setSavedDecisions([]);
      } finally {
        setIsLoadingSaved(false);
      }
    }
  };

  const handleSelectSavedDecision = async (id: string) => {
    if (isOperationInFlight) return;
    setSelectedTemplateIndex(null);
    setIsSavedListOpen(false);
    await loadDecision(id);
  };

  const handleCreateNew = () => {
    if (isOperationInFlight) return;
    setSelectedTemplateIndex(null);
    setIsSavedListOpen(false);
    createNewDecision();
  };

  const handleSaveTitle = () => {
    if (isOperationInFlight) return;
    if (editTitle.trim()) {
      updateDecisionMetadata(editTitle.trim(), editContext.trim());
      setIsEditingTitle(false);
    }
  };

  const handleSaveToServer = async () => {
    if (isOperationInFlight) return;
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    sound.playTick();
    const result = await saveDecision();
    if (result) {
      sound.playCelebrate();
      confetti({
        particleCount: 60,
        spread: 60,
        origin: { y: 0.6 },
      });
    }
  };

  const handleRunAuthoritativeCalculation = async () => {
    if (isOperationInFlight) return;
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }

    if (!isComplete) {
      setActiveTab('matrix');
      return;
    }

    setIsCalculating(true);
    sound.playTick();

    try {
      const result = await calculateAuthoritative();
      if (result) {
        sound.playCelebrate();
        confetti({
          particleCount: 90,
          spread: 75,
          origin: { y: 0.6 },
        });
        setActiveTab('analysis');
      }
    } catch {
      // Error handled in hook and surfaced via apiError state
    } finally {
      setIsCalculating(false);
    }
  };

  const handleExportBriefing = () => {
    const { winner, evaluations, explainability, isTie, tiedWinnerIds } = engineResult;

    const report = `# Decision OS — Decision Briefing
Generated: ${new Date().toLocaleDateString()}
Decision Prompt: "${dataset.question}"
${decisionId ? `Server Decision ID: ${decisionId}` : 'Status: Unsaved Draft / Preview'}
Verification: ${
      isAuthoritative
        ? `Authoritative Server MCDA (Canonical Engine v${serverDecision?.analysis?.engineVersion || '1.0.0'})`
        : 'Client Preview'
    }

## Outcome
${
  engineResult.isIncomplete || engineResult.isInvalid
    ? (engineResult.isInvalid
        ? `⚠️ **Invalid Decision Input (${engineResult.invalidReason === 'scores' ? 'Invalid Scores' : 'Invalid Weights'})**\n${engineResult.errorMessage || explainability.dynamicRationale}`
        : `⚠️ **Evaluation Incomplete**\n${explainability.dynamicRationale}`)
    : isTie
    ? `🤝 **Mathematical Tie** between: ${(tiedWinnerIds || []).join(', ')}`
    : `🏆 **${winner ? winner.option.name : 'No Winner'}** (Weighted Score: ${winner ? winner.weightedScore : 0}/100)
${explainability.headline}`
}

## Explainability Summary
${explainability.dynamicRationale}

${explainability.sensitivityStatement}

## Full Option Rankings
${evaluations
  .map(
    (e, idx) =>
      `${e.rank !== null && e.rank !== undefined ? `${e.rank}.` : `${idx + 1}. [Unranked]`} **${e.option.name}** — ${e.weightedScore} pts (${e.option.badge || ''})`
  )
  .join('\n')}

## Criteria Weight Allocation
${criteria
  .map(
    (c) =>
      winner
        ? `- **${c.name}**: ${weights[c.id]}% (Raw winner score: ${winner.option.scores?.[c.id] ?? 0}/100)`
        : `- **${c.name}**: ${weights[c.id]}% (Winner score: N/A)`
  )
  .join('\n')}

---
*Created with Decision OS — Make decisions you can explain.*
`;

    navigator.clipboard.writeText(report);
    setCopied(true);
    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.6 },
    });
    setTimeout(() => setCopied(false), 3000);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-y-auto bg-background/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.25 }}
          className="relative w-full max-w-6xl max-h-[94vh] flex flex-col rounded-2xl bg-surface-card border border-border shadow-2xl overflow-hidden"
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between p-3.5 sm:p-5 border-b border-border bg-surface shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-signal">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base sm:text-lg font-bold text-white">
                    Decision OS Workspace
                  </h3>

                  {/* Status Pills */}
                  {isAuthoritative ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-signal/15 text-signal border border-signal/30 flex items-center gap-1 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse" />
                      <span>Authoritative MCDA (v1.0.0)</span>
                      {decisionId && (
                        <span className="opacity-70 text-[9px]">#{decisionId.slice(-6)}</span>
                      )}
                    </span>
                  ) : isEvaluationStale ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      <span>Evaluation Stale · Recalculation Required</span>
                    </span>
                  ) : mode === 'draft' ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-accent-amber/15 text-accent-amber border border-accent-amber/30 flex items-center gap-1 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-amber" />
                      <span>Unsaved Draft</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-surface-subtle text-slate-400 border border-border flex items-center gap-1">
                      <span>Template Mode</span>
                    </span>
                  )}

                  {/* Role Indicators */}
                  {decisionId && currentUserRole === 'viewer' && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-500/15 text-sky-400 border border-sky-500/30 flex items-center gap-1 font-semibold">
                      <Eye className="w-3 h-3" />
                      <span>Viewer Mode</span>
                    </span>
                  )}
                  {decisionId && currentUserRole === 'editor' && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 font-semibold">
                      <Users className="w-3 h-3" />
                      <span>Editor</span>
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-400 mt-0.5">
                  Configure alternatives and criteria, calibrate weights, enter scores, and execute authoritative MCDA calculations.
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-surface-subtle hover:bg-surface border border-border text-slate-400 hover:text-white transition-all cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Realtime Collaboration Presence Bar */}
          {decisionId && mode === 'saved' && (
            <RealtimePresenceBar
              connectionStatus={connectionStatus}
              activeParticipants={activeParticipants}
              conflictState={realtimeConflict}
              onDismissConflict={dismissRealtimeConflict}
              onReviewConflict={() => {
                if (decisionId) {
                  loadDecision(decisionId);
                  dismissRealtimeConflict();
                }
              }}
              onReconnect={reconnect}
            />
          )}

          {/* Template & Saved Selector Ribbon */}
          <div className="p-2.5 sm:p-3 bg-surface-subtle/50 border-b border-border-subtle flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="text-xs font-mono text-slate-400 mr-1 hidden sm:inline">Templates:</span>
              {templateDatasets.map((t, idx) => (
                <button
                  key={t.id}
                  onClick={() => handleTemplateChange(idx)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border cursor-pointer ${
                    selectedTemplateIndex === idx && mode === 'template'
                      ? 'bg-signal text-background border-signal font-bold shadow-sm'
                      : 'bg-surface border-border text-slate-300 hover:text-white hover:border-slate-600'
                  }`}
                >
                  {t.title}
                </button>
              ))}

              <button
                onClick={handleCreateNew}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border flex items-center gap-1 cursor-pointer ${
                  mode === 'draft' && selectedTemplateIndex === null
                    ? 'bg-signal text-background border-signal font-bold shadow-sm'
                    : 'bg-surface border-border text-slate-300 hover:text-white hover:border-slate-600'
                }`}
                title="Create a new custom decision"
              >
                <Plus className="w-3 h-3" />
                <span>New Decision</span>
              </button>
            </div>

            {/* Saved Decisions Dropdown Trigger */}
            <div className="relative">
              <button
                onClick={handleOpenSavedList}
                className={`px-3 py-1 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-all border cursor-pointer ${
                  isSavedListOpen || mode === 'saved'
                    ? 'bg-surface border-signal/50 text-signal shadow-glow-signal-sm'
                    : 'bg-surface border-border text-slate-300 hover:text-white hover:border-slate-500'
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                <span>Saved Decisions</span>
                <ChevronDown
                  className={`w-3 h-3 transition-transform ${isSavedListOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {/* Saved Records Dropdown Popover */}
              <AnimatePresence>
                {isSavedListOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    className="absolute right-0 top-full mt-2 w-72 sm:w-80 bg-surface-card border border-border rounded-xl shadow-2xl p-2 z-50 overflow-hidden"
                  >
                    <div className="p-2 border-b border-border-subtle flex items-center justify-between">
                      <span className="text-[11px] font-mono text-slate-400 font-bold uppercase">
                        MongoDB Persisted Decisions
                      </span>
                    </div>

                    <div className="max-h-56 overflow-y-auto space-y-1 p-1">
                      {isLoadingSaved ? (
                        <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-signal" />
                          <span>Loading from database...</span>
                        </div>
                      ) : savedDecisions.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-500 font-mono">
                          No saved decisions found. Save your current model to view it here!
                        </div>
                      ) : (
                        savedDecisions.map((doc) => (
                          <button
                            key={doc._id}
                            onClick={() => handleSelectSavedDecision(doc._id)}
                            className={`w-full p-2.5 rounded-lg text-left text-xs transition-all border flex flex-col gap-0.5 cursor-pointer ${
                              decisionId === doc._id
                                ? 'bg-signal/15 border-signal/40 text-white'
                                : 'bg-surface hover:bg-surface-subtle border-border-subtle text-slate-300 hover:text-white'
                            }`}
                          >
                            <span className="font-bold truncate text-white">{doc.title}</span>
                            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                              <span>#{doc._id.slice(-6)}</span>
                              <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Active Error Banner */}
          {apiError && (
            <div className="p-3 bg-accent-rose/10 border-b border-accent-rose/30 flex items-start justify-between gap-3 text-xs text-accent-rose">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold uppercase tracking-wider block">
                    {apiError.error || 'Server Error'} (Status {apiError.statusCode || 'Offline'})
                  </span>
                  <p className="text-slate-200 mt-0.5 leading-relaxed">{apiError.message}</p>
                  {apiError.missingPairs && apiError.missingPairs.length > 0 && (
                    <div className="mt-1 text-[11px] font-mono text-accent-amber">
                      Missing score coordinates:{' '}
                      {apiError.missingPairs
                        .map((p) => `[Option: ${p.optionId}, Criterion: ${p.criterionId}]`)
                        .join(', ')}
                    </div>
                  )}
                  {apiError.requestId && (
                    <span className="text-[10px] font-mono text-slate-400 block mt-1">
                      Trace Request ID: {apiError.requestId}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={clearApiError}
                  className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
                  aria-label="Dismiss error"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Concurrency Conflict Banner */}
          {conflictState?.isConflict && (
            <div className="p-3.5 bg-amber-500/15 border-b border-amber-500/30 flex items-center justify-between gap-3 text-xs text-amber-200">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  <strong>Concurrency Conflict:</strong> Another collaborator updated this decision (current version: {conflictState.currentVersion}). Please reload to fetch the latest state.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {decisionId && (
                  <button
                    onClick={async () => {
                      dismissConflict();
                      await loadDecision(decisionId);
                    }}
                    className="px-3 py-1 rounded bg-amber-500 hover:bg-amber-600 text-background font-mono font-bold text-xs cursor-pointer flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Reload Latest</span>
                  </button>
                )}
                <button
                  onClick={dismissConflict}
                  className="p-1 rounded text-amber-300 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Workspace Navigation Tabs */}
          <div className="px-4 sm:px-6 pt-3 bg-surface border-b border-border flex items-center justify-between gap-3 overflow-x-auto shrink-0">
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={() => setActiveTab('alternatives')}
                className={`px-3 py-2 rounded-t-lg text-xs font-mono font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
                  activeTab === 'alternatives'
                    ? 'border-signal text-signal bg-surface-card'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold ${
                  options.length >= 2 ? 'bg-signal/20 text-signal border border-signal/30' : 'bg-surface-subtle text-slate-400'
                }`}>1</span>
                <Layers className="w-3.5 h-3.5" />
                <span>Alternatives ({options.length})</span>
              </button>

              <button
                onClick={() => setActiveTab('weights')}
                className={`px-3 py-2 rounded-t-lg text-xs font-mono font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
                  activeTab === 'weights'
                    ? 'border-signal text-signal bg-surface-card'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold ${
                  criteria.length >= 1 ? 'bg-signal/20 text-signal border border-signal/30' : 'bg-surface-subtle text-slate-400'
                }`}>2</span>
                <Sliders className="w-3.5 h-3.5" />
                <span>Weights & Criteria ({criteria.length})</span>
              </button>

              <button
                onClick={() => setActiveTab('matrix')}
                className={`px-3 py-2 rounded-t-lg text-xs font-mono font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
                  activeTab === 'matrix'
                    ? 'border-signal text-signal bg-surface-card'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold ${
                  isComplete ? 'bg-signal/20 text-signal border border-signal/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}>3</span>
                <Table className="w-3.5 h-3.5" />
                <span>Score Matrix</span>
                {!isComplete ? (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title={`${missingScoresList.length} scores missing`} />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-signal" />
                )}
              </button>

              <button
                onClick={() => setActiveTab('analysis')}
                className={`px-3 py-2 rounded-t-lg text-xs font-mono font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
                  activeTab === 'analysis'
                    ? 'border-signal text-signal bg-surface-card'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold ${
                  isAuthoritative ? 'bg-signal/20 text-signal border border-signal/30' : 'bg-surface-subtle text-slate-400'
                }`}>4</span>
                <Award className="w-3.5 h-3.5" />
                <span>Authoritative Results</span>
                {isAuthoritative && (
                  <span className="w-1.5 h-1.5 rounded-full bg-signal" />
                )}
              </button>
            </div>

            {/* Run Authoritative Calculation Action Button */}
            {currentUserRole !== 'viewer' && currentUserRole !== 'contributor' && (
              <button
                onClick={handleRunAuthoritativeCalculation}
                disabled={isCalculating || !isComplete}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all cursor-pointer shrink-0 mb-1.5 ${
                  isCalculating
                    ? 'bg-surface border border-border text-slate-400 cursor-not-allowed'
                    : !isComplete
                      ? 'bg-surface border border-amber-500/40 text-amber-300 opacity-80 hover:opacity-100'
                      : isEvaluationStale || !isAuthoritative
                        ? 'bg-signal hover:bg-signal-light text-background shadow-glow-signal-sm'
                        : 'bg-surface hover:bg-surface-subtle border border-signal/50 text-signal shadow-sm'
                }`}
                title={
                  !isComplete
                    ? `Cannot calculate: ${missingScoresList.length} scores missing in matrix`
                    : 'Run server-side MCDA analysis on Canonical Engine v1.0.0'
                }
              >
                {isCalculating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-signal" />
                    <span>Calculating...</span>
                  </>
                ) : !isComplete ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span>Incomplete Matrix ({missingScoresList.length} missing)</span>
                  </>
                ) : isEvaluationStale || !isAuthoritative ? (
                  <>
                    <Calculator className="w-3.5 h-3.5" />
                    <span>Run Authoritative Calculation</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-signal" />
                    <span>Recalculate Results</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Modal Scrollable Body */}
          <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
            {/* Target Question Scope & Leading Winner Card */}
            <div className="p-4 rounded-xl bg-surface/80 border border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono uppercase text-signal tracking-wider">
                    Target Dilemma & Framing
                  </span>
                  {!isEditingTitle && currentUserRole !== 'viewer' && (
                    <button
                      onClick={handleStartEditTitle}
                      disabled={isOperationInFlight}
                      className={`text-[11px] font-mono flex items-center gap-1 ${
                        isOperationInFlight
                          ? 'text-slate-600 cursor-not-allowed'
                          : 'text-slate-400 hover:text-slate-200 cursor-pointer'
                      }`}
                    >
                      <Sparkles className="w-3 h-3 text-signal" />
                      <span>Edit Title</span>
                    </button>
                  )}
                </div>

                {isEditingTitle ? (
                  <div className="space-y-2 mt-1">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Enter decision title..."
                      className="w-full px-3 py-1.5 rounded-lg bg-surface-card border border-signal/50 text-white text-sm font-bold focus:outline-none"
                    />
                    <input
                      type="text"
                      value={editContext}
                      onChange={(e) => setEditContext(e.target.value)}
                      placeholder="Context or dilemma statement..."
                      className="w-full px-3 py-1.5 rounded-lg bg-surface-card border border-border text-slate-300 text-xs focus:outline-none"
                    />
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={handleSaveTitle}
                        className="px-3 py-1 rounded bg-signal text-background font-bold text-xs cursor-pointer"
                      >
                        Apply
                      </button>
                      <button
                        onClick={() => setIsEditingTitle(false)}
                        className="px-3 py-1 rounded bg-surface border border-border text-slate-400 text-xs cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h4 className="text-base sm:text-lg font-bold text-white mt-0.5">
                      "{dataset.question}"
                    </h4>
                    <p className="text-xs text-slate-400 mt-1">{dataset.context}</p>
                  </>
                )}
              </div>

              {/* Authoritative Outcome Pill */}
              <div className="flex items-center gap-3 bg-surface-card p-3 rounded-xl border border-border shrink-0">
                <Award className="w-5 h-5 text-signal shrink-0" />
                <div>
                  <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center gap-1.5">
                    <span>Leading Outcome</span>
                    {isAuthoritative && (
                      <span className="text-signal flex items-center gap-0.5 font-bold">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Verified</span>
                      </span>
                    )}
                  </div>
                  {engineResult.isIncomplete || engineResult.isInvalid ? (
                    <div className="text-xs font-mono text-amber-400">
                      {engineResult.isInvalid
                        ? (engineResult.invalidReason === 'scores' ? 'Invalid Score Input' : 'Invalid Weight Configuration')
                        : 'Incomplete Evaluation Input'}
                    </div>
                  ) : isAuthoritative ? (
                    engineResult.isTie ? (
                      <div className="text-sm font-bold text-amber-300">
                        🤝 Exact Mathematical Tie
                      </div>
                    ) : (
                      <div className="text-sm font-bold text-white">
                        {engineResult.winner?.option.name ?? '—'}{' '}
                        <span className="text-signal font-mono">
                          ({engineResult.winner?.weightedScore ?? 0} pts)
                        </span>
                      </div>
                    )
                  ) : isEvaluationStale ? (
                    <div className="text-xs font-mono text-amber-400">
                      Recalculation Required
                    </div>
                  ) : (
                    <div className="text-sm font-bold text-slate-300">
                      {engineResult.winner?.option.name ?? '—'}{' '}
                      <span className="text-slate-500 font-mono">
                        (Preview)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* TAB CONTENT */}

            {/* Tab 1: Scoring Matrix */}
            {activeTab === 'matrix' && (
              <div className="space-y-4">
                <ScoreMatrix
                  criteria={criteria}
                  options={options}
                  weights={weights}
                  lockedIds={lockedIds}
                  currentUserRole={currentUserRole}
                  scoreProvenance={scoreProvenance}
                  onUpdateScore={updateOptionScore}
                  onClearSyntheticScores={clearSyntheticScores}
                  onPopulateSyntheticDemo={populateSyntheticDemo}
                  missingScores={missingScoresList}
                  disabled={isOperationInFlight}
                />
              </div>
            )}

            {/* Tab 2: Weights & Criteria */}
            {activeTab === 'weights' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Weight Sliders */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
                    <div className="flex items-center gap-2 text-xs font-mono text-slate-300 font-bold uppercase">
                      <Sliders className="w-3.5 h-3.5 text-signal" />
                      <span>Calibrate Weights (Largest Remainder Normalization)</span>
                    </div>
                    {currentUserRole !== 'viewer' && currentUserRole !== 'contributor' && (
                      <button
                        onClick={resetToDefaults}
                        disabled={isOperationInFlight}
                        className={`text-[11px] font-mono flex items-center gap-1 ${
                          isOperationInFlight
                            ? 'text-slate-600 cursor-not-allowed'
                            : 'text-slate-400 hover:text-slate-200 cursor-pointer'
                        }`}
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Reset</span>
                      </button>
                    )}
                  </div>

                  <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                    {criteria.map((c) => (
                      <WeightSlider
                        key={c.id}
                        criterion={c}
                        weight={weights[c.id] ?? 0}
                        isLocked={lockedIds.includes(c.id)}
                        disabled={currentUserRole === 'viewer' || currentUserRole === 'contributor' || isOperationInFlight}
                        onWeightChange={(val) => setCriterionWeight(c.id, val)}
                        onToggleLock={() => toggleLock(c.id)}
                      />
                    ))}
                  </div>
                </div>

                {/* Criteria Manager */}
                <div className="space-y-3">
                  <CriteriaManager
                    criteria={criteria}
                    weights={weights}
                    lockedIds={lockedIds}
                    currentUserRole={currentUserRole}
                    onAddCriterion={addCriterion}
                    onRenameCriterion={renameCriterion}
                    onUpdateCriterion={updateCriterion}
                    onRemoveCriterion={removeCriterion}
                    onToggleLock={toggleLock}
                    disabled={isOperationInFlight}
                  />
                </div>
              </div>
            )}

            {/* Tab 3: Alternatives Manager */}
            {activeTab === 'alternatives' && (
              <div className="max-w-3xl mx-auto">
                <AlternativesManager
                  options={options}
                  currentUserRole={currentUserRole}
                  onAddAlternative={addAlternative}
                  onRenameAlternative={renameAlternative}
                  onUpdateAlternative={updateAlternative}
                  onRemoveAlternative={removeAlternative}
                  disabled={isOperationInFlight}
                />
              </div>
            )}

            {/* Tab 4: Authoritative Results & Sensitivity Analysis */}
            {activeTab === 'analysis' && (
              <div className="space-y-6">
                {/* Mathematical Tie Alert Banner */}
                {engineResult.isTie && (
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-xs text-amber-200">
                    <Scale className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold uppercase tracking-wider block text-amber-300">
                        Canonical Mathematical Tie Detected (Epsilon: 1e-9)
                      </span>
                      <p className="mt-1 leading-relaxed">
                        Multiple alternatives share an identical weighted score within machine epsilon. Under the Canonical Engine v1.0 specification, tied winners share Rank 1 with presentation order determined by input order.
                      </p>
                      {engineResult.tiedWinnerIds && (
                        <div className="mt-2 font-mono text-[11px] text-amber-300">
                          Tied Alternative IDs: {engineResult.tiedWinnerIds.join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Incomplete State Banner */}
                {engineResult.isIncomplete && (
                  <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                      <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                        <AlertTriangle className="w-5 h-5 text-amber-400 animate-pulse" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-300">
                            Decision Incomplete — Awaiting Complete Scores
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-200 border border-amber-500/30">
                            {missingScoresList.length} Missing
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                          Under canonical MCDA rules, rank determinations and winner calculations are strictly suppressed until every alternative has a complete score for every criterion.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setActiveTab('matrix')}
                      className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-background font-mono font-bold text-xs shrink-0 flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
                    >
                      <Table className="w-3.5 h-3.5" />
                      <span>Open Score Matrix (Step 3) →</span>
                    </button>
                  </div>
                )}

                {/* Invalid State Banner */}
                {engineResult.isInvalid && (
                  <div className="p-5 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                      <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-300 border border-rose-500/30 shrink-0">
                        <AlertCircle className="w-5 h-5 text-rose-400" />
                      </div>
                      <div>
                        <span className="text-xs font-mono font-bold uppercase tracking-wider text-rose-300">
                          Invalid Decision Configuration
                        </span>
                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                          {engineResult.errorMessage || 'Please review criterion weights and score inputs.'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setActiveTab(engineResult.invalidReason === 'weights' ? 'weights' : 'matrix')}
                      className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-mono font-bold text-xs shrink-0 flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
                    >
                      <span>Fix {engineResult.invalidReason === 'weights' ? 'Weights (Step 2)' : 'Scores (Step 3)'} →</span>
                    </button>
                  </div>
                )}

                {/* Evaluated Winner & Runner-Up Presentation Hero Card */}
                {!engineResult.isIncomplete && !engineResult.isInvalid && winner && (
                  <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-surface-card via-surface to-surface-card border border-signal/50 shadow-glow-signal-sm space-y-5">
                    {/* Winner Header Bar */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-subtle">
                      <div className="flex items-center gap-3">
                        <span className="p-2.5 rounded-xl bg-signal/15 text-signal border border-signal/30 shrink-0">
                          <Award className="w-6 h-6 text-signal" />
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold uppercase tracking-wider text-signal">
                              Rank #1 Selected Recommendation
                            </span>
                            {isAuthoritative ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-signal/20 text-signal border border-signal/40 font-bold flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Authoritative MCDA</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-surface-subtle text-slate-400 border border-border">
                                Preview
                              </span>
                            )}
                          </div>
                          <h3 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight mt-0.5 flex items-center gap-2">
                            <span
                              className="w-3.5 h-3.5 rounded-full inline-block shrink-0 shadow-sm"
                              style={{ backgroundColor: winner.option.color }}
                            />
                            <span>{winner.option.name}</span>
                          </h3>
                          {winner.option.tagline && (
                            <span className="text-xs text-slate-400 font-mono block mt-0.5">
                              {winner.option.tagline}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-baseline gap-3 bg-surface p-3.5 rounded-xl border border-border shrink-0 self-start sm:self-auto">
                        <div className="text-right">
                          <div className="text-[10px] font-mono uppercase text-slate-400">Weighted Score</div>
                          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-white">
                            {winner.weightedScore.toFixed(1)}
                            <span className="text-xs font-normal text-slate-400 ml-1">/ 100</span>
                          </div>
                        </div>
                        {runnerUp && explainability.pointLead > 0 && (
                          <div className="pl-3 border-l border-border-subtle">
                            <div className="text-[10px] font-mono uppercase text-signal">Margin Lead</div>
                            <div className="text-sm font-bold font-mono text-signal">
                              +{explainability.pointLead.toFixed(1)} pts
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Executive Headline & Plain-English Rationale */}
                    <div className="space-y-2">
                      <div className="text-base sm:text-lg font-bold text-white leading-snug">
                        {explainability.headline}
                      </div>
                      <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                        {explainability.dynamicRationale}
                      </p>
                    </div>

                    {/* Primary Drivers vs Conceded Areas (Honest Trade-off Explainability) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                      {/* Primary Drivers */}
                      <div className="p-3.5 rounded-xl bg-surface/70 border border-border-subtle space-y-2.5">
                        <div className="flex items-center gap-2 text-xs font-mono font-bold text-signal uppercase tracking-wider">
                          <Check className="w-3.5 h-3.5" />
                          <span>Primary Drivers (Winning Advantages)</span>
                        </div>
                        {explainability.primaryDrivers && explainability.primaryDrivers.length > 0 ? (
                          <div className="space-y-1.5">
                            {explainability.primaryDrivers.map((driver) => (
                              <div
                                key={driver.criterionId}
                                className="flex items-center justify-between text-xs p-2 rounded-lg bg-surface border border-border-subtle"
                              >
                                <span className="text-white font-medium truncate pr-2">{driver.criterionName}</span>
                                <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
                                  <span className="text-slate-400">{driver.winnerScore} vs {driver.runnerUpScore}</span>
                                  <span className="font-bold text-signal bg-signal/10 px-1.5 py-0.5 rounded border border-signal/20">
                                    +{driver.pointAdvantage.toFixed(1)} pts
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-400 italic">
                            Lead distributed evenly across criteria.
                          </div>
                        )}
                      </div>

                      {/* Conceded Areas */}
                      <div className="p-3.5 rounded-xl bg-surface/70 border border-border-subtle space-y-2.5">
                        <div className="flex items-center gap-2 text-xs font-mono font-bold text-amber-300 uppercase tracking-wider">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>Conceded Areas (Honest Trade-offs)</span>
                        </div>
                        {explainability.concededAreas && explainability.concededAreas.length > 0 ? (
                          <div className="space-y-1.5">
                            {explainability.concededAreas.map((conceded) => (
                              <div
                                key={conceded.criterionId}
                                className="flex items-center justify-between text-xs p-2 rounded-lg bg-surface border border-border-subtle"
                              >
                                <span className="text-white font-medium truncate pr-2">{conceded.criterionName}</span>
                                <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
                                  <span className="text-slate-400">{conceded.winnerScore} vs {conceded.runnerUpScore}</span>
                                  <span className="font-bold text-accent-amber bg-accent-amber/10 px-1.5 py-0.5 rounded border border-accent-amber/20">
                                    {conceded.pointAdvantage.toFixed(1)} pts
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-400 italic">
                            Winner outperformed challenger across all evaluated criteria.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Interactive Sensitivity Tipping Point */}
                    {accessibleTipping && accessibleTipping.tippingPointWeight !== null && runnerUp && (
                      <div className="p-4 rounded-xl bg-accent-amber/10 border border-accent-amber/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="flex items-start gap-2.5">
                          <Zap className="w-4 h-4 text-accent-amber shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold uppercase tracking-wider text-accent-amber block font-mono">
                              Sensitivity Tipping Point Calculus
                            </span>
                            <p className="text-slate-200 mt-0.5">
                              If <strong className="text-white">{accessibleTipping.criterionName}</strong> weight shifts from{' '}
                              <span className="font-mono text-signal font-bold">{accessibleTipping.currentWeight}%</span> to{' '}
                              <span className="font-mono text-accent-amber font-bold">{accessibleTipping.tippingPointWeight}%</span>,{' '}
                              <strong className="text-white">{runnerUp.option.name}</strong> overturns the decision.
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => setCriterionWeight(accessibleTipping.criterionId, accessibleTipping.tippingPointWeight!)}
                          className="shrink-0 px-3.5 py-2 rounded-lg bg-accent-amber/20 hover:bg-accent-amber/30 border border-accent-amber/40 text-amber-200 font-mono font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm hover:scale-[1.02]"
                          title="Simulate weight adjustment to trigger outcome transition in real time"
                        >
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                          <span>Simulate Flip</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Option Evaluations Table */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
                    <span className="text-xs font-mono text-slate-300 font-bold uppercase">
                      {isAuthoritative ? 'Authoritative Server Rankings' : 'Calculated Option Scores (Preview)'}
                    </span>
                    {isAuthoritative && (
                      <span className="text-[10px] font-mono text-signal flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>Canonical Engine v1.0.0</span>
                      </span>
                    )}
                  </div>

                  <div className="space-y-3">
                    {engineResult.evaluations.map((item) => {
                      const isOptionWinner = item.rank === 1 && !engineResult.isIncomplete && !engineResult.isInvalid;

                      return (
                        <div
                          key={item.option.id}
                          className={`p-4 rounded-xl border transition-all ${
                            isOptionWinner
                              ? 'bg-surface-card border-signal/50 shadow-glow-signal-sm ring-1 ring-signal/20'
                              : 'bg-surface/50 border-border-subtle'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2.5">
                              <span
                                className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                                style={{ backgroundColor: item.option.color }}
                              />
                              <div>
                                <span className="text-sm font-bold text-white">
                                  {item.option.name}
                                </span>
                                {item.option.tagline && (
                                  <span className="text-[11px] text-slate-400 font-mono block">
                                    {item.option.tagline}
                                  </span>
                                )}
                              </div>
                              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-semibold ml-1 ${
                                isOptionWinner
                                  ? 'bg-signal/20 text-signal border-signal/40'
                                  : item.rank !== null
                                    ? 'bg-surface border-border text-slate-300'
                                    : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                              }`}>
                                {item.rank !== null && item.rank !== undefined ? `Rank #${item.rank}` : 'Unranked · Pending Scores'}
                              </span>
                            </div>

                            <div className="flex items-baseline gap-2 font-mono text-xs">
                              {item.rank !== null && item.rank !== undefined ? (
                                <>
                                  <span className="font-bold text-white text-base">
                                    {item.weightedScore.toFixed(1)}
                                  </span>
                                  <span className="text-slate-500">/ 100</span>
                                  {!isOptionWinner && item.scoreDifferenceToLeader > 0 && (
                                    <span className="text-[11px] font-semibold text-accent-amber ml-1">
                                      (-{item.scoreDifferenceToLeader.toFixed(1)} pts)
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-amber-400 font-semibold text-xs">
                                  Score Pending
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="w-full h-1.5 bg-background rounded-full overflow-hidden mb-3">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${item.rank !== null ? Math.min(100, item.weightedScore) : 0}%`,
                                backgroundColor: isOptionWinner ? '#B8FF5A' : item.option.color,
                              }}
                            />
                          </div>

                          {/* Criterion breakdown mini-row */}
                          {item.contributions && item.contributions.length > 0 && item.rank !== null && (
                            <div className="pt-2 border-t border-border-subtle/50 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-400">
                              {item.contributions.map((c) => (
                                <span key={c.criterionId} className="flex items-center gap-1">
                                  <span className="text-slate-400">{c.shortName || c.criterionName}:</span>
                                  <span className="text-white font-semibold">{c.rawScore}</span>
                                  <span className="text-slate-600 font-normal">({c.weightedPoints.toFixed(1)} pts)</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Cryptographic Engine Metadata (CANONICAL_DECISION_ENGINE_V1_SPEC Section 8.2) */}
                {isAuthoritative && serverDecision?.analysis && (
                  <div className="p-3.5 rounded-xl bg-surface border border-border-subtle font-mono text-[11px] text-slate-400 space-y-1.5">
                    <div className="flex items-center gap-1.5 font-bold text-slate-300 uppercase text-[10px]">
                      <Hash className="w-3.5 h-3.5 text-signal" />
                      <span>Canonical Engine Verification Audit Metadata</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <span className="text-slate-500">Engine Version: </span>
                        <span className="text-white">v{serverDecision.analysis.engineVersion}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Evaluated At: </span>
                        <span className="text-white">{serverDecision.analysis.evaluatedAt}</span>
                      </div>
                      {serverDecision.analysis.calculationHash && (
                        <div className="sm:col-span-2 truncate">
                          <span className="text-slate-500">Calculation Hash: </span>
                          <span className="text-signal select-all">
                            {serverDecision.analysis.calculationHash}
                          </span>
                        </div>
                      )}
                      {serverDecision.analysis.inputHash && (
                        <div className="sm:col-span-2 truncate">
                          <span className="text-slate-500">Input Hash: </span>
                          <span className="text-slate-300 select-all">
                            {serverDecision.analysis.inputHash}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Modal Footer Bar */}
          <div className="p-3.5 sm:p-4 bg-surface border-t border-border flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="text-xs text-slate-400 font-mono flex items-center gap-2">
              <span>Deterministic MCDA</span>
              <span className="text-slate-600">·</span>
              {decisionId ? (
                <span className="text-signal truncate max-w-[200px]" title={decisionId}>
                  ID: {decisionId}
                </span>
              ) : (
                <span>Unsaved Workspace</span>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              {/* Save to Server Button */}
              {currentUserRole === 'viewer' ? (
                <button
                  disabled
                  className="px-3.5 py-2 rounded-xl bg-surface border border-border text-slate-500 font-bold text-xs flex items-center gap-1.5 cursor-not-allowed"
                >
                  <Eye className="w-4 h-4 text-sky-400" />
                  <span>Read-Only</span>
                </button>
              ) : (
                <button
                  onClick={handleSaveToServer}
                  disabled={saveStatus === 'in_flight'}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    saveStatus === 'in_flight'
                      ? 'bg-surface border border-border text-slate-400 cursor-not-allowed'
                      : isAuthoritative
                        ? 'bg-surface hover:bg-surface-subtle border border-signal/50 text-signal hover:shadow-glow-signal-sm'
                        : 'bg-signal hover:bg-signal-light text-background shadow-glow-signal-sm'
                  }`}
                  title="Persist decision inputs to MongoDB"
                >
                  {saveStatus === 'in_flight' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-signal" />
                      <span>Saving...</span>
                    </>
                  ) : isAuthoritative ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-signal" />
                      <span>Saved & Verified</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>{decisionId ? 'Save Inputs' : 'Save to Server'}</span>
                    </>
                  )}
                </button>
              )}

              {/* Share Decision Button (Owner only) */}
              {decisionId && currentUserRole === 'owner' && (
                <button
                  onClick={() => setIsShareModalOpen(true)}
                  className="px-3 py-2 rounded-xl bg-surface hover:bg-surface-subtle border border-signal/40 text-signal hover:shadow-glow-signal-sm font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Share decision and manage collaborators"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Share</span>
                </button>
              )}

              {/* Phase 7: Expert Contributions Button */}
              {decisionId && (
                <button
                  onClick={() => setIsContributionsModalOpen(true)}
                  className="px-3 py-2 rounded-xl bg-surface hover:bg-surface-subtle border border-border text-slate-200 hover:text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  title="View and submit expert contributions"
                >
                  <Sparkles className="w-3.5 h-3.5 text-signal" />
                  <span>Contributions</span>
                  {serverDecision?.isContributionRoundLocked && (
                    <Lock className="w-3 h-3 text-accent-rose" />
                  )}
                </button>
              )}

              {/* Phase 8: Evidence & Provenance Button */}
              {decisionId && (
                <button
                  onClick={() => setIsEvidenceModalOpen(true)}
                  className="px-3 py-2 rounded-xl bg-surface hover:bg-surface-subtle border border-border text-slate-200 hover:text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  title="View and attach supporting evidence"
                >
                  <BookOpen className="w-3.5 h-3.5 text-blue-400" />
                  <span>Evidence</span>
                </button>
              )}

              {/* Phase 9: AI Analyst Button */}
              {decisionId && (
                <button
                  onClick={() => setIsAiAnalystModalOpen(true)}
                  className="px-3 py-2 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:text-purple-200 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Open AI Decision Analyst"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  <span>AI Analyst</span>
                </button>
              )}

              {/* Phase 10: Advanced Analytics Button */}
              {decisionId && (
                <button
                  onClick={() => setIsAnalyticsModalOpen(true)}
                  className="px-3 py-2 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:text-cyan-200 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Open Advanced Decision Analytics"
                >
                  <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Analytics</span>
                </button>
              )}

              {/* Phase 11: Disagreement Intelligence Button */}
              {decisionId && (
                <button
                  onClick={() => setIsDisagreementsModalOpen(true)}
                  className="px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:text-amber-200 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Open Disagreement Intelligence"
                >
                  <Scale className="w-3.5 h-3.5 text-amber-400" />
                  <span>Disagreements</span>
                </button>
              )}

              {/* Phase 12: Expert Calibration Button */}
              {decisionId && (
                <button
                  onClick={() => setIsCalibrationModalOpen(true)}
                  className="px-3 py-2 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:text-purple-200 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Open Expert Calibration Intelligence"
                >
                  <Target className="w-3.5 h-3.5 text-purple-400" />
                  <span>Calibration</span>
                </button>
              )}

              {/* Phase 13: Audit History & Export Button */}
              {decisionId && (
                <button
                  onClick={() => setIsAuditExportModalOpen(true)}
                  className="px-3 py-2 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:text-cyan-200 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Open Decision History & Export Center"
                >
                  <History className="w-3.5 h-3.5 text-cyan-400" />
                  <span>History</span>
                </button>
              )}

              {/* Copy Briefing Button */}
              <button
                onClick={handleExportBriefing}
                className="px-3 py-2 rounded-xl bg-surface hover:bg-surface-subtle border border-border text-slate-200 hover:text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-signal" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Briefing</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>

        <React.Suspense fallback={null}>
          {isShareModalOpen && (
            <ShareModal
              isOpen={isShareModalOpen}
              onClose={() => setIsShareModalOpen(false)}
              decisionId={decisionId}
              decisionTitle={dataset.title}
            />
          )}

          {isContributionsModalOpen && (
            <ContributionsModal
              isOpen={isContributionsModalOpen}
              onClose={() => setIsContributionsModalOpen(false)}
              decision={serverDecision}
              onDecisionUpdated={(updated) => {
                if (model?.loadDecision) {
                  model.loadDecision(updated._id);
                }
              }}
            />
          )}

          {isEvidenceModalOpen && (
            <EvidenceModal
              isOpen={isEvidenceModalOpen}
              onClose={() => setIsEvidenceModalOpen(false)}
              decision={serverDecision}
            />
          )}

          {isAiAnalystModalOpen && (
            <AiAnalystModal
              isOpen={isAiAnalystModalOpen}
              onClose={() => setIsAiAnalystModalOpen(false)}
              decision={serverDecision}
              onDecisionUpdated={(updated) => {
                if (model?.loadDecision) {
                  model.loadDecision(updated._id);
                }
              }}
            />
          )}

          {isAnalyticsModalOpen && (
            <AnalyticsModal
              isOpen={isAnalyticsModalOpen}
              onClose={() => setIsAnalyticsModalOpen(false)}
              decision={serverDecision}
            />
          )}

          {isDisagreementsModalOpen && (
            <DisagreementsModal
              isOpen={isDisagreementsModalOpen}
              onClose={() => setIsDisagreementsModalOpen(false)}
              decision={serverDecision}
            />
          )}

          {isCalibrationModalOpen && (
            <ExpertCalibrationModal
              isOpen={isCalibrationModalOpen}
              onClose={() => setIsCalibrationModalOpen(false)}
              decision={serverDecision}
            />
          )}

          {isAuditExportModalOpen && (
            <AuditExportModal
              isOpen={isAuditExportModalOpen}
              onClose={() => setIsAuditExportModalOpen(false)}
              decision={serverDecision}
            />
          )}
        </React.Suspense>
      </div>
    </AnimatePresence>
  );
};
