import React, { useRef } from 'react';
import { Table, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import type { Criterion, Option } from '../types/decision.js';
import type { MissingScoreCoordinate } from '../hooks/useDecisionModel.js';

interface ScoreMatrixProps {
  criteria: Criterion[];
  options: Option[];
  weights: Record<string, number>;
  lockedIds?: string[];
  currentUserRole?: 'owner' | 'editor' | 'viewer' | 'contributor';
  onUpdateScore: (
    optionId: string,
    criterionId: string,
    rawScore: number | string | null | undefined
  ) => void;
  missingScores: MissingScoreCoordinate[];
  disabled?: boolean;
}

export const ScoreMatrix: React.FC<ScoreMatrixProps> = ({
  criteria,
  options,
  weights,
  currentUserRole = 'owner',
  onUpdateScore,
  missingScores,
  disabled = false,
}) => {
  const isReadOnly = currentUserRole === 'viewer' || currentUserRole === 'contributor';
  const isInteractionDisabled = isReadOnly || Boolean(disabled);
  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const totalCells = criteria.length * options.length;
  const missingCount = missingScores.length;
  const filledCount = totalCells - missingCount;
  const isComplete = totalCells > 0 && missingCount === 0;

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
    <div className="border border-border-subtle rounded-xl bg-surface/60 overflow-hidden space-y-0">
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
          {isComplete ? (
            <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-signal/15 text-signal border border-signal/30 flex items-center gap-1.5 shadow-sm">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Complete: {filledCount} / {totalCells} scores (100%)</span>
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span>Incomplete: {missingCount} missing score{missingCount === 1 ? '' : 's'} ({filledCount}/{totalCells})</span>
            </span>
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

                    return (
                      <td
                        key={opt.id}
                        className={`p-2 text-center border-r border-border-subtle last:border-r-0 transition-colors ${
                          isMissing
                            ? 'bg-amber-500/5'
                            : isInvalid
                              ? 'bg-rose-500/10'
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
                                  : 'border border-border bg-surface-card text-white hover:border-slate-500 focus:border-signal focus:ring-1 focus:ring-signal'
                            }`}
                            title={
                              isMissing
                                ? 'Missing score (required for authoritative calculation)'
                                : isInvalid
                                  ? 'Invalid score: Must be finite number in [0, 100]'
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
    </div>
  );
};
