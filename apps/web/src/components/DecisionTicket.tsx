import React, { useState } from 'react';
import { Award, Copy, Check, QrCode, ShieldCheck } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { OptionEvaluation, Criterion } from '../types/decision';
import { sound } from '../utils/audioFx';

interface DecisionTicketProps {
  winner: OptionEvaluation;
  runnerUp: OptionEvaluation | null;
  criteria: Criterion[];
  weights: Record<string, number>;
  question: string;
}

export const DecisionTicket: React.FC<DecisionTicketProps> = ({
  winner,
  runnerUp,
  criteria,
  weights,
  question,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyTicket = () => {
    sound.playCelebrate();
    const text = `=========================================
  DECISION OS — VERIFIED DECISION TICKET
=========================================
Target: "${question}"
Timestamp: ${new Date().toISOString()}
Serial: DEC-${Math.random().toString(36).substring(2, 9).toUpperCase()}

RECOMMENDED WINNER:
🏆 ${winner.option.name} (Score: ${winner.weightedScore}/100)
${winner.option.badge || ''}

RUNNER-UP:
${runnerUp ? `2nd: ${runnerUp.option.name} (${runnerUp.weightedScore}/100, Delta: -${(winner.weightedScore - runnerUp.weightedScore).toFixed(1)} pts)` : 'N/A'}

PRIORITY CALIBRATION:
${criteria.map(c => `• ${c.name}: ${weights[c.id]}%`).join('\n')}

=========================================
Verification: 100% Deterministic MCDA
Generated via Decision OS
=========================================`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 } });
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <section className="py-16 md:py-24 relative border-t border-border-subtle bg-surface-subtle/20 overflow-hidden">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-xl mx-auto mb-8">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-signal/10 border border-signal/20 text-[11px] font-mono text-signal mb-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Official Export Format</span>
          </div>
          <h3 className="text-2xl sm:text-3xl font-extrabold text-white">
            Verified Decision Briefing Pass
          </h3>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            An exportable, boardroom-ready summary ready to share with stakeholders or partners.
          </p>
        </div>

        <div className="relative rounded-3xl p-1 bg-gradient-to-r from-signal/40 via-accent-cyan/30 to-accent-amber/40 shadow-glow-card w-full max-w-2xl mx-auto">
          <div className="rounded-[22px] bg-surface-card p-5 sm:p-8 relative overflow-hidden">
            {/* Top Ticket Header */}
            <div className="flex items-center justify-between pb-4 border-b border-dashed border-border-strong gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center text-signal shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
                    Decision Briefing Ticket
                  </div>
                  <div className="text-xs font-mono font-bold text-white truncate">
                    DEC-OS-2026-0942
                  </div>
                </div>
              </div>

              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-signal/15 text-signal font-semibold border border-signal/30 shrink-0">
                VERIFIED MCDA
              </span>
            </div>

            {/* Question & Winner Highlight */}
            <div className="py-5 space-y-4">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Evaluated Question
                </div>
                <h4 className="text-base sm:text-xl font-bold text-white mt-0.5">
                  "{question}"
                </h4>
              </div>

              <div className="p-4 rounded-2xl bg-gradient-to-r from-surface via-surface-subtle to-surface border border-signal/30 flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-signal text-background font-bold shadow-glow-signal shrink-0">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                      Leading Recommendation
                    </div>
                    <div className="text-lg sm:text-xl font-extrabold text-white">
                      {winner.option.name}
                    </div>
                    <div className="text-xs text-slate-400 font-mono">
                      {winner.option.badge}
                    </div>
                  </div>
                </div>

                <div className="text-right ml-auto sm:ml-0">
                  <div className="text-[10px] font-mono uppercase text-slate-400">Calculated Score</div>
                  <div className="text-2xl sm:text-3xl font-extrabold font-mono text-signal">
                    {winner.weightedScore}
                    <span className="text-xs text-slate-500 font-normal">/100</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Criteria Weights Allocation Strip */}
            <div className="py-4 border-t border-border-subtle">
              <div className="text-[10px] font-mono uppercase text-slate-400 tracking-wider mb-2">
                Active Weights Applied
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {criteria.map((c) => (
                  <div key={c.id} className="p-2 rounded-lg bg-surface/80 border border-border-subtle text-center">
                    <div className="text-[10px] text-slate-400 truncate">{c.shortName}</div>
                    <div className="text-xs font-mono font-bold text-slate-100 mt-0.5">
                      {weights[c.id]}%
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Ticket Bottom Stub & Export Action */}
            <div className="pt-4 border-t border-dashed border-border-strong flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <QrCode className="w-7 h-7 text-slate-500 shrink-0" />
                <div className="text-[11px] font-mono text-slate-400 truncate">
                  <div>HASH: 0x8F92...B8FF5A</div>
                  <div className="text-[10px] text-slate-500">100% Deterministic Arithmetic</div>
                </div>
              </div>

              <button
                onClick={handleCopyTicket}
                className="px-5 py-2.5 rounded-xl bg-signal hover:bg-signal-light text-background font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-glow-signal-sm shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-background" />
                    <span>Ticket Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-background" />
                    <span>Copy Verified Ticket</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
