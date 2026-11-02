import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import {
  Plus,
  Search,
  RefreshCw,
  Loader2,
  AlertCircle,
  FileSpreadsheet,
  Layers,
  UserCheck,
  Share2,
  Mail,
  PieChart,
  X,
  Command,
} from 'lucide-react';
import {
  apiClient,
  ApiClientError,
  type DecisionDto,
  type PendingInvitationDto,
  type WorkspaceAnalyticsDto,
  type CreateDecisionPayload,
} from '../api/index.js';
import { useAuth } from '../hooks/useAuth.js';
import { templateDatasets } from '../data/decisionData.js';
import { PortfolioSummary } from './PortfolioSummary.js';
import { DecisionCard, type FeatureModalType } from './DecisionCard.js';
import { getDecisionEvaluationStatus } from '../utils/decisionStatus.js';
import { CreateDecisionModal } from './CreateDecisionModal.js';
import { EditDecisionModal } from './EditDecisionModal.js';
import { DeleteDecisionModal } from './DeleteDecisionModal.js';
import { PendingInvitationsView } from './PendingInvitationsView.js';

// Lazy-loaded feature dialogs
const ShareModal = React.lazy(() => import('./ShareModal.js').then((m) => ({ default: m.ShareModal })));
const ContributionsModal = React.lazy(() => import('./ContributionsModal.js').then((m) => ({ default: m.ContributionsModal })));
const EvidenceModal = React.lazy(() => import('./EvidenceModal.js').then((m) => ({ default: m.EvidenceModal })));
const AiAnalystModal = React.lazy(() => import('./AiAnalystModal.js').then((m) => ({ default: m.AiAnalystModal })));
const AnalyticsModal = React.lazy(() => import('./AnalyticsModal.js').then((m) => ({ default: m.AnalyticsModal })));
const DisagreementsModal = React.lazy(() => import('./DisagreementsModal.js').then((m) => ({ default: m.DisagreementsModal })));
const ExpertCalibrationModal = React.lazy(() => import('./ExpertCalibrationModal.js').then((m) => ({ default: m.ExpertCalibrationModal })));
const AuditExportModal = React.lazy(() => import('./AuditExportModal.js').then((m) => ({ default: m.AuditExportModal })));
const WorkspaceAnalyticsModal = React.lazy(() => import('./WorkspaceAnalyticsModal.js').then((m) => ({ default: m.WorkspaceAnalyticsModal })));

export type DashboardTab =
  | 'overview'
  | 'my-decisions'
  | 'shared-with-me'
  | 'invitations'
  | 'analytics';

export type StatusFilter = 'all' | 'decisive' | 'tie' | 'unscored' | 'stale';
export type SortOrder = 'updated-desc' | 'updated-asc' | 'title-asc' | 'created-desc';

