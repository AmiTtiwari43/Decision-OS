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
  ChevronUp,
  Share2,
  Eye,
  Users,
  Lock,
  BookOpen,
  BarChart3,
  Scale,
  Target,
  History,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { templateDatasets } from '../data/decisionData.js';
import { useDecisionModel } from '../hooks/useDecisionModel.js';
import { WeightSlider } from './WeightSlider.js';
import { ShareModal } from './ShareModal.js';
import { ContributionsModal } from './ContributionsModal.js';
import { EvidenceModal } from './EvidenceModal.js';
import { AiAnalystModal } from './AiAnalystModal.js';
import { AnalyticsModal } from './AnalyticsModal.js';
import { DisagreementsModal } from './DisagreementsModal.js';
import { ExpertCalibrationModal } from './ExpertCalibrationModal.js';
import { AuditExportModal } from './AuditExportModal.js';
import { RealtimePresenceBar } from './RealtimePresenceBar.js';
import { useRealtimeCollaboration } from '../hooks/useRealtimeCollaboration.js';
import type { DecisionDto } from '../api/types.js';
import { sound } from '../utils/audioFx.js';
import { useAuth } from '../hooks/useAuth.js';

interface InteractiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  model?: ReturnType<typeof useDecisionModel>;
}

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
    saveStatus,
    apiError,
    saveDecision,
    loadDecision,
    listSavedDecisions,
    createNewDecision,
    updateOptionScore,
    updateDecisionMetadata,
    clearApiError,
  } = model;

  const { isAuthenticated, openAuthModal } = useAuth();

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
  const [isScoringOpen, setIsScoringOpen] = useState(false);
  const [isSavedListOpen, setIsSavedListOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(dataset.title);
  const [editContext, setEditContext] = useState(dataset.context);
  const [savedDecisions, setSavedDecisions] = useState<DecisionDto[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);

  const {
    connectionStatus,
    activeParticipants,
    conflictState,
    dismissConflict,
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
    setEditTitle(dataset.title);
    setEditContext(dataset.context);
    setIsEditingTitle(true);
  };

  const handleTemplateChange = (idx: number) => {
    setSelectedTemplateIndex(idx);
    setIsSavedListOpen(false);
    switchDataset(templateDatasets[idx]);
  };

  const handleOpenSavedList = async () => {
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
    setSelectedTemplateIndex(null);
    setIsSavedListOpen(false);
    await loadDecision(id);
  };

  const handleCreateNew = () => {
    setSelectedTemplateIndex(null);
    setIsSavedListOpen(false);
    createNewDecision();
  };

  const handleSaveTitle = () => {
    if (editTitle.trim()) {
      updateDecisionMetadata(editTitle.trim(), editContext.trim());
      setIsEditingTitle(false);
    }
  };

  const handleSaveToServer = async () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    sound.playTick();
    const result = await saveDecision();
    if (result) {
      sound.playCelebrate();
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
      });
    }
  };

  const handleExportBriefing = () => {
    const { winner, evaluations, explainability } = engineResult;

    const report = `# Decision OS — Decision Briefing
Generated: ${new Date().toLocaleDateString()}
Decision Prompt: "${dataset.question}"
${decisionId ? `Server Decision ID: ${decisionId}` : 'Status: Unsaved Draft / Preview'}
Verification: ${isAuthoritative ? `Authoritative Server MCDA (Canonical Engine v${serverDecision?.analysis?.engineVersion || '1.0.0'})` : 'Client Preview'}

## Leading Recommendation
🏆 **${winner.option.name}** (Weighted Score: ${winner.weightedScore}/100)
${explainability.headline}

## Explainability Summary
${explainability.dynamicRationale}

${explainability.sensitivityStatement}

## Full Option Rankings
${evaluations
  .map(
    (e, idx) =>
      `${idx + 1}. **${e.option.name}** — ${e.weightedScore} pts (${e.option.badge || ''})`
  )
  .join('\n')}

## Criteria Weight Allocation
${criteria
  .map(
    (c) =>
      `- **${c.name}**: ${weights[c.id]}% (Raw winner score: ${winner.option.scores[c.id] || 0}/100)`
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
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-background/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.25 }}
          className="relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl bg-surface-card border border-border shadow-2xl overflow-hidden"
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-border bg-surface shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-signal">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base sm:text-lg font-bold text-white">
                    Decision OS Workspace
                  </h3>

                  {/* Dynamic Status Pill */}
                  {isAuthoritative ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-signal/15 text-signal border border-signal/30 flex items-center gap-1 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse" />
                      <span>Server-Verified (v1.0.0)</span>
                      {decisionId && (
                        <span className="opacity-70 text-[9px]">#{decisionId.slice(-6)}</span>
                      )}
                    </span>
                  ) : isDirty || mode === 'draft' ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-accent-amber/15 text-accent-amber border border-accent-amber/30 flex items-center gap-1 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-amber" />
                      <span>Unsaved Preview (Draft)</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-surface-subtle text-slate-400 border border-border flex items-center gap-1">
                      <span>Template Demonstration</span>
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
                  Calibrate weights and scores to generate an authoritative, explainable decision.
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
              conflictState={conflictState}
              onDismissConflict={dismissConflict}
              onReviewConflict={() => {
                if (decisionId) {
                  loadDecision(decisionId);
                  dismissConflict();
                }
              }}
              onReconnect={reconnect}
            />
          )}

          {/* Selector & Action Ribbon */}
          <div className="p-3 sm:p-4 bg-surface-subtle/50 border-b border-border-subtle flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="text-xs font-mono text-slate-400 mr-1 hidden sm:inline">Templates:</span>
              {templateDatasets.map((t, idx) => (
                <button
                  key={t.id}
                  onClick={() => handleTemplateChange(idx)}
                  className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold transition-all border cursor-pointer ${
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
                className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold transition-all border flex items-center gap-1 cursor-pointer ${
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
                <span>Saved Records</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${isSavedListOpen ? 'rotate-180' : ''}`} />
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
                          No saved decisions found in database. Click "Save to Server" to persist your first decision!
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
                      {apiError.missingPairs.map((p) => `[Option: ${p.optionId}, Criterion: ${p.criterionId}]`).join(', ')}
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
                  onClick={handleSaveToServer}
                  className="px-2.5 py-1 rounded bg-accent-rose/20 hover:bg-accent-rose/30 text-white font-mono text-[11px] font-bold border border-accent-rose/40 cursor-pointer"
                >
                  Retry
                </button>
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

          {/* Viewer Mode Banner */}
          {decisionId && currentUserRole === 'viewer' && (
            <div className="p-3 bg-sky-950/40 border-b border-sky-500/30 flex items-center gap-2.5 text-xs text-sky-200">
              <Eye className="w-4 h-4 text-sky-400 shrink-0" />
              <span>
                <strong>Viewer Access (Read-Only):</strong> You have viewer access to this decision and its verified analytical calculations. Input calibrations, score modifications, and saving are restricted.
              </span>
            </div>
          )}

          {/* Modal Scrollable Body */}
          <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
            {/* Question Banner & Server Status */}
            <div className="p-4 rounded-xl bg-surface/80 border border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono uppercase text-signal tracking-wider">
                    Target Question & Scope
                  </span>
                  {!isEditingTitle && currentUserRole !== 'viewer' && (
                    <button
                      onClick={handleStartEditTitle}
                      className="text-[11px] font-mono text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
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

              {/* Authoritative Winner Highlight */}
              <div className="flex items-center gap-3 bg-surface-card p-3 rounded-xl border border-border shrink-0">
                <Award className="w-5 h-5 text-signal shrink-0" />
                <div>
                  <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center gap-1.5">
                    <span>Leading Choice</span>
                    {isAuthoritative && (
                      <span className="text-signal flex items-center gap-0.5 font-bold">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Verified</span>
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-bold text-white">
                    {engineResult.winner.option.name} (
                    <span className="text-signal font-mono">
                      {engineResult.winner.weightedScore} pts
                    </span>
                    )
                  </div>
                </div>
              </div>
            </div>

            {/* Collapsible Option Scoring Matrix Toggle */}
            <div className="border border-border-subtle rounded-xl bg-surface/50 overflow-hidden">
              <button
                onClick={() => setIsScoringOpen((prev) => !prev)}
                className="w-full p-3 flex items-center justify-between text-xs font-mono font-bold text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Table className="w-3.5 h-3.5 text-signal" />
                  <span>Option Scoring Matrix (Raw Scores 0-100)</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-400 font-normal">
                  <span>{isScoringOpen ? 'Hide Matrix' : 'Inspect & Edit Scores'}</span>
                  {isScoringOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </div>
              </button>

              <AnimatePresence>
                {isScoringOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="p-4 border-t border-border-subtle overflow-x-auto"
                  >
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border-subtle text-slate-400 font-mono text-[11px]">
                          <th className="pb-2 font-semibold">Option / Criteria</th>
                          {criteria.map((c) => (
                            <th key={c.id} className="pb-2 px-2 font-semibold">
                              {c.shortName || c.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle/50">
                        {options.map((opt) => (
                          <tr key={opt.id} className="hover:bg-surface-subtle/30">
                            <td className="py-2 font-semibold text-white flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color }} />
                              <span>{opt.name}</span>
                            </td>
                            {criteria.map((c) => {
                              const scoreVal = opt.scores[c.id] ?? 0;
                              return (
                                <td key={c.id} className="py-2 px-2">
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={scoreVal}
                                    disabled={currentUserRole === 'viewer'}
                                    onChange={(e) => updateOptionScore(opt.id, c.id, Number(e.target.value))}
                                    className={`w-16 px-2 py-1 rounded bg-surface border border-border text-center font-mono font-bold text-white focus:outline-none focus:border-signal text-xs ${
                                      currentUserRole === 'viewer' ? 'opacity-50 cursor-not-allowed' : ''
                                    }`}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 2-Column: Weights vs Rankings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Weight Sliders */}
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-300 font-bold uppercase">
                    <Sliders className="w-3.5 h-3.5 text-signal" />
                    <span>Calibrate Weights</span>
                  </div>
                  {currentUserRole !== 'viewer' && (
                    <button
                      onClick={resetToDefaults}
                      className="text-[11px] font-mono text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset</span>
                    </button>
                  )}
                </div>

                <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                  {criteria.map((c) => (
                    <WeightSlider
                      key={c.id}
                      criterion={c}
                      weight={weights[c.id] ?? 0}
                      isLocked={lockedIds.includes(c.id)}
                      disabled={currentUserRole === 'viewer'}
                      onWeightChange={(val) => setCriterionWeight(c.id, val)}
                      onToggleLock={() => toggleLock(c.id)}
                    />
                  ))}
                </div>
              </div>

              {/* Right Column: Live Option Results & Explainability */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
                  <span className="text-xs font-mono text-slate-300 font-bold uppercase">
                    {isAuthoritative ? 'Authoritative Server Rankings' : 'Calculated Option Scores'}
                  </span>
                  {isAuthoritative && (
                    <span className="text-[10px] font-mono text-signal flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>Canonical Engine v1.0.0</span>
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  {engineResult.evaluations.map((item) => (
                    <div
                      key={item.option.id}
                      className={`p-3.5 rounded-xl border transition-all ${
                        item.rank === 1
                          ? 'bg-surface-card border-signal/50 shadow-glow-signal-sm'
                          : 'bg-surface/50 border-border-subtle'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: item.option.color }}
                          />
                          <span className="text-sm font-bold text-white">
                            {item.option.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-xs">
                          <span className="font-bold text-white text-base">
                            {item.weightedScore}
                          </span>
                          <span className="text-slate-500">/100</span>
                        </div>
                      </div>

                      <div className="w-full h-1.5 bg-background rounded-full overflow-hidden mb-2">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${item.weightedScore}%`,
                            backgroundColor: item.rank === 1 ? '#B8FF5A' : item.option.color,
                          }}
                        />
                      </div>

                      <div className="text-[11px] text-slate-400 line-clamp-1">
                        {item.option.tagline || item.option.description}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-3.5 rounded-xl bg-surface/70 border border-border text-xs text-slate-300">
                  <span className="font-bold text-signal block mb-1">
                    Explainability Driver:
                  </span>
                  <p className="leading-relaxed">
                    {engineResult.explainability.dynamicRationale}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Modal Footer Bar */}
          <div className="p-4 bg-surface border-t border-border flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="text-xs text-slate-400 font-mono flex items-center gap-2">
              <span>Deterministic MCDA</span>
              <span className="text-slate-600">·</span>
              {decisionId ? (
                <span className="text-signal truncate max-w-[200px]" title={decisionId}>
                  ID: {decisionId}
                </span>
              ) : (
                <span>Unsaved Sandbox</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Save to Server / Persist Button */}
              {currentUserRole === 'viewer' ? (
                <button
                  disabled
                  className="px-4 py-2.5 rounded-xl bg-surface border border-border text-slate-500 font-bold text-xs sm:text-sm flex items-center gap-2 cursor-not-allowed"
                  title="Viewers are not permitted to save changes"
                >
                  <Eye className="w-4 h-4 text-sky-400" />
                  <span>Read-Only</span>
                </button>
              ) : (
                <button
                  onClick={handleSaveToServer}
                  disabled={saveStatus === 'in_flight'}
                  className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                    saveStatus === 'in_flight'
                      ? 'bg-surface border border-border text-slate-400 cursor-not-allowed'
                      : isAuthoritative
                        ? 'bg-surface hover:bg-surface-subtle border border-signal/50 text-signal hover:shadow-glow-signal-sm'
                        : 'bg-signal hover:bg-signal-light text-background shadow-glow-signal-sm'
                  }`}
                  title="Persist to MongoDB and compute authoritative MCDA results"
                >
                  {saveStatus === 'in_flight' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-signal" />
                      <span>Saving...</span>
                    </>
                  ) : isAuthoritative ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-signal" />
                      <span>Saved & Verified</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>{decisionId ? 'Save Changes' : 'Save to Server'}</span>
                    </>
                  )}
                </button>
              )}

              {/* Share Decision Button (Owner only) */}
              {decisionId && currentUserRole === 'owner' && (
                <button
                  onClick={() => setIsShareModalOpen(true)}
                  className="px-4 py-2.5 rounded-xl bg-surface hover:bg-surface-subtle border border-signal/40 text-signal hover:shadow-glow-signal-sm font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer"
                  title="Share decision and manage collaborators"
                >
                  <Share2 className="w-4 h-4" />
                  <span>Share</span>
                </button>
              )}

              {/* Phase 7: Expert Contributions Button */}
              {decisionId && (
                <button
                  onClick={() => setIsContributionsModalOpen(true)}
                  className="px-4 py-2.5 rounded-xl bg-surface hover:bg-surface-subtle border border-border text-slate-200 hover:text-white font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer"
                  title="View and submit expert contributions"
                >
                  <Sparkles className="w-4 h-4 text-signal" />
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
                  className="px-4 py-2.5 rounded-xl bg-surface hover:bg-surface-subtle border border-border text-slate-200 hover:text-white font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer"
                  title="View and attach supporting evidence"
                >
                  <BookOpen className="w-4 h-4 text-blue-400" />
                  <span>Evidence</span>
                </button>
              )}

              {/* Phase 9: AI Analyst Button */}
              {decisionId && (
                <button
                  onClick={() => setIsAiAnalystModalOpen(true)}
                  className="px-4 py-2.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:text-purple-200 font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer shadow-sm"
                  title="Open AI Decision Analyst"
                >
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <span>AI Analyst</span>
                </button>
              )}

              {/* Phase 10: Advanced Analytics Button */}
              {decisionId && (
                <button
                  onClick={() => setIsAnalyticsModalOpen(true)}
                  className="px-4 py-2.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:text-cyan-200 font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer shadow-sm"
                  title="Open Advanced Decision Analytics"
                >
                  <BarChart3 className="w-4 h-4 text-cyan-400" />
                  <span>Analytics</span>
                </button>
              )}

              {/* Phase 11: Disagreement Intelligence Button */}
              {decisionId && (
                <button
                  onClick={() => setIsDisagreementsModalOpen(true)}
                  className="px-4 py-2.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:text-amber-200 font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer shadow-sm"
                  title="Open Disagreement Intelligence"
                >
                  <Scale className="w-4 h-4 text-amber-400" />
                  <span>Disagreements</span>
                </button>
              )}

              {/* Phase 12: Expert Calibration Button */}
              {decisionId && (
                <button
                  onClick={() => setIsCalibrationModalOpen(true)}
                  className="px-4 py-2.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:text-purple-200 font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer shadow-sm"
                  title="Open Expert Calibration Intelligence"
                >
                  <Target className="w-4 h-4 text-purple-400" />
                  <span>Calibration</span>
                </button>
              )}

              {/* Phase 13: Audit History & Export Button */}
              {decisionId && (
                <button
                  onClick={() => setIsAuditExportModalOpen(true)}
                  className="px-4 py-2.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:text-cyan-200 font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer shadow-sm"
                  title="Open Decision History, Snapshots & Export Center"
                >
                  <History className="w-4 h-4 text-cyan-400" />
                  <span>History & Export</span>
                </button>
              )}

              {/* Export Briefing Button */}
              <button
                onClick={handleExportBriefing}
                className="px-4 py-2.5 rounded-xl bg-surface hover:bg-surface-subtle border border-border text-slate-200 hover:text-white font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-signal" />
                    <span>Briefing Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy Briefing</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>

        {/* Phase 6 Share Modal */}
        <ShareModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          decisionId={decisionId}
          decisionTitle={dataset.title}
        />

        {/* Phase 7 Contributions Modal */}
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

        {/* Phase 8 Evidence Modal */}
        <EvidenceModal
          isOpen={isEvidenceModalOpen}
          onClose={() => setIsEvidenceModalOpen(false)}
          decision={serverDecision}
        />

        {/* Phase 9 AI Analyst Modal */}
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

        {/* Phase 10 Advanced Analytics Modal */}
        <AnalyticsModal
          isOpen={isAnalyticsModalOpen}
          onClose={() => setIsAnalyticsModalOpen(false)}
          decision={serverDecision}
        />

        {/* Phase 11 Disagreement Intelligence Modal */}
        <DisagreementsModal
          isOpen={isDisagreementsModalOpen}
          onClose={() => setIsDisagreementsModalOpen(false)}
          decision={serverDecision}
        />

        {/* Phase 12 Expert Calibration Modal */}
        <ExpertCalibrationModal
          isOpen={isCalibrationModalOpen}
          onClose={() => setIsCalibrationModalOpen(false)}
          decision={serverDecision}
        />

        {/* Phase 13 Decision Audit, History & Export Modal */}
        <AuditExportModal
          isOpen={isAuditExportModalOpen}
          onClose={() => setIsAuditExportModalOpen(false)}
          decision={serverDecision}
        />
      </div>
    </AnimatePresence>
  );
};
