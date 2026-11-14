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

  // Helper for color-coding action categories
  const getActionBadgeClass = (action: string) => {
    if (action.startsWith('criteria.') || action === 'criteria.weight_updated') {
      return 'bg-sky-500/10 text-sky-400 border-sky-500/20';
    }
    if (action.startsWith('option.')) {
      return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
    }
    if (action.startsWith('score.') || action.includes('synthetic')) {
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    }
    if (action.startsWith('contribution.')) {
      return 'bg-teal-500/10 text-teal-400 border-teal-500/20';
    }
    if (action.startsWith('ai.')) {
      return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
    }
    if (action.startsWith('evidence.')) {
      return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    }
    if (action.startsWith('sharing.')) {
      return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
    }
    if (action.startsWith('snapshot.')) {
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    }
    if (action.startsWith('export.')) {
      return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
    return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
  };

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

  // Keyboard navigation: Escape key closes audit export modal
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
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-export-title"
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl">
                <History className="w-5 h-5" />
              </div>
              <div>
                <h2 id="audit-export-title" className="text-lg font-semibold text-white">Decision Audit, History & Export</h2>
                <p className="text-xs text-slate-400">
                  {decision?.title || 'Decision'} &bull; Tamper-evident event timeline & portable briefings
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={fetchAuditData}
                disabled={isLoading}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
                title="Refresh history"
                aria-label="Refresh audit history"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div
            role="tablist"
            aria-label="Audit views"
            className="flex border-b border-slate-800 bg-slate-950/50 px-6 gap-6 text-sm overflow-x-auto scrollbar-none"
          >
            <button
              role="tab"
              aria-selected={activeTab === 'history'}
              onClick={() => setActiveTab('history')}
              className={`py-3 font-medium border-b-2 flex items-center space-x-2 transition cursor-pointer whitespace-nowrap focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none ${
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
              role="tab"
              aria-selected={activeTab === 'snapshots'}
              onClick={() => setActiveTab('snapshots')}
              className={`py-3 font-medium border-b-2 flex items-center space-x-2 transition cursor-pointer whitespace-nowrap focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none ${
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
              role="tab"
              aria-selected={activeTab === 'export'}
              onClick={() => setActiveTab('export')}
              className={`py-3 font-medium border-b-2 flex items-center space-x-2 transition cursor-pointer whitespace-nowrap focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none ${
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
                <div
                  className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    chainResult?.isValid
                      ? 'bg-slate-950/60 border-slate-800'
                      : 'bg-rose-500/10 border-rose-500/30'
                  }`}
                >
                  <div className="flex items-start sm:items-center space-x-3">
                    <div
                      className={`p-2 rounded-lg ${
                        chainResult?.isValid
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">
                          SHA-256 Hash Chain Integrity
                        </span>
                        {chainResult?.isValid ? (
                          <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Chain Verified (100% Intact)</span>
                          </span>
                        ) : (
                          <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-medium flex items-center gap-1">
                            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                            <span>Chain Integrity Violation</span>
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        {chainResult?.totalEventsChecked || 0} events cryptographically linked &bull;
                        Head:{' '}
                        <code className="text-indigo-400">
                          {chainResult?.headHash ? chainResult.headHash.slice(0, 16) + '...' : 'Genesis'}
                        </code>
                        {chainResult?.verifiedAt && (
                          <span className="text-[11px] text-slate-500 ml-2">
                            Verified at {new Date(chainResult.verifiedAt).toLocaleTimeString()}
                          </span>
                        )}
                      </p>
                      {chainResult && !chainResult.isValid && (
                        <div className="mt-2 text-xs text-rose-300 font-mono bg-rose-950/70 p-2.5 rounded-lg border border-rose-800/80 space-y-1">
                          <div><strong>Integrity Error:</strong> {chainResult.reason || 'Cryptographic hash linkage mismatch detected'}</div>
                          {chainResult.brokenAtEventId && (
                            <div><strong>Compromised Event ID:</strong> <code>{chainResult.brokenAtEventId}</code></div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={handleVerifyChain}
                    disabled={isVerifyingChain}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg flex items-center space-x-1.5 transition border border-slate-700 disabled:opacity-50 shrink-0 self-start sm:self-auto cursor-pointer"
                  >
                    {isVerifyingChain ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>Re-verify Now</span>
                  </button>
                </div>

                {/* Filter Controls */}
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {[
                      { key: 'all', label: 'All Events' },
                      { key: 'decision', label: 'Decision' },
                      { key: 'criteria', label: 'Criteria & Weights' },
                      { key: 'option', label: 'Alternatives' },
                      { key: 'score', label: 'Scores' },
                      { key: 'sharing', label: 'Roles & Invites' },
                      { key: 'contribution', label: 'Contributions' },
                      { key: 'ai', label: 'AI Advisory' },
                      { key: 'evidence', label: 'Evidence' },
                      { key: 'snapshot', label: 'Milestones' },
                      { key: 'export', label: 'Exports' },
                    ].map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => {
                          setActionFilter(key);
                          setPage(1);
                        }}
                        className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                          actionFilter === key
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
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
                      const isCompromised = Boolean(chainResult && !chainResult.isValid && chainResult.brokenAtEventId === event.eventId);
                      const seqNum = event.sequenceNumber !== undefined ? `#${String(event.sequenceNumber).padStart(3, '0')}` : '#---';

                      return (
                        <div
                          key={event.eventId}
                          className={`p-3.5 rounded-xl border transition space-y-2 ${
                            isCompromised
                              ? 'bg-rose-500/10 border-rose-500/40'
                              : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap">
                            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                {seqNum}
                              </span>
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${getActionBadgeClass(event.action)}`}>
                                {event.action}
                              </span>
                              {isCompromised && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                  COMPROMISED EVENT
                                </span>
                              )}
                              <span className="text-xs font-medium text-slate-200">{event.summary}</span>
                            </div>
                            <span className="text-[11px] text-slate-500 whitespace-nowrap font-mono shrink-0">
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

                            <button
                              onClick={() => setExpandedEventId(isExpanded ? null : event.eventId)}
                              className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-0.5 cursor-pointer"
                            >
                              <span>{isExpanded ? 'Hide details' : 'View details'}</span>
                              <ChevronRight
                                className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                              />
                            </button>
                          </div>

                          {isExpanded && (
                            <div className="mt-2 p-3 bg-slate-900 border border-slate-800 rounded-lg text-xs space-y-2 font-mono">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                                <div>
                                  <span className="text-slate-500">Sequence:</span>{' '}
                                  <strong className="text-slate-200">{event.sequenceNumber || 1}</strong>
                                </div>
                                <div>
                                  <span className="text-slate-500">Entity:</span>{' '}
                                  <span className="text-slate-300">{event.entityType} ({event.entityId})</span>
                                </div>
                              </div>
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
                                  <span className="text-slate-500 block mb-1">State Diff / Change Details:</span>
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

                {/* 11 Guaranteed Export Package Components Checklist */}
                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>11 Guaranteed Export Components (JSON • CSV • HTML)</span>
                    </span>
                    <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                      Complete Audit Coverage
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
                    {[
                      { num: '01', title: 'Decision Metadata', desc: 'Title, scope, methodology & timestamps' },
                      { num: '02', title: 'Alternatives', desc: 'Candidate options & descriptions' },
                      { num: '03', title: 'Criteria & Weights', desc: 'Directions, locked status & normalized weights' },
                      { num: '04', title: 'Score Matrix', desc: 'Option scores across every criterion' },
                      { num: '05', title: 'Final Rankings', desc: 'Authoritative MCDA utility & ranks' },
                      { num: '06', title: 'Sensitivity Findings', desc: 'Tipping points & flip boundaries' },
                      { num: '07', title: 'Expert Contributions', desc: 'Multi-stakeholder weight inputs' },
                      { num: '08', title: 'Advisory Suggestions', desc: 'Clearly labeled non-authoritative (Rule #14)' },
                      { num: '09', title: 'Evidence References', desc: 'Citations (unverified) & missing gaps' },
                      { num: '10', title: 'Audit History', desc: 'Full chronological mutation timeline' },
                      { num: '11', title: 'Integrity Verification', desc: 'SHA-256 hash chaining result & Merkle head' },
                    ].map(item => (
                      <div
                        key={item.num}
                        className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-start gap-2"
                      >
                        <span className="text-[10px] font-mono font-bold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">
                          {item.num}
                        </span>
                        <div>
                          <div className="font-semibold text-slate-200 text-[11px]">{item.title}</div>
                          <div className="text-[10px] text-slate-400 leading-tight">{item.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-400 space-y-1">
                  <div className="flex items-center space-x-1.5 text-slate-300 font-medium">
                    <ShieldCheck className="w-4 h-4 text-indigo-400" />
                    <span>Security & Reproducibility Notice</span>
                  </div>
                  <p>
                    Exports reflect authoritative server calculations at the time of export. Unsubmitted contributor drafts and sensitive credentials are never exported. Spreadsheet exports apply formula injection sanitization to all cell values.
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

