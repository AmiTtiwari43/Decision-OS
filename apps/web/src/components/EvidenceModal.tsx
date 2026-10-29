import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  FileText,
  ExternalLink,
  BookOpen,
  Quote,
  Trash2,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Filter,
} from 'lucide-react';
import {
  apiClient,
  ApiClientError,
  type DecisionDto,
  type DecisionEvidenceDto,
  type EvidenceTargetType,
  type EvidenceType,
} from '../api/index.js';

export interface EvidenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  decision: DecisionDto | null;
}

type Tab = 'browse' | 'create';

export const EvidenceModal: React.FC<EvidenceModalProps> = ({
  isOpen,
  onClose,
  decision,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('browse');
  const [filterTargetType, setFilterTargetType] = useState<string>('all');

  // Role permissions
  const currentUserRole = decision?.currentUserRole || 'owner';
  const isViewer = currentUserRole === 'viewer';
  const isOwner = currentUserRole === 'owner';

  // Items State
  const [evidenceList, setEvidenceList] = useState<DecisionEvidenceDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Form State
  const [targetType, setTargetType] = useState<EvidenceTargetType>('option');
  const [targetId, setTargetId] = useState<string>('');
  const [evidenceType, setEvidenceType] = useState<EvidenceType>('url');
  const [title, setTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [documentReference, setDocumentReference] = useState('');
  const [sourceExcerpt, setSourceExcerpt] = useState('');
  const [userSummary, setUserSummary] = useState('');
  const [publicationDate, setPublicationDate] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Fetch Evidence List
  const fetchEvidence = useCallback(async () => {
    if (!decision?._id) return;
    setIsLoading(true);
    setListError(null);
    try {
      const res = await apiClient.listEvidence(decision._id);
      setEvidenceList(res.items || []);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setListError(err.message);
      } else {
        setListError('Failed to load evidence records.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [decision]);

  useEffect(() => {
    if (isOpen && decision?._id) {
      fetchEvidence();
      if (decision.options && decision.options.length > 0) {
        setTargetId(decision.options[0].id);
      }
    }
  }, [isOpen, decision, fetchEvidence]);

  // Handle Target Type Change
  const handleTargetTypeChange = (type: EvidenceTargetType) => {
    setTargetType(type);
    if (type === 'decision') {
      setTargetId('decision');
    } else if (type === 'option') {
      setTargetId(decision?.options?.[0]?.id || '');
    } else if (type === 'criterion') {
      setTargetId(decision?.criteria?.[0]?.id || '');
    } else {
      setTargetId('');
    }
  };

  // Submit Evidence
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decision?._id) return;
    setFormError(null);
    setFormSuccess(null);

    if (!title.trim()) {
      setFormError('Title is required');
      return;
    }

    if (evidenceType === 'url') {
      if (!sourceUrl.trim()) {
        setFormError("A valid 'http://' or 'https://' sourceUrl is required for URL evidence");
        return;
      }
      try {
        const parsed = new URL(sourceUrl.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          setFormError("Source URL must start with 'http://' or 'https://'");
          return;
        }
      } catch {
        setFormError("Source URL must be a valid URL format starting with 'http://' or 'https://'");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await apiClient.createEvidence(decision._id, {
        targetType,
        targetId: targetId.trim(),
        type: evidenceType,
        title: title.trim(),
        sourceUrl: sourceUrl.trim() || null,
        documentReference: documentReference.trim() || null,
        sourceExcerpt: sourceExcerpt.trim() || null,
        userSummary: userSummary.trim() || null,
        publicationDate: publicationDate ? new Date(publicationDate).toISOString() : null,
      });

      setFormSuccess('Evidence attached successfully');
      setTitle('');
      setSourceUrl('');
      setDocumentReference('');
      setSourceExcerpt('');
      setUserSummary('');
      setPublicationDate('');
      await fetchEvidence();
      setActiveTab('browse');
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setFormError(err.message);
      } else {
        setFormError('Failed to attach evidence.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Evidence
  const handleDelete = async (evidenceId: string) => {
    if (!decision?._id) return;
    setDeletingId(evidenceId);
    try {
      await apiClient.deleteEvidence(decision._id, evidenceId);
      await fetchEvidence();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        alert(`Failed to delete evidence: ${err.message}`);
      } else {
        alert('Failed to delete evidence record.');
      }
    } finally {
      setDeletingId(null);
    }
  };

  // Target Filtered List
  const filteredList = evidenceList.filter((item) => {
    if (filterTargetType === 'all') return true;
    return item.targetType === filterTargetType;
  });

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-10"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800 bg-slate-900/50 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl border border-blue-500/20">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  Evidence & Provenance
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                    Traceability
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  {decision?.title || 'Decision'} &bull; Traceable supporting material and citations
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center justify-between border-b border-slate-800 px-6 bg-slate-950/40">
            <div className="flex gap-2 py-2">
              <button
                onClick={() => setActiveTab('browse')}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition ${
                  activeTab === 'browse'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                Browse Evidence ({evidenceList.length})
              </button>

              {!isViewer && (
                <button
                  onClick={() => setActiveTab('create')}
                  className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition ${
                    activeTab === 'create'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Attach Supporting Material
                </button>
              )}
            </div>

            {/* Target Filter (Browse Tab) */}
            {activeTab === 'browse' && (
              <div className="flex items-center gap-1.5 py-2">
                <Filter className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-xs text-slate-400">Target:</span>
                <select
                  value={filterTargetType}
                  onChange={(e) => setFilterTargetType(e.target.value)}
                  className="bg-slate-800 border border-slate-700 text-xs rounded-md px-2 py-1 text-slate-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="all">All Targets</option>
                  <option value="decision">Decision Root</option>
                  <option value="option">Options</option>
                  <option value="criterion">Criteria</option>
                  <option value="contribution">Contributions</option>
                </select>
              </div>
            )}
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* System Transparency Banner */}
            <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/60 flex items-start gap-3">
              <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-400 leading-relaxed">
                <strong className="text-slate-200">Provenance Invariant:</strong> Attached URLs, citations,
                and quotes provide attribution and context for human evaluation. They do not alter authoritative
                MCDA mathematical rankings or imply automated third-party verification.
              </p>
            </div>

            {/* BROWSE TAB */}
            {activeTab === 'browse' && (
              <div className="space-y-4">
                {isLoading ? (
                  <div className="py-16 text-center text-slate-400 space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-500" />
                    <p className="text-xs">Loading evidence records...</p>
                  </div>
                ) : listError ? (
                  <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{listError}</span>
                  </div>
                ) : filteredList.length === 0 ? (
                  <div className="py-16 text-center text-slate-500 space-y-3 border border-dashed border-slate-800 rounded-xl">
                    <BookOpen className="w-8 h-8 text-slate-600 mx-auto" />
                    <p className="text-sm font-medium text-slate-400">No evidence attached yet</p>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      {isViewer
                        ? 'No supporting material has been attached to this decision.'
                        : 'Support your options, criteria, or recommendations with citations, benchmark reports, and source URLs.'}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {filteredList.map((item) => {
                      const itemKey = item._id || item.id;
                      const isDeleting = deletingId === itemKey;

                      // Resolve friendly target label
                      let targetLabel = item.targetType.toUpperCase();
                      if (item.targetType === 'option') {
                        const opt = decision?.options?.find((o) => o.id === item.targetId);
                        targetLabel = `Option: ${opt ? opt.name : item.targetId}`;
                      } else if (item.targetType === 'criterion') {
                        const crit = decision?.criteria?.find((c) => c.id === item.targetId);
                        targetLabel = `Criterion: ${crit ? crit.name : item.targetId}`;
                      } else if (item.targetType === 'decision') {
                        targetLabel = 'Decision Root';
                      } else if (item.targetType === 'contribution') {
                        targetLabel = `Contribution: ${item.targetId.slice(-6)}`;
                      }

                      return (
                        <div
                          key={itemKey}
                          className="p-5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 transition space-y-4"
                        >
                          {/* Card Header */}
                          <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                  {targetLabel}
                                </span>
                                <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-mono">
                                  {item.type.toUpperCase()}
                                </span>
                                {item.publicationDate && (
                                  <span className="text-[11px] text-slate-500">
                                    Published: {new Date(item.publicationDate).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                              <h3 className="text-base font-bold text-white pt-1">{item.title}</h3>
                            </div>

                            {/* Delete Action (Owner or Author only) */}
                            {isOwner && (
                              <button
                                onClick={() => handleDelete(itemKey)}
                                disabled={isDeleting}
                                className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                                title="Delete evidence"
                              >
                                {isDeleting ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </div>

                          {/* Source Material: Link or Citation */}
                          {item.sourceUrl && (
                            <div className="flex items-center gap-2 text-xs">
                              <ExternalLink className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                              <a
                                href={item.sourceUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-blue-400 hover:text-blue-300 underline underline-offset-2 break-all"
                              >
                                {item.sourceUrl}
                              </a>
                            </div>
                          )}

                          {item.documentReference && (
                            <div className="flex items-center gap-2 text-xs text-slate-300">
                              <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <span>Reference: <strong>{item.documentReference}</strong></span>
                            </div>
                          )}

                          {/* Verbatim Excerpt */}
                          {item.sourceExcerpt && (
                            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800/80 space-y-1">
                              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                                <Quote className="w-3 h-3 text-slate-500" />
                                Source Excerpt
                              </div>
                              <p className="text-xs text-slate-300 italic whitespace-pre-wrap pl-3 border-l-2 border-slate-700">
                                &ldquo;{item.sourceExcerpt}&rdquo;
                              </p>
                            </div>
                          )}

                          {/* User Interpretation / Summary */}
                          {item.userSummary && (
                            <div className="space-y-1">
                              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                                Contributor Interpretation & Relevance
                              </div>
                              <p className="text-xs text-slate-300 whitespace-pre-wrap">
                                {item.userSummary}
                              </p>
                            </div>
                          )}

                          {/* Provenance Footer */}
                          <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500">
                            <div>
                              Supplied by <strong className="text-slate-400">{item.provenance.createdByName}</strong> ({item.provenance.createdByEmail})
                            </div>
                            <div>
                              Captured via {item.provenance.capturedVia.replace('_', ' ')} &bull; {new Date(item.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* CREATE TAB */}
            {activeTab === 'create' && !isViewer && (
              <form onSubmit={handleCreate} className="space-y-5">
                {formError && (
                  <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                {formSuccess && (
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{formSuccess}</span>
                  </div>
                )}

                {/* Target Type & Target ID Pickers */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Attachment Target</label>
                    <select
                      value={targetType}
                      onChange={(e) => handleTargetTypeChange(e.target.value as EvidenceTargetType)}
                      className="w-full bg-slate-950 border border-slate-800 text-xs rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="option">Option (Specific candidate)</option>
                      <option value="criterion">Criterion (Dimension / Metric)</option>
                      <option value="decision">Decision Root (Overall)</option>
                      <option value="contribution">Expert Contribution</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Target Item</label>
                    {targetType === 'option' ? (
                      <select
                        value={targetId}
                        onChange={(e) => setTargetId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 text-xs rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500"
                      >
                        {decision?.options?.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name} ({o.id})
                          </option>
                        ))}
                      </select>
                    ) : targetType === 'criterion' ? (
                      <select
                        value={targetId}
                        onChange={(e) => setTargetId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 text-xs rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500"
                      >
                        {decision?.criteria?.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.id})
                          </option>
                        ))}
                      </select>
                    ) : targetType === 'decision' ? (
                      <input
                        type="text"
                        disabled
                        value="Attached to whole decision"
                        className="w-full bg-slate-950/50 border border-slate-800 text-xs rounded-xl p-2.5 text-slate-500 cursor-not-allowed"
                      />
                    ) : (
                      <input
                        type="text"
                        placeholder="Contribution MongoDB ObjectId"
                        value={targetId}
                        onChange={(e) => setTargetId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 text-xs rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500"
                      />
                    )}
                  </div>
                </div>

                {/* Evidence Type & Title */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Evidence Type</label>
                    <select
                      value={evidenceType}
                      onChange={(e) => setEvidenceType(e.target.value as EvidenceType)}
                      className="w-full bg-slate-950 border border-slate-800 text-xs rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="url">Web URL / Link</option>
                      <option value="document">Document Reference</option>
                      <option value="excerpt">Direct Quote / Excerpt</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2 space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Title / Descriptor</label>
                    <input
                      type="text"
                      placeholder="e.g. AWS Graviton4 Benchmark Report Q1"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                      className="w-full bg-slate-950 border border-slate-800 text-xs rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* URL or Document Citation Details */}
                {evidenceType === 'url' ? (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">
                      Source URL <span className="text-blue-400 font-mono">(http:// or https://)</span>
                    </label>
                    <input
                      type="url"
                      placeholder="https://example.com/reports/benchmark.pdf"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      required
                      className="w-full bg-slate-950 border border-slate-800 text-xs rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Document Reference / Citation</label>
                    <input
                      type="text"
                      placeholder="e.g. Gartner Magic Quadrant 2026, p. 44"
                      value={documentReference}
                      onChange={(e) => setDocumentReference(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 text-xs rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}

                {/* Verbatim Excerpt */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Source Excerpt <span className="text-slate-500">(Verbatim quote from source)</span>
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Exact excerpt or quantitative data point from the cited source..."
                    value={sourceExcerpt}
                    onChange={(e) => setSourceExcerpt(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-xs rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500 font-sans"
                  />
                </div>

                {/* User Interpretation / Summary */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Interpretation & Relevance <span className="text-slate-500">(How this relates to the decision)</span>
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Explain why this evidence supports or challenges the score/option..."
                    value={userSummary}
                    onChange={(e) => setUserSummary(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-xs rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500 font-sans"
                  />
                </div>

                {/* Publication Date */}
                <div className="space-y-1.5 max-w-xs">
                  <label className="text-xs font-semibold text-slate-300">Publication Date (Optional)</label>
                  <input
                    type="date"
                    value={publicationDate}
                    onChange={(e) => setPublicationDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-xs rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Submit Buttons */}
                <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab('browse')}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition disabled:opacity-50 shadow-lg shadow-blue-600/20"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Attaching...
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        Attach Evidence
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
