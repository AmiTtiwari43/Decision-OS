import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Radar,
  TrendingUp,
  Scale,
  Activity,
  Sparkles,
  Info,
  MousePointerClick,
  CheckCircle2,
} from 'lucide-react';
import type { Criterion, Option, OptionEvaluation, SensitivityAnalysis } from '../types/decision';
import { RadarChart } from './RadarChart';
import { SensitivityCurve } from './SensitivityCurve';
import { BalanceBeam } from './BalanceBeam';
import { MonteCarloTester } from './MonteCarloTester';
import { sound } from '../utils/audioFx';

interface InstrumentsShowcaseProps {
  criteria: Criterion[];
  options: Option[];
  weights: Record<string, number>;
  activeOptionIds: string[];
  evaluations: OptionEvaluation[];
  sensitivity: SensitivityAnalysis[];
  onSelectWeight: (criterionId: string, weight: number) => void;
}

const instruments = [
  {
    id: 'radar',
    title: 'Multi-Axis Radar Polygon',
    subtitle: '5-Dimensional Geometry',
    description: 'Visualizes the geometric profile of each option across all 5 criteria simultaneously.',
    icon: Radar,
    accent: '#B8FF5A',
  },
  {
    id: 'curve',
    title: 'Breakeven Sensitivity Curve',
    subtitle: 'Tipping Point Calculus',
    description: 'Continuous mathematical line curve solving the exact weight where the leading option flips.',
    icon: TrendingUp,
    accent: '#38BDF8',
  },
  {
    id: 'physics',
    title: 'Trade-off Torque Scale',
    subtitle: 'Physical Mass Dynamics',
    description: 'Translates weighted scores into physical mass pans, tilting dynamically in degrees.',
    icon: Scale,
    accent: '#F59E0B',
  },
  {
    id: 'montecarlo',
    title: 'Monte Carlo Stress-Tester',
    subtitle: '1,000 Randomized Passes',
    description: 'Applies Gaussian noise across all criteria to compute empirical victory probabilities.',
    icon: Activity,
    accent: '#FB7185',
  },
];

export const InstrumentsShowcase: React.FC<InstrumentsShowcaseProps> = ({
  criteria,
  options,
  weights,
  activeOptionIds,
  evaluations,
  sensitivity,
  onSelectWeight,
}) => {
  const [activeInstrumentId, setActiveInstrumentId] = useState<string>('radar');

  const activeInstrument = instruments.find((i) => i.id === activeInstrumentId) || instruments[0];

  const handleSelectInstrument = (id: string) => {
    sound.playTick();
    setActiveInstrumentId(id);
  };

  return (
    <section className="py-20 md:py-28 relative border-t border-border-subtle bg-surface/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-signal/10 border border-signal/20 text-xs font-mono font-semibold text-signal mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Deep Analytical Studio</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white">
            Inspect decisions from every angle.
          </h2>
          <p className="mt-3 text-base text-slate-400">
            Click any instrument card below to switch views and stress-test your trade-offs in real time.
          </p>
        </div>

        {/* 4 Large Visual Instrument Selector Cards with explicit click affordances */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {instruments.map((inst) => {
            const Icon = inst.icon;
            const isActive = inst.id === activeInstrumentId;
            return (
              <button
                key={inst.id}
                onClick={() => handleSelectInstrument(inst.id)}
                className={`p-5 rounded-2xl text-left transition-all duration-300 border relative overflow-hidden flex flex-col justify-between group cursor-pointer ${
                  isActive
                    ? 'bg-surface-card border-signal shadow-glow-signal-sm ring-1 ring-signal/30'
                    : 'bg-surface/60 border-border hover:border-signal/50 hover:bg-surface'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className={`p-2.5 rounded-xl border ${
                        isActive
                          ? 'bg-signal text-background border-signal shadow-sm'
                          : 'bg-surface-subtle text-slate-400 border-border group-hover:text-signal'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    {isActive && (
                      <span className="w-2 h-2 rounded-full bg-signal animate-pulse" />
                    )}
                  </div>

                  <h3 className="text-base font-bold text-white mb-1 group-hover:text-signal transition-colors">
                    {inst.title}
                  </h3>
                  <div className="text-[11px] font-mono text-signal mb-2">
                    {inst.subtitle}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed mb-4">
                    {inst.description}
                  </p>
                </div>

                {/* Explicit Click Indicator Sign */}
                <div
                  className={`pt-3 border-t border-border-subtle flex items-center justify-between text-xs font-mono font-semibold ${
                    isActive
                      ? 'text-signal'
                      : 'text-slate-400 group-hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {isActive ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-signal" />
                        <span>Viewing Instrument</span>
                      </>
                    ) : (
                      <>
                        <MousePointerClick className="w-3.5 h-3.5 text-slate-500 group-hover:text-signal" />
                        <span>Click to switch</span>
                      </>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500">↵</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Active Instrument Main Frame */}
        <div className="rounded-3xl bg-surface-card border border-border p-4 sm:p-8 relative overflow-hidden">
          <div className="flex items-center gap-2 mb-6 text-xs text-slate-300 pb-3 border-b border-border-subtle">
            <Info className="w-4 h-4 text-signal shrink-0" />
            <span>
              <strong className="text-white font-medium">{activeInstrument.title}:</strong> {activeInstrument.description}
            </span>
          </div>

          <AnimatePresence mode="wait">
            {activeInstrumentId === 'radar' && (
              <motion.div
                key="radar"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
              >
                <RadarChart
                  criteria={criteria}
                  options={options}
                  weights={weights}
                  activeOptionIds={activeOptionIds}
                />
              </motion.div>
            )}

            {activeInstrumentId === 'curve' && (
              <motion.div
                key="curve"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
              >
                <SensitivityCurve
                  criteria={criteria}
                  options={options}
                  weights={weights}
                  sensitivity={sensitivity}
                  onSelectWeight={onSelectWeight}
                />
              </motion.div>
            )}

            {activeInstrumentId === 'physics' && (
              <motion.div
                key="physics"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
              >
                <BalanceBeam evaluations={evaluations} />
              </motion.div>
            )}

            {activeInstrumentId === 'montecarlo' && (
              <motion.div
                key="montecarlo"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
              >
                <MonteCarloTester
                  criteria={criteria}
                  options={options}
                  weights={weights}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
};
