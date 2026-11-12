import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  MessageSquare,
  Send,
  CornerDownRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Edit2,
  Shield,
  User,
  Clock,
  Filter,
} from 'lucide-react';
import { apiClient, ApiClientError, type DecisionDto, type CommentDto } from '../api/index.js';
import { useAuth } from '../hooks/useAuth.js';
import { sound } from '../utils/audioFx.js';

export interface DeliberationModalProps {
  isOpen: boolean;
  onClose: () => void;
  decision: DecisionDto | null;
}

export const DeliberationModal: React.FC<DeliberationModalProps> = ({
  isOpen,
  onClose,
  decision,
}) => {
  const { user } = useAuth();
  const [comments, setComments] = useState<CommentDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [newCommentContent, setNewCommentContent] = useState<string>('');
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [filterResolved, setFilterResolved] = useState<'all' | 'open' | 'resolved'>('all');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const isOwnerOrEditor =
    decision?.currentUserRole === 'owner' || decision?.currentUserRole === 'editor';

  const fetchComments = useCallback(async () => {
    if (!decision?._id) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.getComments(decision._id);
      setComments(res.items || []);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to fetch deliberation comments.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [decision?._id]);

  useEffect(() => {
    if (isOpen && decision?._id) {
      fetchComments();
    }
  }, [isOpen, decision?._id, fetchComments]);

  const handleCreateRootComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentContent.trim() || !decision?._id || isSubmitting) return;

    setIsSubmitting(true);
    sound.playTick();
    try {
      const created = await apiClient.createComment(decision._id, {
        content: newCommentContent.trim(),
        targetType: 'decision',
        targetId: decision._id,
      });
      setComments((prev) => [...prev, created]);
      setNewCommentContent('');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to submit comment.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateReply = async (parentId: string) => {
    if (!replyContent.trim() || !decision?._id || isSubmitting) return;

    setIsSubmitting(true);
    sound.playTick();
    try {
      const created = await apiClient.createComment(decision._id, {
        content: replyContent.trim(),
        parentCommentId: parentId,
        targetType: 'decision',
        targetId: decision._id,
      });
      setComments((prev) =>
        prev.map((c) =>
          c.id === parentId ? { ...c, replyCount: (c.replyCount || 0) + 1 } : c
        ).concat(created)
      );
      setReplyContent('');
      setReplyingToId(null);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to submit reply.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleResolve = async (commentId: string, currentResolved: boolean) => {
    if (!decision?._id) return;
    sound.playTick();
    try {
      const updated = await apiClient.resolveComment(decision._id, commentId, !currentResolved);
      setComments((prev) => prev.map((c) => (c.id === commentId ? updated : c)));
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      }
    }
  };

  const handleSaveEdit = async (commentId: string) => {
    if (!editContent.trim() || !decision?._id) return;
    sound.playTick();
    try {
      const updated = await apiClient.updateComment(decision._id, commentId, {
        content: editContent.trim(),
      });
      setComments((prev) => prev.map((c) => (c.id === commentId ? updated : c)));
      setEditingId(null);
      setEditContent('');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      }
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!decision?._id) return;
    sound.playTick();
    try {
      const res = await apiClient.deleteComment(decision._id, commentId);
      if (res.tombstoned) {
        setComments((prev) =>
          prev.map((c) =>
            c.id === commentId ? { ...c, isDeleted: true, content: 'Comment deleted by author.' } : c
          )
        );
      } else {
        setComments((prev) => prev.filter((c) => c.id !== commentId));
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      }
    }
  };

  if (!isOpen) return null;

  const rootComments = comments.filter((c) => !c.parentCommentId);
  const replies = comments.filter((c) => Boolean(c.parentCommentId));

  const filteredRootComments = rootComments.filter((c) => {
    if (filterResolved === 'open') return !c.isResolved;
    if (filterResolved === 'resolved') return c.isResolved;
    return true;
  });

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-background/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-surface border border-border shadow-2xl overflow-hidden text-slate-100"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface-card">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-signal/10 border border-signal/30 text-signal">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Stakeholder Deliberation & Threaded Audit</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-surface border border-border text-slate-300">
                    {comments.length} entries
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  {decision?.title || 'Decision Discussion'} — Authoritative deliberative log
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-subtle transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Filter Bar */}
          <div className="flex items-center justify-between px-6 py-2.5 bg-surface/50 border-b border-border text-xs">
            <div className="flex items-center gap-2 text-slate-400">
              <Filter className="w-3.5 h-3.5" />
              <span>Status:</span>
              <button
                onClick={() => setFilterResolved('all')}
                className={`px-2 py-1 rounded-md transition-all ${
                  filterResolved === 'all'
                    ? 'bg-signal/20 text-signal font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All ({rootComments.length})
              </button>
              <button
                onClick={() => setFilterResolved('open')}
                className={`px-2 py-1 rounded-md transition-all ${
                  filterResolved === 'open'
                    ? 'bg-signal/20 text-signal font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Open ({rootComments.filter((c) => !c.isResolved).length})
              </button>
              <button
                onClick={() => setFilterResolved('resolved')}
                className={`px-2 py-1 rounded-md transition-all ${
                  filterResolved === 'resolved'
                    ? 'bg-emerald-500/20 text-emerald-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Resolved ({rootComments.filter((c) => c.isResolved).length})
              </button>
            </div>
            {decision?.isAudited && (
              <span className="flex items-center gap-1.5 text-[11px] text-signal font-mono">
                <Shield className="w-3 h-3" />
                <span>Audited Thread</span>
              </span>
            )}
          </div>

          {/* Scrollable Threads Container */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            {isLoading && (
              <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-signal" />
                <span className="text-sm font-mono">Loading deliberation records...</span>
              </div>
            )}

            {!isLoading && filteredRootComments.length === 0 && (
              <div className="text-center py-12 text-slate-500 space-y-2">
                <MessageSquare className="w-8 h-8 mx-auto opacity-30" />
                <p className="text-sm font-medium">No deliberation comments yet.</p>
                <p className="text-xs text-slate-400">
                  Pose a question, comment on criteria trade-offs, or challenge utility assumptions.
                </p>
              </div>
            )}

            {!isLoading &&
              filteredRootComments.map((root) => {
                const childReplies = replies.filter((r) => r.parentCommentId === root.id);
                const isAuthor = user?.id === root.authorId;

                return (
                  <div
                    key={root.id}
                    className={`p-4 rounded-xl border transition-all ${
                      root.isResolved
                        ? 'bg-surface/30 border-emerald-500/30'
                        : 'bg-surface-card border-border hover:border-border-subtle'
                    }`}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between text-xs mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-signal" />
                          <span>{root.isDeleted ? 'Redacted' : root.authorName}</span>
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-mono font-bold bg-surface border border-border text-slate-400">
                          {root.authorRole}
                        </span>
                        <span className="text-slate-500 text-[11px] flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{new Date(root.createdAt).toLocaleDateString()}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {root.isResolved ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Resolved</span>
                          </span>
                        ) : null}

                        {isOwnerOrEditor && (
                          <button
                            onClick={() => handleToggleResolve(root.id, root.isResolved)}
                            className="text-[11px] font-mono text-slate-400 hover:text-signal transition-colors cursor-pointer"
                          >
                            {root.isResolved ? 'Reopen Thread' : 'Resolve Thread'}
                          </button>
                        )}

                        {isAuthor && !root.isDeleted && (
                          <>
                            <button
                              onClick={() => {
                                setEditingId(root.id);
                                setEditContent(root.content);
                              }}
                              className="text-slate-400 hover:text-white"
                              title="Edit comment"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleDelete(root.id)}
                              className="text-slate-400 hover:text-rose-400"
                              title="Delete comment"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Content */}
                    {editingId === root.id ? (
                      <div className="space-y-2 mt-2">
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full p-2.5 text-xs bg-surface border border-signal/40 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-signal"
                          rows={2}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2.5 py-1 text-xs text-slate-400 hover:text-white"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveEdit(root.id)}
                            className="px-3 py-1 text-xs font-semibold rounded bg-signal text-slate-950 hover:bg-signal-hover"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p
                        className={`text-xs leading-relaxed ${
                          root.isDeleted
                            ? 'text-slate-500 italic'
                            : 'text-slate-200'
                        }`}
                      >
                        {root.content}
                      </p>
                    )}

                    {/* Replies */}
                    {childReplies.length > 0 && (
                      <div className="mt-3 pl-4 border-l-2 border-border-subtle space-y-2">
                        {childReplies.map((reply) => {
                          const isReplyAuthor = user?.id === reply.authorId;
                          return (
                            <div
                              key={reply.id}
                              className="p-2.5 rounded-lg bg-surface/40 border border-border-subtle text-xs"
                            >
                              <div className="flex items-center justify-between text-[11px] mb-1">
                                <div className="flex items-center gap-1.5">
                                  <CornerDownRight className="w-3 h-3 text-signal" />
                                  <span className="font-semibold text-slate-200">
                                    {reply.isDeleted ? 'Redacted' : reply.authorName}
                                  </span>
                                  <span className="text-slate-500 font-mono text-[10px]">
                                    ({reply.authorRole})
                                  </span>
                                </div>
                                {isReplyAuthor && !reply.isDeleted && (
                                  <button
                                    onClick={() => handleDelete(reply.id)}
                                    className="text-slate-400 hover:text-rose-400"
                                    title="Delete reply"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                              <p
                                className={`text-xs ${
                                  reply.isDeleted ? 'text-slate-500 italic' : 'text-slate-300'
                                }`}
                              >
                                {reply.content}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Reply Input */}
                    {replyingToId === root.id ? (
                      <div className="mt-3 pl-4 border-l-2 border-signal/40 space-y-2">
                        <textarea
                          value={replyContent}
                          onChange={(e) => setReplyContent(e.target.value)}
                          placeholder="Write your reply..."
                          className="w-full p-2 text-xs bg-surface border border-border rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-signal"
                          rows={2}
                          autoFocus
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setReplyingToId(null);
                              setReplyContent('');
                            }}
                            className="px-2.5 py-1 text-xs text-slate-400 hover:text-white"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleCreateReply(root.id)}
                            disabled={!replyContent.trim() || isSubmitting}
                            className="px-3 py-1 text-xs font-semibold rounded bg-signal text-slate-950 hover:bg-signal-hover disabled:opacity-50"
                          >
                            Reply
                          </button>
                        </div>
                      </div>
                    ) : (
                      !root.isResolved && (
                        <div className="mt-2 text-right">
                          <button
                            onClick={() => {
                              setReplyingToId(root.id);
                              setReplyContent('');
                            }}
                            className="text-[11px] font-mono text-slate-400 hover:text-signal transition-colors inline-flex items-center gap-1 cursor-pointer"
                          >
                            <CornerDownRight className="w-3 h-3" />
                            <span>Reply to thread</span>
                          </button>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
          </div>

          {/* Bottom Root Comment Form */}
          <form
            onSubmit={handleCreateRootComment}
            className="p-4 border-t border-border bg-surface-card flex items-center gap-3"
          >
            <input
              type="text"
              value={newCommentContent}
              onChange={(e) => setNewCommentContent(e.target.value)}
              placeholder="Start a new deliberation thread or challenge a metric..."
              className="flex-1 px-4 py-2.5 text-xs bg-surface border border-border rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-signal"
            />
            <button
              type="submit"
              disabled={!newCommentContent.trim() || isSubmitting}
              className="px-4 py-2.5 rounded-xl bg-signal hover:bg-signal-hover text-slate-950 font-semibold text-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-glow-signal-sm"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Post</span>
                </>
              )}
            </button>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
