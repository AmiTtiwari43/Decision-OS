import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  PieChart,
  RefreshCw,
  Loader2,
  AlertCircle,
  Calendar,
  Layers,
} from 'lucide-react';
import {
  apiClient,
  ApiClientError,
  type WorkspaceAnalyticsDto,
} from '../api/index.js';

export interface WorkspaceAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TimeframePreset = 'all' | '30d' | '90d';

export const WorkspaceAnalyticsModal: React.FC<WorkspaceAnalyticsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [timeframe, setTimeframe] = useState<TimeframePreset>('all');
  const [data, setData] = useState<WorkspaceAnalyticsDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkspaceAnalytics = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    let startDate: string | undefined;
    const now = new Date();

    if (timeframe === '30d') {
      const d = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30);
      startDate = d.toISOString();
    } else if (timeframe === '90d') {
      const d = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 90);
      startDate = d.toISOString();
    }

    try {
      const res = await apiClient.getWorkspaceAnalytics({ startDate });
      setData(res);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message || 'Failed to load workspace analytics.');
      } else {
        setError('An unexpected error occurred while loading workspace analytics.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [timeframe]);

  useEffect(() => {
    if (isOpen) {
      fetchWorkspaceAnalytics();
    }
  }, [isOpen, fetchWorkspaceAnalytics]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-4xl max-h-[90vh] bg-surface border border-border rounded-2xl shadow-glow-card flex flex-col overflow-hidden text-slate-100"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 sm:p-6 border-b border-border bg-surface-subtle/50 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-signal/10 border border-signal/20 flex items-center justify-center text-signal shrink-0">
                <PieChart className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                  Workspace Portfolio Analytics
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Portfolio decisions, outcomes, evidence coverage, and deliberation patterns
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={fetchWorkspaceAnalytics}
                disabled={isLoading}
                className="p-2 rounded-lg bg-surface hover:bg-surface-hover border border-border text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh"
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

          {/* Timeframe Bar */}
          <div className="flex items-center justify-between p-3 px-4 sm:px-6 border-b border-border bg-surface-subtle/30 text-xs shrink-0 flex-wrap gap-2">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Calendar className="w-3.5 h-3.5" />
              <span>Timeframe:</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setTimeframe('all')}
                className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                  timeframe === 'all'
                    ? 'bg-signal/15 text-signal border border-signal/30'
                    : 'text-slate-400 hover:text-white hover:bg-surface-hover'
                }`}
              >
                All Time
              </button>
              <button
                onClick={() => setTimeframe('30d')}
                className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                  timeframe === '30d'
                    ? 'bg-signal/15 text-signal border border-signal/30'
                    : 'text-slate-400 hover:text-white hover:bg-surface-hover'
                }`}
              >
                Last 30 Days
              </button>
              <button
                onClick={() => setTimeframe('90d')}
                className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                  timeframe === '90d'
                    ? 'bg-signal/15 text-signal border border-signal/30'
                    : 'text-slate-400 hover:text-white hover:bg-surface-hover'
                }`}
              >
                Last 90 Days
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            {isLoading && !data && (
              <div className="py-20 flex flex-col items-center justify-center text-center">
                <Loader2 className="w-8 h-8 text-signal animate-spin mb-3" />
                <p className="text-sm font-medium text-slate-300">Loading portfolio analytics...</p>
              </div>
            )}

            {error && (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-start gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-rose-200">Unable to load workspace analytics</h4>
                  <p className="text-xs text-rose-300 mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {data && data.decisionMetrics.totalDecisions === 0 && (
              <div className="py-16 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-surface-subtle border border-border flex items-center justify-center text-slate-500 mx-auto">
                  <Layers className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-white">No decisions found in this timeframe</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Create and evaluate decisions in your workspace to view portfolio performance trends, evidence coverage rates, and deliberation metrics.
                </p>
              </div>
            )}

            {data && data.decisionMetrics.totalDecisions > 0 && (
              <div className="space-y-6">
                {/* Decision Metrics KPIs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-4 rounded-xl bg-surface-subtle border border-border">
                    <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      Total Decisions
                    </div>
                    <div className="text-xl sm:text-2xl font-bold font-mono text-white mt-1">
                      {data.decisionMetrics.totalDecisions}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      {data.decisionMetrics.statusDistribution.decisive} decisive,{' '}
                      {data.decisionMetrics.statusDistribution.tie} tied
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-surface-subtle border border-border">
                    <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      Completion Rate
                    </div>
                    <div className="text-xl sm:text-2xl font-bold font-mono text-signal mt-1">
                      {data.decisionMetrics.completionRate}%
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      Fully scored & evaluated
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-surface-subtle border border-border">
                    <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      Evidence Coverage
                    </div>
                    <div className="text-xl sm:text-2xl font-bold font-mono text-cyan-400 mt-1">
                      {data.evidenceMetrics.decisionEvidenceCoverageRate}%
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      {data.evidenceMetrics.decisionsWithEvidenceCount} / {data.decisionMetrics.totalDecisions} decisions
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-surface-subtle border border-border">
                    <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      Total Deliberations
                    </div>
                    <div className="text-xl sm:text-2xl font-bold font-mono text-purple-400 mt-1">
                      {data.deliberationMetrics.totalContributions}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      {data.deliberationMetrics.submittedContributions} submitted
                    </div>
                  </div>
                </div>

                {/* Status Breakdown & Activity Trends */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Status Breakdown */}
                  <div className="p-5 rounded-xl bg-surface-subtle border border-border space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Outcome Distribution
                    </h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-slate-200">
                          <span className="w-2.5 h-2.5 rounded-full bg-signal" />
                          Decisive Outcomes
                        </span>
                        <span className="font-mono font-bold text-white">
                          {data.decisionMetrics.statusDistribution.decisive}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-slate-200">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                          Tied Outcomes
                        </span>
                        <span className="font-mono font-bold text-white">
                          {data.decisionMetrics.statusDistribution.tie}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-slate-200">
                          <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                          Unscored / Draft
                        </span>
                        <span className="font-mono font-bold text-white">
                          {data.decisionMetrics.statusDistribution.unscored}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Top Recurring Criteria */}
                  <div className="p-5 rounded-xl bg-surface-subtle border border-border space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Most Common Criteria
                    </h3>
                    {data.criteriaAndOptionsMetrics.topCriteriaNames.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">No criteria defined yet.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {data.criteriaAndOptionsMetrics.topCriteriaNames.slice(0, 5).map(c => (
                          <div key={c.name} className="flex items-center justify-between text-xs">
                            <span className="text-slate-200">{c.name}</span>
                            <span className="font-mono text-slate-400">
                              used in {c.count} {c.count === 1 ? 'decision' : 'decisions'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Evidence & Provenance Overview */}
                <div className="p-5 rounded-xl bg-surface-subtle border border-border space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                    <span>Evidence Records By Source Type</span>
                    <span className="font-mono text-slate-500">
                      Total: {data.evidenceMetrics.totalEvidenceRecords} records
                    </span>
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-3 rounded-lg bg-surface border border-border text-center">
                      <div className="text-[10px] font-mono text-slate-400 uppercase">Web Links</div>
                      <div className="text-lg font-bold font-mono text-white mt-0.5">
                        {data.evidenceMetrics.sourceTypeBreakdown.url}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-surface border border-border text-center">
                      <div className="text-[10px] font-mono text-slate-400 uppercase">Document Citations</div>
                      <div className="text-lg font-bold font-mono text-white mt-0.5">
                        {data.evidenceMetrics.sourceTypeBreakdown.document}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-surface border border-border text-center">
                      <div className="text-[10px] font-mono text-slate-400 uppercase">Verbatim Excerpts</div>
                      <div className="text-lg font-bold font-mono text-white mt-0.5">
                        {data.evidenceMetrics.sourceTypeBreakdown.excerpt}
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
                    {data.evidenceMetrics.methodologyDisclaimer}
                  </p>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
