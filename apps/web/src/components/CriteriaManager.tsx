import React, { useState } from 'react';
import { Plus, Trash2, Edit3, X, Check, Lock, Unlock, AlertCircle, ShieldAlert } from 'lucide-react';
import type { Criterion } from '../types/decision.js';

interface CriteriaManagerProps {
  criteria: Criterion[];
  weights: Record<string, number>;
  lockedIds: string[];
  currentUserRole?: 'owner' | 'editor' | 'viewer' | 'contributor';
  onAddCriterion: (
    name: string,
    category?: Criterion['category'],
    initialWeight?: number,
    shortName?: string,
    description?: string
  ) => Criterion;
  onRenameCriterion: (criterionId: string, newName: string) => void;
  onUpdateCriterion: (
    criterionId: string,
    updates: {
      name?: string;
      shortName?: string;
      description?: string;
      category?: Criterion['category'];
    }
  ) => void;
  onRemoveCriterion: (criterionId: string) => void;
  onToggleLock: (criterionId: string) => void;
  disabled?: boolean;
}

const CATEGORIES: { id: Criterion['category']; label: string; badgeClass: string }[] = [
  { id: 'growth', label: 'Growth', badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  { id: 'finance', label: 'Finance', badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  { id: 'lifestyle', label: 'Lifestyle', badgeClass: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  { id: 'risk', label: 'Risk', badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  { id: 'execution', label: 'Execution', badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
];

export const CriteriaManager: React.FC<CriteriaManagerProps> = ({
  criteria,
  weights,
  lockedIds,
  currentUserRole = 'owner',
  onAddCriterion,
  onRenameCriterion,
  onUpdateCriterion,
  onRemoveCriterion,
  onToggleLock,
  disabled = false,
}) => {
  const isReadOnly = currentUserRole === 'viewer' || currentUserRole === 'contributor' || Boolean(disabled);

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newShortName, setNewShortName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState<Criterion['category']>('growth');
  const [newWeight, setNewWeight] = useState<number>(20);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editShortName, setEditShortName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState<Criterion['category']>('growth');
  const [editError, setEditError] = useState<string | null>(null);

  // Deletion confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleStartAdd = () => {
    setNewName('');
    setNewShortName('');
    setNewDescription('');
    setNewCategory('growth');
    setNewWeight(20);
    setAddError(null);
    setIsAdding(true);
  };

  const handleSubmitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    const trimmed = newName.trim();
    if (!trimmed) {
      setAddError('Criterion name is required.');
      return;
    }
    if (criteria.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      setAddError(`A criterion named "${trimmed}" already exists.`);
      return;
    }

    try {
      onAddCriterion(
        trimmed,
        newCategory,
        newWeight,
        newShortName.trim() || trimmed,
        newDescription.trim()
      );
      setIsAdding(false);
      setNewName('');
      setNewShortName('');
      setNewDescription('');
    } catch (err) {
      setAddError((err as Error).message || 'Failed to add criterion.');
    }
  };

  const handleStartEdit = (crit: Criterion) => {
    setEditingId(crit.id);
    setEditName(crit.name);
    setEditShortName(crit.shortName || crit.name);
    setEditDescription(crit.description || '');
    setEditCategory(crit.category || 'growth');
    setEditError(null);
  };

  const handleSubmitEdit = (criterionId: string) => {
    setEditError(null);
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError('Criterion name is required.');
      return;
    }
    if (
      criteria.some(
        (c) => c.id !== criterionId && c.name.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      setEditError(`A criterion named "${trimmed}" already exists.`);
      return;
    }

    try {
      const currentCrit = criteria.find((c) => c.id === criterionId);
      const isOnlyNameChange =
        currentCrit &&
        currentCrit.name !== trimmed &&
        currentCrit.shortName === (editShortName.trim() || trimmed) &&
        currentCrit.description === editDescription.trim() &&
        currentCrit.category === editCategory;

      if (isOnlyNameChange) {
        onRenameCriterion(criterionId, trimmed);
      } else {
        onUpdateCriterion(criterionId, {
          name: trimmed,
          shortName: editShortName.trim() || trimmed,
          description: editDescription.trim(),
          category: editCategory,
        });
      }
      setEditingId(null);
    } catch (err) {
      setEditError((err as Error).message || 'Failed to update criterion.');
    }
  };

  const handleConfirmDelete = (criterionId: string) => {
    onRemoveCriterion(criterionId);
    setConfirmDeleteId(null);
  };

  const getCategoryBadge = (cat?: Criterion['category']) => {
    const found = CATEGORIES.find((c) => c.id === cat) || CATEGORIES[0];
    return (
      <span
        className={`px-1.5 py-0.5 rounded text-[10px] font-mono border uppercase tracking-wider ${found.badgeClass}`}
      >
        {found.label}
      </span>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-300 font-bold uppercase tracking-wider">
            Evaluation Criteria ({criteria.length})
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-signal/10 text-signal border border-signal/20">
            Benefit Only (v1.0)
          </span>
        </div>

        {!isReadOnly && !isAdding && (
          <button
            onClick={handleStartAdd}
            className="px-2.5 py-1 rounded-lg text-xs font-mono font-semibold bg-surface hover:bg-surface-subtle border border-signal/40 text-signal hover:shadow-glow-signal-sm flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Criterion</span>
          </button>
        )}
      </div>

      {/* Add Criterion Inline Form */}
      {isAdding && (
        <form
          onSubmit={handleSubmitAdd}
          className="p-3.5 rounded-xl bg-surface border border-signal/40 shadow-glow-signal-sm space-y-3 text-xs"
        >
          <div className="flex items-center justify-between font-mono font-bold text-signal text-[11px] uppercase">
            <span>New Evaluation Criterion</span>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="p-1 rounded text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Total Compensation, Latency"
                className="w-full px-2.5 py-1.5 rounded-lg bg-surface-card border border-border text-white focus:outline-none focus:border-signal text-xs"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                Short Name / Column Header
              </label>
              <input
                type="text"
                value={newShortName}
                onChange={(e) => setNewShortName(e.target.value)}
                placeholder="e.g. Comp, Latency"
                className="w-full px-2.5 py-1.5 rounded-lg bg-surface-card border border-border text-slate-300 focus:outline-none focus:border-signal text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                Category
              </label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as Criterion['category'])}
                className="w-full px-2.5 py-1.5 rounded-lg bg-surface-card border border-border text-white focus:outline-none focus:border-signal text-xs font-mono"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                Initial Raw Weight (Target)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={newWeight}
                onChange={(e) => setNewWeight(Math.max(0, Math.min(100, Number(e.target.value))))}
                className="w-full px-2.5 py-1.5 rounded-lg bg-surface-card border border-border text-white focus:outline-none focus:border-signal text-xs font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
              Description / Evaluation Rule
            </label>
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="How utility scores are assigned (0 = min, 100 = max)..."
              className="w-full px-2.5 py-1.5 rounded-lg bg-surface-card border border-border text-slate-300 focus:outline-none focus:border-signal text-xs"
            />
          </div>

          <div className="p-2 rounded bg-surface-card border border-border-subtle text-[11px] text-slate-400 font-mono">
            ℹ️ Canonical Engine v1.0 specifies benefit criteria: higher scores indicate superior utility. Cost metrics must be pre-transformed before entry.
          </div>

          {addError && (
            <div className="flex items-center gap-1.5 text-accent-rose text-xs font-mono">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{addError}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1 border-t border-border-subtle">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-3 py-1.5 rounded-lg bg-surface-subtle text-slate-400 hover:text-white font-mono text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-lg bg-signal hover:bg-signal-light text-background font-mono font-bold text-xs shadow-glow-signal-sm cursor-pointer"
            >
              Add Criterion
            </button>
          </div>
        </form>
      )}

      {/* Criteria List */}
      <div className="space-y-2">
        {criteria.map((crit) => {
          const isLocked = lockedIds.includes(crit.id);
          const normalizedWeight = weights[crit.id] ?? 0;

          return (
            <div
              key={crit.id}
              className={`p-3 rounded-xl border transition-colors ${
                isLocked
                  ? 'bg-amber-500/5 border-amber-500/30'
                  : 'bg-surface/70 border-border hover:border-slate-600'
              }`}
            >
              {editingId === crit.id ? (
                // Edit Mode
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-0.5">
                        Name
                      </label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-2 py-1 rounded bg-surface-card border border-signal/60 text-white font-bold text-xs"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-0.5">
                        Short Name
                      </label>
                      <input
                        type="text"
                        value={editShortName}
                        onChange={(e) => setEditShortName(e.target.value)}
                        className="w-full px-2 py-1 rounded bg-surface-card border border-border text-slate-300 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-0.5">
                        Category
                      </label>
                      <select
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value as Criterion['category'])}
                        className="w-full px-2 py-1 rounded bg-surface-card border border-border text-white text-xs font-mono"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-0.5">
                        Description
                      </label>
                      <input
                        type="text"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="w-full px-2 py-1 rounded bg-surface-card border border-border text-slate-300 text-xs"
                      />
                    </div>
                  </div>

                  {editError && (
                    <div className="text-rose-400 text-xs font-mono">{editError}</div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-border-subtle">
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-2.5 py-1 rounded bg-surface-subtle text-slate-400 hover:text-white text-xs font-mono cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSubmitEdit(crit.id)}
                      className="px-3 py-1 rounded bg-signal text-background font-mono font-bold text-xs cursor-pointer flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" />
                      <span>Apply</span>
                    </button>
                  </div>
                </div>
              ) : (
                // Display Mode
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white text-xs sm:text-sm truncate">
                          {crit.name}
                        </span>
                        {getCategoryBadge(crit.category)}
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-card border border-border text-signal font-semibold">
                          {normalizedWeight.toFixed(1)}%
                        </span>
                        {isLocked && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" />
                            <span>Locked</span>
                          </span>
                        )}
                      </div>
                      {crit.description && (
                        <p className="text-[11px] text-slate-400 truncate mt-0.5 max-w-md">
                          {crit.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {!isReadOnly && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => onToggleLock(crit.id)}
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                          isLocked
                            ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
                            : 'text-slate-400 hover:text-white hover:bg-surface-subtle'
                        }`}
                        title={isLocked ? 'Unlock weight' : 'Lock weight at current value'}
                      >
                        {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      </button>

                      <button
                        onClick={() => handleStartEdit(crit)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-subtle transition-colors cursor-pointer"
                        title="Edit criterion"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => setConfirmDeleteId(crit.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        title="Remove criterion"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Deletion confirmation dialog */}
              {confirmDeleteId === crit.id && (
                <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-rose-200">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>
                      Remove criterion <strong>{crit.name}</strong>? Its scores across all alternatives will be deleted and weights re-normalized.
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2.5 py-1 rounded bg-surface border border-border text-slate-300 hover:text-white font-mono text-[11px] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleConfirmDelete(crit.id)}
                      className="px-2.5 py-1 rounded bg-rose-500 hover:bg-rose-600 text-white font-mono font-bold text-[11px] cursor-pointer"
                    >
                      Confirm Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

