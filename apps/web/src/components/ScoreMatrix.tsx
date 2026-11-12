import React, { useState, useRef } from 'react';
import { Table, AlertTriangle, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import type { Criterion, Option, ScoreProvenanceMap, ScoreCoordinateProvenance } from '../types/decision.js';
import type { MissingScoreCoordinate } from '../hooks/useDecisionModel.js';

interface ScoreMatrixProps {
  criteria: Criterion[];
  options: Option[];
  weights: Record<string, number>;
  lockedIds?: string[];
  currentUserRole?: 'owner' | 'editor' | 'viewer' | 'contributor';
  scoreProvenance?: ScoreProvenanceMap;
  onUpdateScore: (
    optionId: string,
    criterionId: string,
    rawScore: number | string | null | undefined,
    provenance?: ScoreCoordinateProvenance
  ) => void;
  onClearSyntheticScores?: () => void;
  onPopulateSyntheticDemo?: (defaultValue?: number) => Promise<unknown> | void;
  missingScores: MissingScoreCoordinate[];
  disabled?: boolean;
}

export const ScoreMatrix: React.FC<ScoreMatrixProps> = ({
  criteria,
  options,
  weights,
  currentUserRole = 'owner',
  scoreProvenance,
  onUpdateScore,
  onClearSyntheticScores,
  onPopulateSyntheticDemo,
  missingScores,
  disabled = false,
}) => {
  const isReadOnly = currentUserRole === 'viewer' || currentUserRole === 'contributor';
  const isInteractionDisabled = isReadOnly || Boolean(disabled);
  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Synthetic demo score tracking & confirmation modal states
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [syntheticCellKeys, setSyntheticCellKeys] = useState<string[]>([]);
  const [isPopulating, setIsPopulating] = useState(false);
  const [populateError, setPopulateError] = useState<string | null>(null);

  // Check if a cell coordinate has synthetic demo provenance
  const isCellSynthetic = (optId: string, critId: string): boolean => {
    const rawVal = options.find((o) => o.id === optId)?.scores[critId];
    if (rawVal === undefined || rawVal === null) return false;
    if (scoreProvenance?.[optId]?.[critId]?.isSynthetic === true) return true;
    if (syntheticCellKeys.includes(`${optId}:${critId}`) && rawVal === 75) return true;
    return false;
  };

  const totalCells = criteria.length * options.length;
  const missingCount = missingScores.length;
  const filledCount = totalCells - missingCount;
  const isComplete = totalCells > 0 && missingCount === 0;

  // Compute active synthetic cells (explicitly registered in scoreProvenance or local demo keys)
  const activeSyntheticCount = options.reduce(
    (count, opt) =>
      count +
      criteria.filter(
        (c) => isCellSynthetic(opt.id, c.id)
      ).length,
    0
  );

  // Keyboard navigation handler for arrow keys and Enter
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    colIndex: number
  ) => {
    let targetRow = rowIndex;
    let targetCol = colIndex;

    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      targetRow = Math.min(criteria.length - 1, rowIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      targetRow = Math.max(0, rowIndex - 1);
    } else if (e.key === 'ArrowRight') {
      // If at end of input or selection
      const input = e.currentTarget;
      if (input.selectionStart === input.value.length) {
        targetCol = Math.min(options.length - 1, colIndex + 1);
      }
    } else if (e.key === 'ArrowLeft') {
      const input = e.currentTarget;
      if (input.selectionStart === 0) {
        targetCol = Math.max(0, colIndex - 1);
      }
    }

    if (targetRow !== rowIndex || targetCol !== colIndex) {
      const nextRef = cellRefs.current[`${targetRow}-${targetCol}`];
      if (nextRef) {
        nextRef.focus();
        nextRef.select();
      }
    }
  };

  if (criteria.length === 0 || options.length === 0) {
    return (
      <div className="p-6 rounded-xl bg-surface/50 border border-border text-center font-mono text-xs text-slate-400">
        Scoring matrix requires at least 1 alternative and 1 criterion to display.
      </div>
    );
  }

  return (
    <div className="border border-border-subtle rounded-xl bg-surface/60 overflow-hidden space-y-0 relative">
      {/* Matrix Status Header */}
      <div className="p-3.5 bg-surface-card border-b border-border-subtle flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Table className="w-4 h-4 text-signal shrink-0" />
          <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
            Utility Scoring Matrix (0 – 100)
          </span>
          <span className="text-[10px] font-mono text-slate-400">
            [Rows: Criteria × Columns: Alternatives]
          </span>
        </div>

        <div className="flex items-center gap-2">
          {disabled && (
            <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30 flex items-center gap-1.5 shadow-sm">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
              <span>Operation in progress...</span>
            </span>
          )}

          {/* Active Synthetic Indicator Badge */}
          {activeSyntheticCount > 0 && (
            <span
              className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center gap-1.5 shadow-sm"
              data-testid="synthetic-indicator"
              title="Matrix contains synthetic placeholder values (75.0) for demonstration only"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>{activeSyntheticCount} Synthetic Value{activeSyntheticCount === 1 ? '' : 's'} (Demo Only)</span>
            </span>
          )}

          {isComplete ? (
            activeSyntheticCount > 0 ? (
              <span
                className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1.5 shadow-sm"
                data-testid="synthetic-complete-badge"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>Complete with Synthetic Placeholders ({filledCount}/{totalCells}) — Non-Authoritative</span>
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-signal/15 text-signal border border-signal/30 flex items-center gap-1.5 shadow-sm">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Complete: {filledCount} / {totalCells} scores (100%)</span>
              </span>
            )
          ) : (
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span>Incomplete: {missingCount} missing score{missingCount === 1 ? '' : 's'} ({filledCount}/{totalCells})</span>
              </span>
              {!isInteractionDisabled && (
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(true)}
                  className="px-2 py-1 rounded-md text-[11px] font-mono font-semibold bg-surface hover:bg-surface-subtle border border-amber-500/40 text-amber-300 hover:text-white transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                  title="Populate empty score cells with default baseline (75.0) after explicit confirmation"
                  data-testid="fill-missing-btn"
                >
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  <span>Fill Missing (Demo 75)</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Responsive Matrix Table: Rows = Criteria, Columns = Alternatives */}
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border shadow-sm">
            <tr>
              {/* Top-Left Corner Header */}
              <th className="p-3 font-mono font-bold text-slate-400 text-[11px] uppercase tracking-wider min-w-[200px] border-r border-border-subtle">
                Evaluation Criterion
              </th>

              {/* Column Headers: Alternatives */}
              {options.map((opt) => (
                <th
                  key={opt.id}
                  className="p-3 font-mono font-bold text-slate-200 text-xs text-center min-w-[130px] border-r border-border-subtle last:border-r-0"
                >
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
                        style={{ backgroundColor: opt.color }}
                      />
                      <span className="font-bold text-white truncate max-w-[120px]" title={opt.name}>
                        {opt.name}
                      </span>
                    </div>
                    {opt.tagline && (
                      <span className="text-[10px] text-slate-400 font-normal truncate max-w-[120px]">
                        {opt.tagline}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-border-subtle font-mono">
            {criteria.map((crit, rIdx) => {
              const weightVal = weights[crit.id] ?? 0;

              return (
                <tr key={crit.id} className="hover:bg-surface-subtle/40 transition-colors">
                  {/* Row Header: Criterion Details */}
                  <th className="p-3 text-left font-normal bg-surface/40 border-r border-border-subtle">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-bold text-white text-xs truncate block" title={crit.name}>
                          {crit.shortName || crit.name}
                        </span>
                        {crit.description && (
                          <span className="text-[10px] text-slate-400 truncate block mt-0.5 max-w-[180px]">
                            {crit.description}
                          </span>
                        )}
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface-card border border-border text-signal shrink-0">
                        {weightVal.toFixed(1)}%
                      </span>
                    </div>
                  </th>

                  {/* Score Cells per Alternative */}
                  {options.map((opt, cIdx) => {
                    const rawVal = opt.scores[crit.id];
                    const isMissing = rawVal === undefined || rawVal === null;
                    const isInvalid =
                      !isMissing &&
                      (typeof rawVal !== 'number' ||
                        !Number.isFinite(rawVal) ||
                        rawVal < 0 ||
                        rawVal > 100);

                    const cellKey = `${opt.id}:${crit.id}`;
                    const isSynthetic = !isMissing && isCellSynthetic(opt.id, crit.id);

                    return (
                      <td
                        key={opt.id}
                        className={`p-2 text-center border-r border-border-subtle last:border-r-0 transition-colors ${
                          isMissing
                            ? 'bg-amber-500/5'
                            : isInvalid
                              ? 'bg-rose-500/10'
                              : isSynthetic
                                ? 'bg-purple-500/10'
                                : 'bg-transparent'
                        }`}
                      >
                        <div className="relative inline-block w-full max-w-[90px]">
                          <input
                            ref={(el) => {
                              cellRefs.current[`${rIdx}-${cIdx}`] = el;
                            }}
                            type="number"
                            min={0}
                            max={100}
                            step="any"
                            value={isMissing ? '' : rawVal}
                            placeholder="—"
                            disabled={isInteractionDisabled}
                            aria-label={`Score for ${opt.name} on ${crit.name}`}
                            onChange={(e) => {
                              if (isInteractionDisabled) return;
                              // Straightforward individual value replacement: editing clears synthetic marker immediately
                              setSyntheticCellKeys((prev) => prev.filter((k) => k !== cellKey));
                              const v = e.target.value.trim();
                              if (v === '') {
                                onUpdateScore(opt.id, crit.id, null);
                              } else {
                                const parsed = Number(v);
                                onUpdateScore(opt.id, crit.id, parsed);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (isInteractionDisabled) return;
                              handleKeyDown(e, rIdx, cIdx);
                            }}
                            className={`w-full px-2 py-1.5 rounded-lg text-center font-mono font-bold text-xs transition-all focus:outline-none ${
                              isInteractionDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-text'
                            } ${
                              isMissing
                                ? 'border border-dashed border-amber-500/60 bg-amber-500/10 text-amber-200 placeholder-amber-400/50 focus:border-amber-400 focus:ring-1 focus:ring-amber-400'
                                : isInvalid
                                  ? 'border border-rose-500 bg-rose-500/20 text-rose-200 focus:border-rose-400 focus:ring-1 focus:ring-rose-400'
                                  : isSynthetic
                                    ? 'border border-dashed border-purple-400/80 bg-purple-500/15 text-purple-200 focus:border-purple-300 focus:ring-1 focus:ring-purple-300'
                                    : 'border border-border bg-surface-card text-white hover:border-slate-500 focus:border-signal focus:ring-1 focus:ring-signal'
                            }`}
                            title={
                              isMissing
                                ? 'Missing score (required for authoritative calculation)'
                                : isInvalid
                                  ? 'Invalid score: Must be finite number in [0, 100]'
                                  : isSynthetic
                                    ? 'Synthetic demonstration value (75.0) — Not an authoritative assessment or verified evidence'
                                    : `Score: ${rawVal}`
                            }
                          />

                          {/* Missing Dot Marker */}
                          {isMissing && (
                            <span
                              className="absolute right-1.5 top-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse pointer-events-none"
                              title="Missing score"
                            />
                          )}

                          {/* Synthetic Value Tag Marker */}
                          {isSynthetic && (
                            <span
                              className="absolute -top-1.5 right-1 px-1 py-0.2 rounded text-[8px] font-mono font-bold bg-purple-950 text-purple-300 border border-purple-500/40 tracking-wider pointer-events-none shadow-sm z-10"
                              title="Synthetic demonstration value (75.0) — Not an authoritative assessment"
                              data-testid="synthetic-cell-badge"
                            >
                              DEMO
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer warning bar if synthetic values active */}
      {activeSyntheticCount > 0 && (
        <div
          className="p-2.5 bg-purple-500/10 border-t border-purple-500/30 flex flex-wrap items-center justify-between gap-2 text-[11px] text-purple-200 font-mono"
          data-testid="synthetic-banner"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span>
              <strong>Synthetic Demo Notice:</strong> {activeSyntheticCount} matrix score{activeSyntheticCount === 1 ? '' : 's'} contain synthetic baseline value (75.0). Not an authoritative assessment or verified evidence.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (onClearSyntheticScores) {
                onClearSyntheticScores();
              } else {
                for (const opt of options) {
                  for (const crit of criteria) {
                    if (isCellSynthetic(opt.id, crit.id)) {
                      onUpdateScore(opt.id, crit.id, null);
                    }
                  }
                }
              }
              setSyntheticCellKeys([]);
            }}
            className="px-2 py-0.5 rounded bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-500/40 text-[10px] font-semibold cursor-pointer transition-colors"
            data-testid="clear-synthetic-btn"
          >
            Clear Synthetic Values
          </button>
        </div>
      )}

      {/* Footer warning bar if missing scores */}
      {missingCount > 0 && (
        <div className="p-2.5 bg-amber-500/10 border-t border-amber-500/30 flex items-center justify-between text-[11px] text-amber-200 font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
            <span>
              <strong>Attention:</strong> {missingCount} matrix cell{missingCount === 1 ? '' : 's'} remain incomplete. Missing scores are never silently coerced to zero.
            </span>
          </div>
          <span className="text-[10px] text-amber-300 opacity-80 hidden sm:inline">
            Use arrow keys or Tab to navigate
          </span>
        </div>
      )}

      {/* Explicit Confirmation Dialog for Synthetic Values */}
      {showConfirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          data-testid="synthetic-confirm-dialog"
        >
          <div className="bg-[#121620] border border-amber-500/40 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-mono font-bold text-sm text-white">
                  Populate with Synthetic Demonstration Values?
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  You are about to insert a baseline value of <strong>75.0</strong> into {missingCount} missing score cell{missingCount === 1 ? '' : 's'}.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-surface border border-border text-[11px] font-mono text-amber-200/90 leading-relaxed space-y-1">
              <p className="font-bold text-amber-300">⚠️ Safeguard Policy:</p>
              <p>75.0 is a synthetic demonstration value for illustration only, NOT an actual evaluation or authoritative assessment.</p>
              <p>Synthetic values must never be treated as real decision evidence or used without verification.</p>
            </div>

            {populateError && (
              <div
                data-testid="synthetic-populate-error"
                className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2"
              >
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{populateError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
              <button
                type="button"
                onClick={() => {
                  setPopulateError(null);
                  setShowConfirmModal(false);
                }}
                disabled={isPopulating}
                className="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold text-slate-300 hover:text-white bg-surface hover:bg-surface-subtle border border-border transition-colors cursor-pointer disabled:opacity-50"
                data-testid="cancel-synthetic-fill"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setPopulateError(null);
                  if (onPopulateSyntheticDemo) {
                    setIsPopulating(true);
                    try {
                      await onPopulateSyntheticDemo(75);
                      setShowConfirmModal(false);
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : 'Failed to populate synthetic demo scores.';
                      setPopulateError(msg);
                    } finally {
                      setIsPopulating(false);
                    }
                  } else {
                    const keysToAdd: string[] = [];
                    for (const m of missingScores) {
                      keysToAdd.push(`${m.optionId}:${m.criterionId}`);
                      onUpdateScore(m.optionId, m.criterionId, 75, {
                        isSynthetic: true,
                        source: 'demo',
                      });
                    }
                    setSyntheticCellKeys((prev) => Array.from(new Set([...prev, ...keysToAdd])));
                    setShowConfirmModal(false);
                  }
                }}
                disabled={isPopulating}
                className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold text-amber-950 bg-amber-400 hover:bg-amber-300 transition-colors cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                data-testid="confirm-synthetic-fill"
              >
                {isPopulating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isPopulating ? 'Populating...' : 'Confirm & Insert Synthetic 75'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

