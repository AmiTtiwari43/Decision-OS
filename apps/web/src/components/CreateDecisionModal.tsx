import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Plus,
  Loader2,
  AlertCircle,
  FileSpreadsheet,
  Briefcase,
  MapPin,
  Code2,
  Sparkles,
} from 'lucide-react';
import { apiClient, ApiClientError, type DecisionDto, type CreateDecisionPayload } from '../api/index.js';
import { templateDatasets } from '../data/decisionData.js';

export interface CreateDecisionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (newDecision: DecisionDto, openInStudio: boolean) => void;
}

export const CreateDecisionModal: React.FC<CreateDecisionModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('blank');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [openImmediately, setOpenImmediately] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setError(null);

    if (templateId === 'blank') {
      setTitle('');
      setDescription('');
      return;
    }

    const tpl = templateDatasets.find((t) => t.id === templateId);
    if (tpl) {
      setTitle(tpl.title);
      setDescription(tpl.context || tpl.question);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.length < 3) {
      setError('Decision title must be at least 3 characters.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      let payload: CreateDecisionPayload;

      if (selectedTemplateId === 'blank') {
        payload = {
          title: cleanTitle,
          description: description.trim() || undefined,
          criteria: [
            {
              id: 'c1',
              name: 'Core Strategic Impact',
              shortName: 'Impact',
              weight: 50,
              direction: 'benefit',
            },
            {
              id: 'c2',
              name: 'Resource Efficiency & Cost',
              shortName: 'Cost',
              weight: 50,
              direction: 'cost',
            },
          ],
          options: [
            {
              id: 'opt1',
              name: 'Option Alpha (Aggressive)',
              tagline: 'High potential reward with higher initial friction',
              description: 'Focus on strategic leap and velocity.',
              color: '#38BDF8',
            },
            {
              id: 'opt2',
              name: 'Option Beta (Pragmatic)',
              tagline: 'Balanced execution with proven stability',
              description: 'Focus on risk minimization and predictability.',
              color: '#B8FF5A',
            },
          ],
          scores: {
            opt1: { c1: 85, c2: 40 },
            opt2: { c1: 65, c2: 80 },
          },
        };
      } else {
        const tpl = templateDatasets.find((t) => t.id === selectedTemplateId);
        if (!tpl) {
          throw new Error('Selected template not found.');
        }

        payload = {
          title: cleanTitle,
          description: description.trim() || tpl.context || tpl.question,
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
      }

      const created = await apiClient.createDecision(payload);
      onCreated(created, openImmediately);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message || 'Failed to create decision.');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred while creating the decision.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const templateIcons: Record<string, React.ReactNode> = {
    'job-offer': <Briefcase className="w-4 h-4 text-signal" />,
    'city-relocation': <MapPin className="w-4 h-4 text-sky-400" />,
    'frontend-architecture': <Code2 className="w-4 h-4 text-emerald-400" />,
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-xl bg-surface border border-border rounded-2xl shadow-glow-card flex flex-col overflow-hidden text-slate-100 my-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-border bg-surface-subtle/50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-signal/15 border border-signal/30 flex items-center justify-center text-signal">
                <Plus className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white">Create New Decision</h2>
                <p className="text-xs text-slate-400">Initialize a structured multi-criteria decision framework</p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-subtle transition-colors cursor-pointer"
              title="Close modal"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-5">
            {error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            {/* Template Selection */}
            <div>
              <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Starting Blueprint
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectTemplate('blank')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                    selectedTemplateId === 'blank'
                      ? 'bg-signal/10 border-signal text-white shadow-glow-signal-sm'
                      : 'bg-surface-card border-border hover:border-slate-600 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <FileSpreadsheet className="w-3.5 h-3.5 text-signal" />
                      Custom Setup
                    </span>
                    {selectedTemplateId === 'blank' && (
                      <span className="w-2 h-2 rounded-full bg-signal" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Standard 2-alternative balance matrix ready for customization
                  </p>
                </button>

                {templateDatasets.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => handleSelectTemplate(tpl.id)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                      selectedTemplateId === tpl.id
                        ? 'bg-signal/10 border-signal text-white shadow-glow-signal-sm'
                        : 'bg-surface-card border-border hover:border-slate-600 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5 truncate">
                        {templateIcons[tpl.id] || <Sparkles className="w-3.5 h-3.5 text-signal" />}
                        <span className="truncate">{tpl.title.split(':')[0]}</span>
                      </span>
                      {selectedTemplateId === tpl.id && (
                        <span className="w-2 h-2 rounded-full bg-signal" />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug line-clamp-2">
                      {tpl.options.length} options · {tpl.criteria.length} criteria
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Decision Title */}
            <div>
              <label htmlFor="decision-title" className="block text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Decision Title <span className="text-signal">*</span>
              </label>
              <input
                id="decision-title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Q3 Cloud Architecture Standardization"
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface-card border border-border focus:border-signal text-sm text-white placeholder-slate-500 focus:outline-none transition-colors"
                maxLength={200}
                disabled={isSubmitting}
              />
            </div>

            {/* Description / Framing */}
            <div>
              <label htmlFor="decision-description" className="block text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Executive Framing & Context <span className="text-slate-500 font-normal lowercase">(optional)</span>
              </label>
              <textarea
                id="decision-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the trade-offs, constraints, timeline, and decision owner objectives..."
                className="w-full px-3.5 py-2 rounded-xl bg-surface-card border border-border focus:border-signal text-xs text-white placeholder-slate-500 focus:outline-none transition-colors resize-none leading-relaxed"
                maxLength={1000}
                disabled={isSubmitting}
              />
            </div>

            {/* Post-creation Behavior */}
            <div className="flex items-center gap-2.5 pt-1">
              <input
                id="open-immediately"
                type="checkbox"
                checked={openImmediately}
                onChange={(e) => setOpenImmediately(e.target.checked)}
                className="w-4 h-4 rounded border-border text-signal focus:ring-signal/40 bg-surface-card cursor-pointer"
                disabled={isSubmitting}
              />
              <label htmlFor="open-immediately" className="text-xs text-slate-300 cursor-pointer select-none">
                Open in Decision Studio immediately after creation
              </label>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !title.trim()}
                className="px-5 py-2 rounded-xl bg-signal hover:bg-signal-light disabled:opacity-50 text-background font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-glow-signal-sm"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Creating Decision...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Decision</span>
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

