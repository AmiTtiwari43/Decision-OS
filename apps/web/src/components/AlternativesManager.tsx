import React, { useState } from 'react';
import { Plus, Trash2, Edit3, X, Check, AlertCircle } from 'lucide-react';
import type { Option } from '../types/decision.js';

interface AlternativesManagerProps {
  options: Option[];
  currentUserRole?: 'owner' | 'editor' | 'viewer' | 'contributor';
  onAddAlternative: (name: string, tagline?: string, description?: string, color?: string) => Option;
  onRenameAlternative: (optionId: string, newName: string) => void;
  onUpdateAlternative: (
    optionId: string,
    updates: { name?: string; tagline?: string; description?: string; color?: string }
  ) => void;
  onRemoveAlternative: (optionId: string) => void;
  disabled?: boolean;
}

const PALETTE = ['#B8FF5A', '#38BDF8', '#F59E0B', '#FB7185', '#A78BFA', '#34D399', '#F472B6'];

export const AlternativesManager: React.FC<AlternativesManagerProps> = ({
  options,
  currentUserRole = 'owner',
  onAddAlternative,
  onRenameAlternative,
  onUpdateAlternative,
  onRemoveAlternative,
  disabled = false,
}) => {
  const isReadOnly = currentUserRole === 'viewer' || currentUserRole === 'contributor' || Boolean(disabled);

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTagline, setNewTagline] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newColor, setNewColor] = useState(PALETTE[options.length % PALETTE.length]);
  const [addError, setAddError] = useState<string | null>(null);

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTagline, setEditTagline] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // Deletion confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleStartAdd = () => {
    setNewName('');
    setNewTagline('');
    setNewDescription('');
    setNewColor(PALETTE[options.length % PALETTE.length]);
    setAddError(null);
    setIsAdding(true);
  };

  const handleCancelAdd = () => {
    setIsAdding(false);
    setAddError(null);
  };

  const handleSubmitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    const trimmed = newName.trim();
    if (!trimmed) {
      setAddError('Alternative name is required.');
      return;
    }
    if (options.some((o) => o.name.toLowerCase() === trimmed.toLowerCase())) {
      setAddError(`An alternative named "${trimmed}" already exists.`);
      return;
    }

    try {
      onAddAlternative(trimmed, newTagline.trim(), newDescription.trim(), newColor);
      setIsAdding(false);
      setNewName('');
      setNewTagline('');
      setNewDescription('');
    } catch (err) {
      setAddError((err as Error).message || 'Failed to add alternative.');
    }
  };

  const handleStartEdit = (opt: Option) => {
    setEditingId(opt.id);
    setEditName(opt.name);
    setEditTagline(opt.tagline || '');
    setEditDescription(opt.description || '');
    setEditColor(opt.color);
    setEditError(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const handleSubmitEdit = (optionId: string) => {
    setEditError(null);
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError('Alternative name is required.');
      return;
    }
    if (
      options.some(
        (o) => o.id !== optionId && o.name.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      setEditError(`An alternative named "${trimmed}" already exists.`);
      return;
    }

    try {
      const currentOpt = options.find((o) => o.id === optionId);
      const isOnlyNameChange =
        currentOpt &&
        currentOpt.name !== trimmed &&
        currentOpt.tagline === editTagline.trim() &&
        currentOpt.description === editDescription.trim() &&
        currentOpt.color === editColor;

      if (isOnlyNameChange) {
        onRenameAlternative(optionId, trimmed);
      } else {
        onUpdateAlternative(optionId, {
          name: trimmed,
          tagline: editTagline.trim(),
          description: editDescription.trim(),
          color: editColor,
        });
      }
      setEditingId(null);
    } catch (err) {
      setEditError((err as Error).message || 'Failed to update alternative.');
    }
  };

  const handleConfirmDelete = (optionId: string) => {
    onRemoveAlternative(optionId);
    setConfirmDeleteId(null);
  };

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-300 font-bold uppercase tracking-wider">
            Alternatives ({options.length})
          </span>
          {options.length < 2 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-300 border border-amber-500/20">
              Min 2 recommended
            </span>
          )}
        </div>

        {!isReadOnly && !isAdding && (
          <button
            onClick={handleStartAdd}
            className="px-2.5 py-1 rounded-lg text-xs font-mono font-semibold bg-surface hover:bg-surface-subtle border border-signal/40 text-signal hover:shadow-glow-signal-sm flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Alternative</span>
          </button>
        )}
      </div>

      {/* Add Alternative Inline Form */}
      {isAdding && (
        <form
          onSubmit={handleSubmitAdd}
          className="p-3.5 rounded-xl bg-surface border border-signal/40 shadow-glow-signal-sm space-y-3 text-xs"
        >
          <div className="flex items-center justify-between font-mono font-bold text-signal text-[11px] uppercase">
            <span>New Alternative Candidate</span>
            <button
              type="button"
              onClick={handleCancelAdd}
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
                placeholder="e.g. Series B Offer, Cloud Platform A"
                className="w-full px-2.5 py-1.5 rounded-lg bg-surface-card border border-border text-white focus:outline-none focus:border-signal text-xs"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                Tagline / Badge (optional)
              </label>
              <input
                type="text"
                value={newTagline}
                onChange={(e) => setNewTagline(e.target.value)}
                placeholder="e.g. High Growth, Enterprise Scale"
                className="w-full px-2.5 py-1.5 rounded-lg bg-surface-card border border-border text-slate-300 focus:outline-none focus:border-signal text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
              Description / Dilemma Context (optional)
            </label>
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Key strategic trade-offs or background..."
              className="w-full px-2.5 py-1.5 rounded-lg bg-surface-card border border-border text-slate-300 focus:outline-none focus:border-signal text-xs"
            />
          </div>

          {/* Color swatch picker */}
          <div>
            <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1.5">
              Accent Color
            </label>
            <div className="flex items-center gap-2">
              {PALETTE.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setNewColor(hex)}
                  className={`w-6 h-6 rounded-full border transition-transform cursor-pointer ${
                    newColor === hex
                      ? 'scale-125 border-white shadow-md'
                      : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
              ))}
            </div>
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
              onClick={handleCancelAdd}
              className="px-3 py-1.5 rounded-lg bg-surface-subtle text-slate-400 hover:text-white font-mono text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-lg bg-signal hover:bg-signal-light text-background font-mono font-bold text-xs shadow-glow-signal-sm cursor-pointer"
            >
              Add Alternative
            </button>
          </div>
        </form>
      )}

      {/* Options List */}
      <div className="space-y-2">
        {options.map((opt) => (
          <div
            key={opt.id}
            className="p-3 rounded-xl bg-surface/70 border border-border hover:border-slate-600 transition-colors"
          >
            {editingId === opt.id ? (
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
                      Tagline
                    </label>
                    <input
                      type="text"
                      value={editTagline}
                      onChange={(e) => setEditTagline(e.target.value)}
                      className="w-full px-2 py-1 rounded bg-surface-card border border-border text-slate-300 text-xs"
                    />
                  </div>
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

                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-400">Color:</span>
                  {PALETTE.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setEditColor(hex)}
                      className={`w-5 h-5 rounded-full border cursor-pointer ${
                        editColor === hex ? 'scale-125 border-white' : 'border-transparent opacity-70'
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>

                {editError && (
                  <div className="text-rose-400 text-xs font-mono">{editError}</div>
                )}

                <div className="flex items-center justify-end gap-2 pt-1 border-t border-border-subtle">
                  <button
                    onClick={handleCancelEdit}
                    className="px-2.5 py-1 rounded bg-surface-subtle text-slate-400 hover:text-white text-xs font-mono cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleSubmitEdit(opt.id)}
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
                  <span
                    className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: opt.color }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white text-xs sm:text-sm truncate">
                        {opt.name}
                      </span>
                      {opt.tagline && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-subtle border border-border-subtle text-slate-400">
                          {opt.tagline}
                        </span>
                      )}
                    </div>
                    {opt.description && (
                      <p className="text-[11px] text-slate-400 truncate mt-0.5 max-w-md">
                        {opt.description}
                      </p>
                    )}
                  </div>
                </div>

                {!isReadOnly && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleStartEdit(opt)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-subtle transition-colors cursor-pointer"
                      title="Edit alternative"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => setConfirmDeleteId(opt.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                      title="Remove alternative"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Deletion confirmation dialog */}
            {confirmDeleteId === opt.id && (
              <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-rose-200">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>
                    Remove <strong>{opt.name}</strong>? Associated scores will be deleted and authoritative evaluations invalidated.
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
                    onClick={() => handleConfirmDelete(opt.id)}
                    className="px-2.5 py-1 rounded bg-rose-500 hover:bg-rose-600 text-white font-mono font-bold text-[11px] cursor-pointer"
                  >
                    Confirm Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

