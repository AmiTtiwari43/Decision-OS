import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  History,
  Download,
  ShieldCheck,
  Camera,
  FileSpreadsheet,
  FileCode,
  FileText,
  User,
  ChevronRight,
} from 'lucide-react';
import {
  apiClient,
  ApiClientError,
  type DecisionDto,
  type AuditEventDto,
  type ChainVerificationResultDto,
  type DecisionSnapshotDto,
  type ExportFormat,
} from '../api/index.js';

export interface AuditExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  decision: DecisionDto | null;
}

export const AuditExportModal: React.FC<AuditExportModalProps> = ({
  isOpen,
  onClose,
  decision,
}) => {
  const [activeTab, setActiveTab] = useState<'history' | 'snapshots' | 'export'>('history');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Audit History state
  const [auditEvents, setAuditEvents] = useState<AuditEventDto[]>([]);
  const [totalEvents, setTotalEvents] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [chainResult, setChainResult] = useState<ChainVerificationResultDto | null>(null);
  const [isVerifyingChain, setIsVerifyingChain] = useState<boolean>(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  // Snapshots state
  const [snapshots, setSnapshots] = useState<DecisionSnapshotDto[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<DecisionSnapshotDto | null>(null);
  const [isCapturingSnapshot, setIsCapturingSnapshot] = useState<boolean>(false);
  const [snapshotReason, setSnapshotReason] = useState<'milestone' | 'manual'>('milestone');
  const [snapshotNote, setSnapshotNote] = useState<string>('');
  const [isSubmittingSnapshot, setIsSubmittingSnapshot] = useState<boolean>(false);

  // Export state
  const [isExporting, setIsExporting] = useState<ExportFormat | null>(null);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);

  const fetchAuditData = useCallback(async () => {
    if (!decision?._id) return;
    setIsLoading(true);
    setError(null);
    try {
      const filter: { page: number; limit: number; action?: string } = { page, limit: 25 };
      if (actionFilter !== 'all') {
        filter.action = `${actionFilter}.*`;
      }
      const [historyRes, chainRes, snapshotsRes] = await Promise.all([
        apiClient.getDecisionAuditHistory(decision._id, filter),
        apiClient.verifyAuditChain(decision._id),
        apiClient.getDecisionSnapshots(decision._id),
      ]);
      setAuditEvents(historyRes.items);
      setTotalEvents(historyRes.total);
      setHasMore(historyRes.hasMore);
      setChainResult(chainRes);
      setSnapshots(snapshotsRes.items);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to load audit history and snapshot records.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [decision, page, actionFilter]);

  useEffect(() => {
    if (isOpen && decision?._id) {
      fetchAuditData();
    }
  }, [isOpen, decision, fetchAuditData]);

  const handleVerifyChain = async () => {
    if (!decision?._id) return;
    setIsVerifyingChain(true);
    try {
      const res = await apiClient.verifyAuditChain(decision._id);
      setChainResult(res);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      }
    } finally {
      setIsVerifyingChain(false);
    }
  };

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decision?._id) return;
    setIsSubmittingSnapshot(true);
    setError(null);
    try {
      await apiClient.createDecisionSnapshot(decision._id, {
        reason: snapshotReason,
        note: snapshotNote.trim() || undefined,
      });
      setIsCapturingSnapshot(false);
      setSnapshotNote('');
      fetchAuditData();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to create snapshot.');
      }
    } finally {
      setIsSubmittingSnapshot(false);
    }
  };

  const handleExportDownload = async (format: ExportFormat) => {
    if (!decision?._id) return;
    setIsExporting(format);
    setExportSuccessMsg(null);
    setError(null);
    try {
      const { content, filename, contentType } = await apiClient.exportDecision(decision._id, format);
      const blob = new Blob([content], { type: contentType });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      setExportSuccessMsg(`Successfully generated and downloaded ${filename}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError(`Failed to generate ${format.toUpperCase()} export.`);
      }
    } finally {
      setIsExporting(null);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="relative w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl">
                <History className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Decision Audit, History & Export</h2>
                <p className="text-xs text-slate-400">
                  {decision?.title || 'Decision'} &bull; Tamper-evident event timeline & portable briefings
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={fetchAuditData}
                disabled={isLoading}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
                title="Refresh history"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-800 bg-slate-950/50 px-6 gap-6 text-sm">
            <button
              onClick={() => setActiveTab('history')}
              className={`py-3 font-medium border-b-2 flex items-center space-x-2 transition ${
                activeTab === 'history'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              <History className="w-4 h-4" />
              <span>Audit Timeline</span>
              {totalEvents > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                  {totalEvents}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('snapshots')}
              className={`py-3 font-medium border-b-2 flex items-center space-x-2 transition ${
                activeTab === 'snapshots'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              <Camera className="w-4 h-4" />
              <span>Snapshots & Milestones</span>
              {snapshots.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                  {snapshots.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('export')}
              className={`py-3 font-medium border-b-2 flex items-center space-x-2 transition ${
                activeTab === 'export'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              <Download className="w-4 h-4" />
              <span>Export Center</span>
            </button>
          </div>

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {exportSuccessMsg && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{exportSuccessMsg}</span>
              </div>
            )}

            {/* TAB 1: AUDIT TIMELINE */}
            {activeTab === 'history' && (
              <div className="space-y-6">
                {/* Chain Verification Card */}
                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div
                      className={`p-2 rounded-lg ${
                        chainResult?.isValid
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-semibold text-white">
                          SHA-256 Hash Chain Integrity
                        </span>
                        {chainResult?.isValid ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                            Chain Verified
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-medium">
                            Chain Broken
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {chainResult?.totalEventsChecked || 0} events cryptographically linked &bull;
                        Head:{' '}
                        <code className="text-indigo-400">
                          {chainResult?.headHash ? chainResult.headHash.slice(0, 16) + '...' : 'Genesis'}
                        </code>
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleVerifyChain}
                    disabled={isVerifyingChain}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg flex items-center space-x-1.5 transition border border-slate-700 disabled:opacity-50"
                  >
                    {isVerifyingChain ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>Re-verify</span>
                  </button>
                </div>

                {/* Filter Controls */}
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {['all', 'decision', 'contribution', 'evidence', 'ai', 'sharing', 'prediction', 'snapshot'].map(
                      cat => (
                        <button
                          key={cat}
                          onClick={() => {
                            setActionFilter(cat);
                            setPage(1);
                          }}
                          className={`px-3 py-1.5 rounded-lg capitalize font-medium transition ${
                            actionFilter === cat
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                          }`}
                        >
                          {cat}
                        </button>
                      )
                    )}
                  </div>

                  <span className="text-xs text-slate-400">
                    Showing {auditEvents.length} of {totalEvents} events
                  </span>
                </div>

                {/* Timeline Events List */}
                {isLoading && auditEvents.length === 0 ? (
                  <div className="flex justify-center py-12 text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : auditEvents.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-xs">
                    No audit records match the selected filter.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {auditEvents.map(event => {
                      const isExpanded = expandedEventId === event.eventId;
                      return (
                        <div
                          key={event.eventId}
                          className="p-3.5 bg-slate-950/40 border border-slate-800 rounded-xl hover:border-slate-700 transition space-y-2"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                {event.action}
                              </span>
                              <span className="text-xs font-medium text-slate-200">{event.summary}</span>
                            </div>
                            <span className="text-[11px] text-slate-500 whitespace-nowrap">
                              {new Date(event.timestamp).toLocaleString()}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                            <div className="flex items-center space-x-4">
                              <span className="flex items-center space-x-1">
                                <User className="w-3 h-3 text-slate-500" />
                                <span>{event.actorName || event.actorEmail || event.actorId}</span>
                              </span>
                              <span className="text-[11px] text-slate-500 font-mono">
                                Hash: {event.eventHash.slice(0, 10)}...
                              </span>
                            </div>

                            {(event.diff || event.previousEventHash) && (
                              <button
                                onClick={() => setExpandedEventId(isExpanded ? null : event.eventId)}
                                className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-0.5"
                              >
                                <span>{isExpanded ? 'Hide details' : 'View details'}</span>
                                <ChevronRight
                                  className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                />
                              </button>
                            )}
                          </div>

                          {isExpanded && (
                            <div className="mt-2 p-3 bg-slate-900 border border-slate-800 rounded-lg text-xs space-y-2 font-mono">
                              <div>
                                <span className="text-slate-500">Event ID:</span>{' '}
                                <span className="text-slate-300">{event.eventId}</span>
                              </div>
                              <div>
                                <span className="text-slate-500">Previous Hash:</span>{' '}
                                <span className="text-slate-300">{event.previousEventHash}</span>
                              </div>
                              <div>
                                <span className="text-slate-500">Current Hash:</span>{' '}
                                <span className="text-slate-300">{event.eventHash}</span>
                              </div>
                              {event.diff && (
                                <div className="mt-2 pt-2 border-t border-slate-800">
                                  <span className="text-slate-500 block mb-1">State Diff:</span>
                                  <pre className="text-slate-300 text-[11px] overflow-x-auto p-2 bg-slate-950 rounded">
                                    {JSON.stringify(event.diff, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Pagination */}
                {totalEvents > 25 && (
                  <div className="flex items-center justify-between pt-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs rounded-lg disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-slate-400">Page {page}</span>
                    <button
                      onClick={() => setPage(p => p + 1)}
                      disabled={!hasMore}
                      className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs rounded-lg disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: SNAPSHOTS & MILESTONES */}
            {activeTab === 'snapshots' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Decision Snapshots</h3>
                    <p className="text-xs text-slate-400">
                      Preserved historical states, calculations, and specification hashes
                    </p>
                  </div>
                  <button
                    onClick={() => setIsCapturingSnapshot(!isCapturingSnapshot)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg flex items-center space-x-1.5 transition"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Capture Milestone</span>
                  </button>
                </div>

                {/* Capture Drawer */}
                {isCapturingSnapshot && (
                  <form
                    onSubmit={handleCreateSnapshot}
                    className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3"
                  >
                    <h4 className="text-xs font-semibold text-white">Create Historical Milestone Snapshot</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Snapshot Reason</label>
                        <select
                          value={snapshotReason}
                          onChange={e => setSnapshotReason(e.target.value as 'milestone' | 'manual')}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                        >
                          <option value="milestone">Stakeholder Milestone</option>
                          <option value="manual">Manual Snapshot</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Note (Optional)</label>
                        <input
                          type="text"
                          value={snapshotNote}
                          onChange={e => setSnapshotNote(e.target.value)}
                          placeholder="e.g. Q4 Executive Signoff"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end space-x-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setIsCapturingSnapshot(false)}
                        className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmittingSnapshot}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg flex items-center space-x-1.5"
                      >
                        {isSubmittingSnapshot && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>Capture Snapshot</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* Snapshots List */}
                {snapshots.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-xs">
                    No milestone snapshots captured yet. Capture a snapshot to preserve this decision's current state.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {snapshots.map(s => (
                      <div
                        key={s.snapshotId}
                        className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl hover:border-slate-700 transition flex items-center justify-between"
                      >
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-indigo-400">
                              v{s.version}
                            </span>
                            <span className="text-sm font-semibold text-white">{s.title}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 capitalize">
                              {s.snapshotReason}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            {s.snapshotNote || 'No milestone note'} &bull; Engine:{' '}
                            <code className="text-slate-300">
                              {s.analysis?.engineVersion || 'uncalculated'}
                            </code>
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Winner: <strong className="text-slate-300">{
                              (s.analysis?.decisionOutcome as string) === 'invalid'
                                ? 'Invalid'
                                : (s.analysis?.decisionOutcome as string) === 'incomplete'
                                ? 'Incomplete'
                                : s.options.find(o => o.id === s.analysis?.winnerId)?.name || (s.analysis?.isTie ? 'Tie' : 'None')
                            }</strong> &bull;{' '}
                            {s.criteria.length} criteria, {s.options.length} options &bull;{' '}
                            {new Date(s.createdAt).toLocaleString()}
                          </p>
                        </div>

                        <button
                          onClick={() => setSelectedSnapshot(selectedSnapshot?.snapshotId === s.snapshotId ? null : s)}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg border border-slate-700 transition"
                        >
                          {selectedSnapshot?.snapshotId === s.snapshotId ? 'Close' : 'View Snapshot'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Selected Snapshot Inspector */}
                {selectedSnapshot && (
                  <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-4 font-mono text-xs">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="font-bold text-white text-sm">
                        Snapshot v{selectedSnapshot.version} &bull; {selectedSnapshot.title}
                      </span>
                      <button
                        onClick={() => setSelectedSnapshot(null)}
                        className="text-slate-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-slate-300">
                      <div>
                        <span className="text-slate-500 block">Winner</span>
                        <strong className="text-emerald-400">
                          {(selectedSnapshot.analysis?.decisionOutcome as string) === 'invalid'
                            ? 'Invalid'
                            : (selectedSnapshot.analysis?.decisionOutcome as string) === 'incomplete'
                            ? 'Incomplete'
                            : selectedSnapshot.options.find(o => o.id === selectedSnapshot.analysis?.winnerId)?.name ||
                              (selectedSnapshot.analysis?.isTie ? 'Tie' : 'N/A')}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Score</span>
                        <strong>
                          {(() => {
                            const winnerId = selectedSnapshot.analysis?.winnerId;
                            if (!winnerId) return 'N/A';
                            const winnerEval = selectedSnapshot.analysis?.evaluations?.find(
                              e => e.optionId === winnerId
                            );
                            return winnerEval && typeof winnerEval.weightedScore === 'number'
                              ? winnerEval.weightedScore.toFixed(2)
                              : 'N/A';
                          })()}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Decision Outcome</span>
                        <span className="text-[11px] text-slate-400 capitalize">
                          {selectedSnapshot.analysis?.decisionOutcome || 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Engine Version</span>
                        <span className="text-[11px] text-slate-400">
                          {selectedSnapshot.analysis?.engineVersion || 'N/A'}
                        </span>
                      </div>
                    </div>

                    <div>
                      <span className="text-slate-500 block mb-1">Rankings:</span>
                      <div className="space-y-1">
                        {selectedSnapshot.analysis?.evaluations?.map(r => (
                          <div
                            key={r.optionId}
                            className="flex justify-between p-1.5 bg-slate-900 rounded border border-slate-800"
                          >
                            <span>
                              {r.rank !== null && r.rank !== undefined ? `#${r.rank}` : 'Unranked'} {r.optionName}
                            </span>
                            <span className="text-slate-400">{r.weightedScore.toFixed(2)} pts</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: EXPORT CENTER */}
            {activeTab === 'export' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-white">Export Decision Package</h3>
                  <p className="text-xs text-slate-400">
                    Generate portable, tamper-evident files containing authoritative calculations, criteria, options, and audit proofs.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* JSON Export Card */}
                  <div className="p-5 bg-slate-950/40 border border-slate-800 rounded-xl space-y-4 flex flex-col justify-between hover:border-slate-700 transition">
                    <div className="space-y-2">
                      <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-lg w-fit">
                        <FileCode className="w-5 h-5" />
                      </div>
                      <h4 className="text-sm font-semibold text-white">Full JSON Package</h4>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Complete machine-readable JSON representation. Contains decision criteria, options, score matrices, canonical engine results with cryptographic specification hashes, evidence provenance, and verified audit proofs.
                      </p>
                    </div>

                    <button
                      onClick={() => handleExportDownload('json')}
                      disabled={isExporting !== null}
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg flex items-center justify-center space-x-1.5 transition disabled:opacity-50"
                    >
                      {isExporting === 'json' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>Download JSON</span>
                    </button>
                  </div>

                  {/* CSV Export Card */}
                  <div className="p-5 bg-slate-950/40 border border-slate-800 rounded-xl space-y-4 flex flex-col justify-between hover:border-slate-700 transition">
                    <div className="space-y-2">
                      <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-lg w-fit">
                        <FileSpreadsheet className="w-5 h-5" />
                      </div>
                      <h4 className="text-sm font-semibold text-white">Spreadsheet CSV Matrix</h4>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Multi-section RFC 4180 CSV export. Features criteria weights, score matrices, final MCDA scores, and sensitivity tipping points. Protected against spreadsheet formula injection attacks.
                      </p>
                    </div>

                    <button
                      onClick={() => handleExportDownload('csv')}
                      disabled={isExporting !== null}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg flex items-center justify-center space-x-1.5 transition disabled:opacity-50"
                    >
                      {isExporting === 'csv' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>Download CSV</span>
                    </button>
                  </div>

                  {/* HTML Printable Briefing */}
                  <div className="p-5 bg-slate-950/40 border border-slate-800 rounded-xl space-y-4 flex flex-col justify-between hover:border-slate-700 transition">
                    <div className="space-y-2">
                      <div className="p-2.5 bg-cyan-500/10 text-cyan-400 rounded-lg w-fit">
                        <FileText className="w-5 h-5" />
                      </div>
                      <h4 className="text-sm font-semibold text-white">Printable Briefing (HTML)</h4>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Clean, standalone executive briefing formatted for browser display or printing to PDF. Features winner highlights, ranking tables, assigned weights, and hash chain verification proofs.
                      </p>
                    </div>

                    <button
                      onClick={() => handleExportDownload('html')}
                      disabled={isExporting !== null}
                      className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium rounded-lg flex items-center justify-center space-x-1.5 transition disabled:opacity-50"
                    >
                      {isExporting === 'html' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>Download HTML</span>
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-400 space-y-1">
                  <div className="flex items-center space-x-1.5 text-slate-300 font-medium">
                    <ShieldCheck className="w-4 h-4 text-indigo-400" />
                    <span>Security & Reproducibility Notice</span>
                  </div>
                  <p>
                    Exports reflect authoritative server calculations at the time of export. Unsubmitted contributor drafts and sensitive credentials are never exported.
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

