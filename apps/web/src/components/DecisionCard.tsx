import React, { useState } from 'react';
import {
  Share2,
  Users,
  FileText,
  Bot,
  BarChart3,
  Scale,
  Target,
  Download,
  MoreVertical,
  Edit3,
  Trash2,
  Lock,
  ArrowRight,
  ShieldCheck,
  Award,
  AlertCircle,
  MessageSquare,
} from 'lucide-react';
import type { DecisionDto } from '../api/index.js';
import { getDecisionEvaluationStatus } from '../utils/decisionStatus.js';

export type FeatureModalType =
  | 'share'
  | 'contributions'
  | 'deliberation'
  | 'evidence'
  | 'ai'
  | 'analytics'
  | 'disagreements'
  | 'calibration'
  | 'audit'
  | 'export';

export interface DecisionCardProps {
  decision: DecisionDto;
  currentUserId?: string;
  onOpenStudio: (decision: DecisionDto) => void;
  onOpenFeature: (decision: DecisionDto, feature: FeatureModalType) => void;
  onEdit: (decision: DecisionDto) => void;
  onDelete: (decision: DecisionDto) => void;
}

export const DecisionCard: React.FC<DecisionCardProps> = ({
  decision,
  currentUserId,
  onOpenStudio,
  onOpenFeature,
  onEdit,
  onDelete,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Determine user's effective role on this decision
  const ownerIdStr = typeof decision.ownerId === 'string'
    ? decision.ownerId
    : decision.ownerId?._id;

  const isOwner = Boolean(
    decision.currentUserRole === 'owner' ||
    (currentUserId && ownerIdStr && currentUserId === ownerIdStr)
  );

  const effectiveRole = isOwner
    ? 'owner'
    : decision.currentUserRole || 'viewer';

  const roleBadgeStyles: Record<string, string> = {
    owner: 'bg-signal/15 text-signal border-signal/30',
    editor: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    contributor: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    viewer: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  };

  // Outcome / Evaluation State
  const evaluationStatus = getDecisionEvaluationStatus(decision);
  const isAuthoritative = evaluationStatus === 'decisive' || evaluationStatus === 'tie';
  const isStale = evaluationStatus === 'stale';
  const analysis = decision.analysis;
  const winnerOption =
    analysis?.winnerId && evaluationStatus === 'decisive'
      ? decision.options?.find((o) => o.id === analysis.winnerId) ?? null
      : null;
  const pointLead = analysis?.pointLead ?? 0;

  // Formatted date
  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const updatedFormatted = formatDate(decision.updatedAt || decision.createdAt);

  return (
    <div className="relative group p-5 rounded-2xl bg-surface-card border border-border hover:border-signal/40 transition-all duration-200 hover:shadow-glow-card flex flex-col justify-between text-slate-100">
      {/* Top Header */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded-md font-mono text-[10px] uppercase font-bold border tracking-wider ${
                roleBadgeStyles[effectiveRole] || roleBadgeStyles.viewer
              }`}
            >
              {effectiveRole}
            </span>

            {decision.isContributionRoundLocked && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10px] bg-rose-500/15 text-rose-300 border border-rose-500/30">
                <Lock className="w-2.5 h-2.5" />
                <span>Round Locked</span>
              </span>
            )}

            {isAuthoritative && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10px] bg-signal/10 text-signal border border-signal/20">
                <ShieldCheck className="w-2.5 h-2.5" />
                <span>Authoritative</span>
              </span>
            )}

            {isStale && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30">
                <AlertCircle className="w-2.5 h-2.5" />
                <span>Evaluation Stale</span>
              </span>
            )}
          </div>

          {/* Action Menu Trigger */}
          <div className="relative shrink-0">
            <button
              onClick={() => setIsMenuOpen((prev) => !prev)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-subtle transition-colors cursor-pointer"
              title="More actions"
              aria-label="More actions"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {isMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setIsMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-48 py-1 bg-surface border border-border rounded-xl shadow-xl z-40 text-xs text-slate-200 flex flex-col animate-in fade-in zoom-in-95">
                  {(isOwner || effectiveRole === 'editor') && (
                    <button
                      onClick={() => {
                        setIsMenuOpen(false);
                        onEdit(decision);
                      }}
                      className="px-3 py-2 text-left hover:bg-surface-subtle flex items-center gap-2 transition-colors cursor-pointer text-slate-200 hover:text-white"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-slate-400" />
                      <span>Edit Framing</span>
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenFeature(decision, 'audit');
                    }}
                    className="px-3 py-2 text-left hover:bg-surface-subtle flex items-center gap-2 transition-colors cursor-pointer text-slate-200 hover:text-white"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-400" />
                    <span>Audit & Export</span>
                  </button>

                  {isOwner && (
                    <button
                      onClick={() => {
                        setIsMenuOpen(false);
                        onDelete(decision);
                      }}
                      className="px-3 py-2 text-left hover:bg-rose-500/10 text-rose-400 hover:text-rose-300 flex items-center gap-2 transition-colors cursor-pointer border-t border-border mt-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Decision</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Title & Description */}
        <h3
          onClick={() => onOpenStudio(decision)}
          className="text-base font-bold text-white group-hover:text-signal transition-colors line-clamp-1 cursor-pointer"
          title={decision.title}
        >
          {decision.title}
        </h3>

        <p className="mt-1 text-xs text-slate-400 line-clamp-2 leading-relaxed min-h-[32px]">
          {decision.description || 'No descriptive context provided.'}
        </p>

        {/* Evaluated Winner Pill or Incomplete status */}
        <div className="mt-3.5 p-2.5 rounded-xl bg-surface/70 border border-border-subtle flex items-center justify-between text-xs">
          {evaluationStatus === 'decisive' && winnerOption ? (
            <div className="flex items-center gap-2 truncate">
              <Award className="w-4 h-4 text-signal shrink-0" />
              <div className="truncate">
                <span className="text-slate-300 text-[11px] truncate">
                  Lead:{' '}
                  <strong className="text-white font-semibold">
                    {winnerOption.name}
                  </strong>{' '}
                  <span className="text-signal font-mono font-medium">
                    (+{pointLead.toFixed(1)} pt lead)
                  </span>
                </span>
              </div>
            </div>
          ) : evaluationStatus === 'tie' ? (
            <div className="flex items-center gap-2 truncate">
              <Award className="w-4 h-4 text-amber-300 shrink-0" />
              <div className="truncate">
                <span className="font-mono text-amber-300 font-semibold text-[11px]">
                  Mathematical Tie Detected
                </span>
              </div>
            </div>
          ) : evaluationStatus === 'stale' ? (
            <div className="flex items-center gap-2 text-amber-400 text-[11px] font-mono">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>Stale Evaluation · Recalculation Required</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-slate-500 text-[11px] font-mono">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
              <span>Incomplete Evaluation / Draft</span>
            </div>
          )}

          <div className="shrink-0 text-[11px] font-mono text-slate-400 ml-2">
            {decision.options?.length ?? 0} opts · {decision.criteria?.length ?? 0} crit
          </div>
        </div>
      </div>

      {/* Footer & Quick Feature Bar */}
      <div className="mt-4 pt-3 border-t border-border/70 flex flex-col gap-3">
        {/* Quick Modal Launcher Buttons */}
        <div className="flex items-center justify-between gap-1 text-slate-400">
          <div className="flex items-center gap-1">
            <button
              onClick={() => onOpenFeature(decision, 'share')}
              className="p-1.5 rounded-lg hover:text-white hover:bg-surface-subtle transition-colors cursor-pointer"
              title="Share and manage collaborators"
              aria-label="Share and manage collaborators"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onOpenFeature(decision, 'contributions')}
              className="p-1.5 rounded-lg hover:text-white hover:bg-surface-subtle transition-colors cursor-pointer"
              title="Expert Deliberation & Contributions"
              aria-label="Expert Deliberation"
            >
              <Users className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onOpenFeature(decision, 'deliberation')}
              className="p-1.5 rounded-lg hover:text-white hover:bg-surface-subtle transition-colors cursor-pointer"
              title="Stakeholder Deliberation Threads"
              aria-label="Stakeholder Deliberation Threads"
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onOpenFeature(decision, 'evidence')}
              className="p-1.5 rounded-lg hover:text-white hover:bg-surface-subtle transition-colors cursor-pointer"
              title="Evidence Ledger"
              aria-label="Evidence Ledger"
            >
              <FileText className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onOpenFeature(decision, 'ai')}
              className="p-1.5 rounded-lg hover:text-signal hover:bg-signal/10 transition-colors cursor-pointer"
              title="Autonomous AI Decision Analyst"
              aria-label="AI Decision Analyst"
            >
              <Bot className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onOpenFeature(decision, 'analytics')}
              className="p-1.5 rounded-lg hover:text-white hover:bg-surface-subtle transition-colors cursor-pointer"
              title="Deep Decision Analytics"
              aria-label="Deep Decision Analytics"
            >
              <BarChart3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onOpenFeature(decision, 'disagreements')}
              className="p-1.5 rounded-lg hover:text-white hover:bg-surface-subtle transition-colors cursor-pointer"
              title="Stakeholder Disagreements"
              aria-label="Stakeholder Disagreements"
            >
              <Scale className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onOpenFeature(decision, 'calibration')}
              className="p-1.5 rounded-lg hover:text-white hover:bg-surface-subtle transition-colors cursor-pointer"
              title="Brier Calibration & Forecasting"
              aria-label="Brier Calibration"
            >
              <Target className="w-3.5 h-3.5" />
            </button>
          </div>

          <span className="text-[10px] font-mono text-slate-500 shrink-0">
            {updatedFormatted}
          </span>
        </div>

        {/* Primary Launch Action */}
        <button
          onClick={() => onOpenStudio(decision)}
          className="w-full py-2 px-3 rounded-xl bg-surface hover:bg-surface-subtle border border-border hover:border-signal/50 text-xs font-semibold text-slate-200 hover:text-white flex items-center justify-center gap-2 transition-all cursor-pointer group-hover:shadow-glow-signal-sm"
        >
          <span>Open Studio Workspace</span>
          <ArrowRight className="w-3.5 h-3.5 text-signal transition-transform group-hover:translate-x-1" />
        </button>
      </div>
    </div>
  );
};
