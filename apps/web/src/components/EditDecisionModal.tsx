import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Edit3, Loader2, AlertCircle, Save } from 'lucide-react';
import { apiClient, ApiClientError, type DecisionDto } from '../api/index.js';

export interface EditDecisionModalProps {
  isOpen: boolean;
  onClose: () => void;
  decision: DecisionDto | null;
  onUpdated: (updated: DecisionDto) => void;
}

export const EditDecisionModal: React.FC<EditDecisionModalProps> = ({
  isOpen,
  onClose,
  decision,
  onUpdated,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (decision) {
      setTitle(decision.title || '');
      setDescription(decision.description || '');
      setError(null);
    }
  }, [decision]);

  // Keyboard navigation: Escape key closes modal
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !decision) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.length < 3) {
      setError('Title must be at least 3 characters.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const updated = await apiClient.updateDecision(decision._id, {
        title: cleanTitle,
        description: description.trim(),
        expectedVersion: decision.version,
      });

      onUpdated(updated);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message || 'Failed to update decision metadata.');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-decision-title"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-lg max-h-[92vh] bg-surface border border-border rounded-2xl shadow-glow-card flex flex-col overflow-y-auto text-slate-100 my-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-border bg-surface-subtle/50 sticky top-0 bg-surface z-10">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-signal/15 border border-signal/30 flex items-center justify-center text-signal shrink-0">
                <Edit3 className="w-5 h-5" />
              </div>
              <div>
                <h2 id="edit-decision-title" className="text-base sm:text-lg font-bold text-white">Edit Decision Framing</h2>
                <p className="text-xs text-slate-400">Update title and contextual problem statement</p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-subtle transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none"
              title="Close modal"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
            {error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="edit-decision-title" className="block text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Decision Title <span className="text-signal">*</span>
              </label>
              <input
                id="edit-decision-title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface-card border border-border focus:border-signal text-sm text-white placeholder-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal transition-colors"
                maxLength={200}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label htmlFor="edit-decision-description" className="block text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Executive Problem Statement & Framing
              </label>
              <textarea
                id="edit-decision-description"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="State the core question, constraints, and criteria objectives..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface-card border border-border focus:border-signal text-xs text-white placeholder-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal transition-colors resize-none leading-relaxed"
                maxLength={1000}
                disabled={isSubmitting}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !title.trim()}
                className="px-5 py-2 rounded-xl bg-signal hover:bg-signal-light disabled:opacity-50 text-background font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-glow-signal-sm focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving Changes...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

