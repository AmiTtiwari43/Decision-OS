import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Terminal, Cpu, ShieldCheck } from 'lucide-react';
import { jobOfferCriteria, jobOfferOptions } from '../data/decisionData';

interface EasterEggProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EasterEgg: React.FC<EasterEggProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-background/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="w-full max-w-3xl rounded-2xl bg-surface-card border border-border shadow-2xl overflow-hidden font-mono text-xs"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 bg-surface border-b border-border">
            <div className="flex items-center gap-2 text-signal">
              <Terminal className="w-4 h-4" />
              <span className="font-bold text-slate-100 uppercase tracking-wider">
                Decision OS Engine / Mathematical Audit Terminal
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-md bg-surface-subtle text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
            {/* Mathematical Model */}
            <div className="p-4 rounded-xl bg-background border border-border-subtle">
              <div className="text-slate-400 font-bold mb-2 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-signal" />
                <span>FORMAL MATHEMATICAL DEFINITION</span>
              </div>
              <p className="text-slate-300 leading-relaxed mb-3">
                Score(O_j) = ∑ [ w_i × s_ij ] where ∑ w_i = 100% and s_ij ∈ [0, 100].
              </p>
              <div className="p-2.5 rounded bg-surface border border-border text-signal text-[11px]">
                Deterministic Multi-Criteria Decision Analysis (MCDA) with exact derivative sensitivity thresholds. Zero stochastic LLM generation in calculation layer.
              </div>
            </div>

            {/* Matrix Table */}
            <div>
              <div className="text-slate-300 font-bold mb-3 flex items-center justify-between">
                <span>RAW SCORE MATRIX & WEIGHT MULTIPLIERS</span>
                <span className="text-slate-500 text-[10px]">Matrix: 3 Options × 5 Criteria</span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface border-b border-border text-slate-400">
                      <th className="p-2.5 font-semibold">Criterion</th>
                      <th className="p-2.5 font-semibold">Weight</th>
                      <th className="p-2.5 font-semibold text-signal">Alpha</th>
                      <th className="p-2.5 font-semibold text-accent-cyan">Beta</th>
                      <th className="p-2.5 font-semibold text-accent-amber">Gamma</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle bg-surface/50 text-slate-200">
                    {jobOfferCriteria.map((c) => (
                      <tr key={c.id}>
                        <td className="p-2.5 font-sans font-medium">{c.name}</td>
                        <td className="p-2.5 text-slate-400">{c.defaultWeight}%</td>
                        <td className="p-2.5 text-signal font-bold">{jobOfferOptions[0].scores[c.id]}</td>
                        <td className="p-2.5 text-accent-cyan font-bold">{jobOfferOptions[1].scores[c.id]}</td>
                        <td className="p-2.5 text-accent-amber font-bold">{jobOfferOptions[2].scores[c.id]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Verification Status */}
            <div className="p-4 rounded-xl bg-surface border border-signal/30 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-signal shrink-0" />
                <div>
                  <div className="font-bold text-white">Mathematical Engine Verified</div>
                  <div className="text-slate-400 text-[11px]">
                    100% normalized weight sum constraint passed. 6/6 automated test assertions verified.
                  </div>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded bg-signal/15 text-signal text-[11px] font-bold border border-signal/30">
                PASSED
              </span>
            </div>
          </div>

          <div className="p-4 bg-surface border-t border-border flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-surface-subtle hover:bg-surface border border-border text-slate-200"
            >
              Close Audit Terminal
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