export interface DashboardProps {
  onOpenStudio: (decision: DecisionDto) => void;
  onOpenAudit?: () => void;
  onViewProductTour?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  onOpenStudio,
  onOpenAudit,
  onViewProductTour,
}) => {
  const { user } = useAuth();

  // Core Data States
  const [decisions, setDecisions] = useState<DecisionDto[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitationDto[]>([]);
  const [workspaceAnalytics, setWorkspaceAnalytics] = useState<WorkspaceAnalyticsDto | null>(null);

  // Loading & Error States
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Navigation, Search & Filters
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('updated-desc');

  // Modal Controllers
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingDecision, setEditingDecision] = useState<DecisionDto | null>(null);
  const [deletingDecision, setDeletingDecision] = useState<DecisionDto | null>(null);
  const [activeFeatureModal, setActiveFeatureModal] = useState<{
    feature: FeatureModalType;
    decision: DecisionDto;
  } | null>(null);
  const [isWorkspaceAnalyticsModalOpen, setIsWorkspaceAnalyticsModalOpen] = useState(false);

  // Fetch all initial data
  const loadDashboardData = useCallback(async (isBackground = false) => {
    if (isBackground) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const [decisionsRes, invitesRes, analyticsRes] = await Promise.allSettled([
        apiClient.listDecisions({ limit: 100 }),
        apiClient.getPendingInvitations(),
        apiClient.getWorkspaceAnalytics(),
      ]);

      if (decisionsRes.status === 'fulfilled') {
        setDecisions(decisionsRes.value.items || []);
      } else {
        const err = decisionsRes.reason;
        if (err instanceof ApiClientError) {
          setError(err.message || 'Failed to retrieve decisions.');
        } else {
          setError('Failed to connect to Decision OS backend.');
        }
      }

      if (invitesRes.status === 'fulfilled') {
        setPendingInvitations(invitesRes.value.items || []);
      }

      if (analyticsRes.status === 'fulfilled') {
        setWorkspaceAnalytics(analyticsRes.value);
      }
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message || 'Error communicating with server.');
      } else {
        setError('Network error occurred while fetching dashboard data.');
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Handle starter template quick-creation from empty state
  const handleQuickCreateFromTemplate = async (templateId: string) => {
    const tpl = templateDatasets.find((t) => t.id === templateId);
    if (!tpl) return;

    setIsRefreshing(true);
    setError(null);

    try {
      const payload: CreateDecisionPayload = {
        title: tpl.title,
        description: tpl.context || tpl.question,
        criteria: tpl.criteria.map((c) => ({
          id: c.id,
          name: c.name,
          shortName: c.shortName,
          weight: c.defaultWeight,
          direction: 'benefit',
        })),
        options: tpl.options.map((o) => ({
          id: o.id,
          name: o.name,
          tagline: o.tagline,
          description: o.description,
          color: o.color,
        })),
        scores: Object.fromEntries(
          tpl.options.map((o) => [o.id, { ...o.scores }])
        ),
      };

      const created = await apiClient.createDecision(payload);
      setDecisions((prev) => [created, ...prev]);
      onOpenStudio(created);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message || 'Failed to instantiate starter template.');
      } else {
        setError('Failed to instantiate template.');
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // Metrics Calculations
  const metrics = useMemo(() => {
    const total = decisions.length;
    let owned = 0;
    let decisive = 0;
    let ties = 0;
    let totalPointsLead = 0;
    let evaluatedCount = 0;

    for (const d of decisions) {
      const ownerIdStr = typeof d.ownerId === 'string' ? d.ownerId : d.ownerId?._id;
      const isOwner = d.currentUserRole === 'owner' || (user && ownerIdStr === user.id);
      if (isOwner) {
        owned++;
      }

      const evalStatus = getDecisionEvaluationStatus(d);
      if (evalStatus === 'decisive' || evalStatus === 'tie') {
        evaluatedCount++;
        if (evalStatus === 'decisive') {
          decisive++;
          totalPointsLead += d.analysis?.pointLead || 0;
        } else {
          ties++;
        }
      }
    }

    const shared = total - owned;
    const avgLead = decisive > 0 ? totalPointsLead / decisive : 0;

    return {
      total,
      owned,
      shared,
      decisive,
      ties,
      evaluatedCount,
      avgLead,
    };
  }, [decisions, user]);

  // Filtering & Sorting
  const filteredDecisions = useMemo(() => {
    let result = [...decisions];

    // Filter by Active Tab
    if (activeTab === 'my-decisions') {
      result = result.filter((d) => {
        const ownerIdStr = typeof d.ownerId === 'string' ? d.ownerId : d.ownerId?._id;
        return d.currentUserRole === 'owner' || (user && ownerIdStr === user.id);
      });
    } else if (activeTab === 'shared-with-me') {
      result = result.filter((d) => {
        const ownerIdStr = typeof d.ownerId === 'string' ? d.ownerId : d.ownerId?._id;
        const isOwner = d.currentUserRole === 'owner' || (user && ownerIdStr === user.id);
        return !isOwner;
      });
    }

    // Filter by Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          (d.description && d.description.toLowerCase().includes(q))
      );
    }

    // Filter by Evaluation Status
    if (statusFilter === 'decisive') {
      result = result.filter(
        (d) => getDecisionEvaluationStatus(d) === 'decisive'
      );
    } else if (statusFilter === 'tie') {
      result = result.filter((d) => getDecisionEvaluationStatus(d) === 'tie');
    } else if (statusFilter === 'unscored') {
      result = result.filter((d) => getDecisionEvaluationStatus(d) === 'draft');
    } else if (statusFilter === 'stale') {
      result = result.filter((d) => getDecisionEvaluationStatus(d) === 'stale');
    }

    // Sort order
    result.sort((a, b) => {
      if (sortOrder === 'updated-desc') {
        return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
      }
      if (sortOrder === 'updated-asc') {
        return new Date(a.updatedAt || a.createdAt).getTime() - new Date(b.updatedAt || b.createdAt).getTime();
      }
      if (sortOrder === 'created-desc') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sortOrder === 'title-asc') {
        return a.title.localeCompare(b.title);
      }
      return 0;
    });

    return result;
  }, [decisions, activeTab, searchQuery, statusFilter, sortOrder, user]);

  return (
    <div className="pt-24 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-8 animate-fade-in text-slate-100">
      {/* Dashboard Top Header Banner */}
      <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-surface-card via-surface to-surface-card border border-border shadow-glow-card relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-signal/15 border border-signal/30 text-xs font-mono font-semibold text-signal mb-3">
              <span className="w-2 h-2 rounded-full bg-signal animate-pulse" />
              <span>Decision Hub · Executive Command</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
              Welcome back, <span className="text-signal">{user?.name}</span>
            </h1>
            <p className="mt-2 text-sm sm:text-base text-slate-300 max-w-2xl leading-relaxed">
              Manage multi-criteria decisions, review algorithmic tipping points, and inspect collaborative stakeholder deliberations.
            </p>
          </div>

          {/* Quick CTA Actions */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={() => setIsCreateOpen(true)}
              className="px-5 py-2.5 rounded-xl bg-signal hover:bg-signal-light text-background font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-glow-signal-sm transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Decision</span>
            </button>

            <button
              onClick={() => loadDashboardData(true)}
              disabled={isRefreshing}
              className="p-2.5 rounded-xl bg-surface hover:bg-surface-subtle border border-border text-slate-300 hover:text-white transition-all cursor-pointer disabled:opacity-50"
              title="Refresh dashboard data"
              aria-label="Refresh dashboard data"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-signal' : ''}`} />
            </button>

            {onViewProductTour && (
              <button
                onClick={onViewProductTour}
                className="px-4 py-2.5 rounded-xl bg-surface hover:bg-surface-subtle border border-border text-xs text-slate-300 hover:text-white transition-all cursor-pointer"
              >
                Product Tour
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Recoverable Error Banner */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-4 text-xs text-rose-300">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => loadDashboardData()}
            className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 font-mono font-semibold transition-all cursor-pointer text-xs shrink-0"
          >
            Retry Fetch
          </button>
        </div>
      )}

      {/* Portfolio Summary KPI Metrics */}
      <PortfolioSummary
        totalDecisions={metrics.total}
        ownedCount={metrics.owned}
        sharedCount={metrics.shared}
        pendingInvitationsCount={pendingInvitations.length}
        decisiveCount={metrics.decisive}
        averagePointLead={metrics.avgLead}
        activeFilter={activeTab === 'my-decisions' ? 'owner' : activeTab === 'shared-with-me' ? 'shared' : 'all'}
        onFilterChange={(filter) => {
          if (filter === 'all') setActiveTab('overview');
          if (filter === 'owner') setActiveTab('my-decisions');
          if (filter === 'shared') setActiveTab('shared-with-me');
        }}
        onSelectInvitations={() => setActiveTab('invitations')}
      />

      {/* Navigation Tabs Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        {/* Navigation Tabs */}
        <nav className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-signal text-background font-bold shadow-glow-signal-sm'
                : 'bg-surface hover:bg-surface-subtle border border-border text-slate-300 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Overview ({metrics.total})</span>
          </button>

          <button
            onClick={() => setActiveTab('my-decisions')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'my-decisions'
                ? 'bg-signal text-background font-bold shadow-glow-signal-sm'
                : 'bg-surface hover:bg-surface-subtle border border-border text-slate-300 hover:text-white'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>My Decisions ({metrics.owned})</span>
          </button>

          <button
            onClick={() => setActiveTab('shared-with-me')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'shared-with-me'
                ? 'bg-signal text-background font-bold shadow-glow-signal-sm'
                : 'bg-surface hover:bg-surface-subtle border border-border text-slate-300 hover:text-white'
            }`}
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Shared With Me ({metrics.shared})</span>
          </button>

          <button
            onClick={() => setActiveTab('invitations')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'invitations'
                ? 'bg-signal text-background font-bold shadow-glow-signal-sm'
                : 'bg-surface hover:bg-surface-subtle border border-border text-slate-300 hover:text-white'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Invitations</span>
            {pendingInvitations.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-rose-500 text-white font-mono text-[10px] flex items-center justify-center font-bold">
                {pendingInvitations.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('analytics')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'analytics'
                ? 'bg-signal text-background font-bold shadow-glow-signal-sm'
                : 'bg-surface hover:bg-surface-subtle border border-border text-slate-300 hover:text-white'
            }`}
          >
            <PieChart className="w-3.5 h-3.5" />
            <span>Workspace Analytics</span>
          </button>
        </nav>

        {/* Global Modal Audit Trigger */}
        {onOpenAudit && (
          <button
            onClick={onOpenAudit}
            className="hidden lg:flex items-center gap-2 text-xs font-mono text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            title="Inspect Mathematical Engine"
          >
            <Command className="w-3.5 h-3.5" />
            <span>Inspect Engine (Cmd+K)</span>
          </button>
        )}
      </div>

      {/* Tab Content Display */}
      {activeTab === 'invitations' ? (
        <PendingInvitationsView
          invitations={pendingInvitations}
          isLoading={isLoading}
          onRefresh={() => loadDashboardData(true)}
          onAccepted={async (decisionId) => {
            await loadDashboardData(true);
            const found = decisions.find((d) => d._id === decisionId);
            if (found) {
              onOpenStudio(found);
            }
          }}
        />
      ) : activeTab === 'analytics' ? (
        /* Workspace Analytics Section */
        <div className="space-y-6">
          <div className="p-6 rounded-2xl bg-surface-card border border-border">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <PieChart className="w-5 h-5 text-signal" />
                  <span>Workspace Portfolio Intelligence</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Cross-decision deliberation metrics, evidence coverage, and outcome distribution
                </p>
              </div>

              <button
                onClick={() => setIsWorkspaceAnalyticsModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-subtle border border-border text-xs text-slate-200 hover:text-white flex items-center gap-2 transition-all cursor-pointer"
              >
                <span>Expanded Analytics Dialog</span>
              </button>
            </div>

            {workspaceAnalytics ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-surface border border-border-subtle">
                  <span className="text-[11px] font-mono text-slate-400 uppercase">Outcome Breakdown</span>
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-300">Decisive Decisions</span>
                      <strong className="text-emerald-400 font-mono">
                        {workspaceAnalytics.decisionMetrics.statusDistribution.decisive}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-300">Mathematical Ties</span>
                      <strong className="text-amber-400 font-mono">
                        {workspaceAnalytics.decisionMetrics.statusDistribution.tie}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-300">Unscored / Incomplete</span>
                      <strong className="text-slate-400 font-mono">
                        {workspaceAnalytics.decisionMetrics.statusDistribution.unscored}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-surface border border-border-subtle">
                  <span className="text-[11px] font-mono text-slate-400 uppercase">Evidence Rigor</span>
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-300">Coverage Rate</span>
                      <strong className="text-cyan-400 font-mono">
                        {workspaceAnalytics.evidenceMetrics.decisionEvidenceCoverageRate}%
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-300">Total Artifacts</span>
                      <strong className="text-white font-mono">
                        {workspaceAnalytics.evidenceMetrics.totalEvidenceRecords}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-300">Decisions Supported</span>
                      <strong className="text-slate-300 font-mono">
                        {workspaceAnalytics.evidenceMetrics.decisionsWithEvidenceCount} / {workspaceAnalytics.decisionMetrics.totalDecisions}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-surface border border-border-subtle">
                  <span className="text-[11px] font-mono text-slate-400 uppercase">Deliberation Dynamics</span>
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-300">Total Expert Votes</span>
                      <strong className="text-purple-400 font-mono">
                        {workspaceAnalytics.deliberationMetrics.totalContributions}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-300">Submitted Revisions</span>
                      <strong className="text-white font-mono">
                        {workspaceAnalytics.deliberationMetrics.submittedContributions}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-300">Locked Rounds</span>
                      <strong className="text-slate-400 font-mono">
                        {workspaceAnalytics.decisionMetrics.roundLockDistribution.locked}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-signal mx-auto mb-2" />
                <span>Aggregating portfolio metrics...</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Decisions Listing Views: Overview, My Decisions, Shared With Me */
        <div className="space-y-6">
          {/* Search & Filtering Toolbar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-surface-card p-3 rounded-2xl border border-border">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search decisions by title, trade-off or criteria..."
                className="w-full pl-9 pr-8 py-2 rounded-xl bg-surface border border-border focus:border-signal text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter by Evaluation Status */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 p-1 bg-surface rounded-xl border border-border text-xs font-mono">
                <span className="text-[11px] text-slate-500 pl-2 hidden sm:inline">Status:</span>
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer text-xs ${
                    statusFilter === 'all'
                      ? 'bg-signal/20 text-signal font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setStatusFilter('decisive')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer text-xs ${
                    statusFilter === 'decisive'
                      ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Decisive
                </button>
                <button
                  onClick={() => setStatusFilter('tie')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer text-xs ${
                    statusFilter === 'tie'
                      ? 'bg-amber-500/20 text-amber-300 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Tie
                </button>
                <button
                  onClick={() => setStatusFilter('unscored')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer text-xs ${
                    statusFilter === 'unscored'
                      ? 'bg-slate-600/30 text-slate-200 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Draft
                </button>
                {decisions.some((d) => getDecisionEvaluationStatus(d) === 'stale') && (
                  <button
                    onClick={() => setStatusFilter('stale')}
                    className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer text-xs ${
                      statusFilter === 'stale'
                        ? 'bg-amber-500/20 text-amber-300 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Stale
                  </button>
                )}
              </div>

              {/* Sort Dropdown */}
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                className="px-3 py-2 rounded-xl bg-surface border border-border text-xs text-slate-300 focus:border-signal focus:outline-none transition-colors cursor-pointer font-mono"
              >
                <option value="updated-desc">Recently Updated</option>
                <option value="updated-asc">Oldest Updated</option>
                <option value="created-desc">Recently Created</option>
                <option value="title-asc">Title (A-Z)</option>
              </select>
            </div>
          </div>

          {/* Loading Initial State */}
          {isLoading && decisions.length === 0 ? (
            <div className="py-24 flex flex-col items-center justify-center text-center">
              <Loader2 className="w-8 h-8 text-signal animate-spin mb-3" />
              <p className="text-sm font-medium text-slate-300">Loading decision portfolio...</p>
              <p className="text-xs text-slate-500 mt-1">Connecting to Decision OS backend</p>
            </div>
          ) : decisions.length === 0 ? (
            /* Empty State: Zero Decisions Created Yet */
            <div className="p-8 sm:p-14 rounded-3xl bg-surface-card border border-border flex flex-col items-center justify-center text-center max-w-3xl mx-auto space-y-6">
              <div className="w-16 h-16 rounded-2xl bg-signal/10 border border-signal/30 flex items-center justify-center text-signal shadow-glow-signal-sm">
                <FileSpreadsheet className="w-8 h-8" />
              </div>

              <div className="space-y-2">
                <h3 className="text-xl sm:text-2xl font-extrabold text-white">
                  Welcome to Your Decision Hub
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 max-w-lg mx-auto leading-relaxed">
                  Decision OS replaces subjective opinions with mathematical Multi-Criteria Decision Analysis (MCDA). Create your first decision to evaluate alternatives across weighted criteria and reveal exact tipping points.
                </p>
              </div>

              <button
                onClick={() => setIsCreateOpen(true)}
                className="px-6 py-3 rounded-xl bg-signal hover:bg-signal-light text-background font-bold text-sm flex items-center gap-2 shadow-glow-signal-sm transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create Your First Decision</span>
              </button>

              {/* Starter Templates Grid */}
              <div className="w-full pt-6 border-t border-border/80">
                <div className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mb-4">
                  Or launch with a production-ready starter blueprint:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
                  {templateDatasets.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => handleQuickCreateFromTemplate(tpl.id)}
                      className="p-4 rounded-xl bg-surface border border-border hover:border-signal/50 text-slate-300 hover:text-white transition-all cursor-pointer flex flex-col justify-between gap-3 group"
                    >
                      <div>
                        <div className="text-xs font-bold text-white group-hover:text-signal transition-colors line-clamp-1">
                          {tpl.title.split(':')[0]}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                          {tpl.context || tpl.question}
                        </p>
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-2 border-t border-border-subtle">
                        <span>{tpl.options.length} options · {tpl.criteria.length} crit</span>
                        <span className="text-signal group-hover:translate-x-0.5 transition-transform">Start →</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : filteredDecisions.length === 0 ? (
            /* Zero Search/Filter Results */
            <div className="p-12 rounded-2xl bg-surface-card border border-border-subtle flex flex-col items-center justify-center text-center space-y-3">
              <Search className="w-8 h-8 text-slate-500" />
              <h4 className="text-sm font-bold text-white">No matching decisions found</h4>
              <p className="text-xs text-slate-400 max-w-md">
                No decisions match your current search query or status filter. Try clearing your filters or creating a new decision.
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                }}
                className="mt-2 px-3.5 py-1.5 rounded-lg bg-surface border border-border text-xs text-slate-200 hover:text-white cursor-pointer"
              >
                Clear Filters
              </button>
            </div>
          ) : (
            /* Render Decision Cards Grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {filteredDecisions.map((decision) => (
                <DecisionCard
                  key={decision._id}
                  decision={decision}
                  currentUserId={user?.id}
                  onOpenStudio={(d) => onOpenStudio(d)}
                  onOpenFeature={(d, feature) => {
                    setActiveFeatureModal({ feature, decision: d });
                  }}
                  onEdit={(d) => setEditingDecision(d)}
                  onDelete={(d) => setDeletingDecision(d)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Primary Decision Management Modals */}
      <CreateDecisionModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(newDecision, openInStudio) => {
          setDecisions((prev) => [newDecision, ...prev]);
          if (openInStudio) {
            onOpenStudio(newDecision);
          }
        }}
      />

      {editingDecision && (
        <EditDecisionModal
          isOpen={editingDecision !== null}
          onClose={() => setEditingDecision(null)}
          decision={editingDecision}
          onUpdated={(updated) => {
            setDecisions((prev) =>
              prev.map((d) => (d._id === updated._id ? updated : d))
            );
          }}
        />
      )}

      {deletingDecision && (
        <DeleteDecisionModal
          isOpen={deletingDecision !== null}
          onClose={() => setDeletingDecision(null)}
          decision={deletingDecision}
          onDeleted={(deletedId) => {
            setDecisions((prev) => prev.filter((d) => d._id !== deletedId));
          }}
        />
      )}

      {/* Feature Modals Container */}
      <Suspense fallback={null}>
        {activeFeatureModal && (
          <>
            {activeFeatureModal.feature === 'share' && (
              <ShareModal
                key={`share-${activeFeatureModal.decision._id}`}
                isOpen={true}
                onClose={() => setActiveFeatureModal(null)}
                decisionId={activeFeatureModal.decision._id}
                decisionTitle={activeFeatureModal.decision.title}
              />
            )}

            {activeFeatureModal.feature === 'contributions' && (
              <ContributionsModal
                key={`contributions-${activeFeatureModal.decision._id}`}
                isOpen={true}
                onClose={() => setActiveFeatureModal(null)}
                decision={activeFeatureModal.decision}
                onDecisionUpdated={(updated) => {
                  setDecisions((prev) =>
                    prev.map((d) => (d._id === updated._id ? updated : d))
                  );
                }}
              />
            )}

            {activeFeatureModal.feature === 'evidence' && (
              <EvidenceModal
                key={`evidence-${activeFeatureModal.decision._id}`}
                isOpen={true}
                onClose={() => setActiveFeatureModal(null)}
                decision={activeFeatureModal.decision}
              />
            )}

            {activeFeatureModal.feature === 'ai' && (
              <AiAnalystModal
                key={`ai-${activeFeatureModal.decision._id}`}
                isOpen={true}
                onClose={() => setActiveFeatureModal(null)}
                decision={activeFeatureModal.decision}
                onDecisionUpdated={(updated) => {
                  setDecisions((prev) =>
                    prev.map((d) => (d._id === updated._id ? updated : d))
                  );
                }}
              />
            )}

            {activeFeatureModal.feature === 'analytics' && (
              <AnalyticsModal
                key={`analytics-${activeFeatureModal.decision._id}`}
                isOpen={true}
                onClose={() => setActiveFeatureModal(null)}
                decision={activeFeatureModal.decision}
              />
            )}

            {activeFeatureModal.feature === 'disagreements' && (
              <DisagreementsModal
                key={`disagreements-${activeFeatureModal.decision._id}`}
                isOpen={true}
                onClose={() => setActiveFeatureModal(null)}
                decision={activeFeatureModal.decision}
              />
            )}

            {activeFeatureModal.feature === 'calibration' && (
              <ExpertCalibrationModal
                key={`calibration-${activeFeatureModal.decision._id}`}
                isOpen={true}
                onClose={() => setActiveFeatureModal(null)}
                decision={activeFeatureModal.decision}
              />
            )}

            {activeFeatureModal.feature === 'audit' && (
              <AuditExportModal
                key={`audit-${activeFeatureModal.decision._id}`}
                isOpen={true}
                onClose={() => setActiveFeatureModal(null)}
                decision={activeFeatureModal.decision}
              />
            )}
          </>
        )}

        {isWorkspaceAnalyticsModalOpen && (
          <WorkspaceAnalyticsModal
            isOpen={isWorkspaceAnalyticsModalOpen}
            onClose={() => setIsWorkspaceAnalyticsModalOpen(false)}
          />
        )}
      </Suspense>
    </div>
  );
};
