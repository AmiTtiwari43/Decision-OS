import React from 'react';
import {
  Sliders,
  Sparkles,
  RotateCcw,
  PlusCircle,
  HelpCircle,
  ChevronDown,
} from 'lucide-react';
import { useDecisionModel } from '../hooks/useDecisionModel';
import { WeightSlider } from './WeightSlider';
import { ScoreCard } from './ScoreCard';
import { ScenarioSwitcher } from './ScenarioSwitcher';
import { SensitivityBar } from './SensitivityBar';
import { sound } from '../utils/audioFx';

interface DecisionDemoProps {
  onOpenSandbox: () => void;
}

export const DecisionDemo: React.FC<DecisionDemoProps> = ({ onOpenSandbox: _onOpenSandbox }) => {
  const {
    criteria,
    scenarios,
    weights,
    lockedIds,
    activeScenarioId,
    activeOptionIds,
    engineResult,
    setCriterionWeight,
    toggleLock,
    applyScenario,
    toggleOption,
    resetToDefaults,
  } = useDecisionModel();

  const { evaluations, runnerUp, sensitivity, explainability, totalWeight } = engineResult;
  const isGammaActive = activeOptionIds.includes('gamma');

  const handleSliderChange = (criterionId: string, val: number) => {
    sound.playTick(600 + val * 4);
    setCriterionWeight(criterionId, val);
  };

  const handleScenarioSelect = (scenarioId: string) => {
    sound.playScenarioChime(scenarioId === 'money-first');
    applyScenario(scenarioId);
  };

  return (
    <section id="simulator" className="py-20 md:py-28 relative bg-surface-subtle/30 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-signal/10 border border-signal/20 text-xs font-mono font-semibold text-signal mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Interactive Decision Studio</span>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
              Change what matters. <br className="hidden sm:inline" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-signal via-signal-light to-slate-200">
                Watch the decision adapt.
              </span>
            </h2>
            <p className="mt-3 text-sm sm:text-base text-slate-300 max-w-xl">
              Adjust criteria weights to reflect your personal priorities. The engine balances unlocked sliders to 100% and calculates the winning option in real time.
            </p>
          </div>

          {/* Quick Action Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => {
                sound.playTick();
                resetToDefaults();
              }}
              className="px-3.5 py-2 rounded-xl bg-surface border border-border text-xs font-mono text-slate-300 hover:text-white hover:border-slate-500 flex items-center gap-2 transition-all shadow-sm"
              title="Reset weights to baseline"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Baseline</span>
            </button>

            <button
              onClick={() => {
                sound.playTick();
                toggleOption('gamma');
              }}
              className={`px-3.5 py-2 rounded-xl border text-xs font-mono flex items-center gap-2 transition-all ${
                isGammaActive
                  ? 'bg-accent-amber/15 border-accent-amber/40 text-accent-amber'
                  : 'bg-surface border-border text-slate-300 hover:border-slate-500'
              }`}
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>{isGammaActive ? 'Hide 3rd Option' : 'Compare 3rd Option'}</span>
            </button>
          </div>
        </div>

        {/* Preset Scenario Switcher */}
        <div className="mb-8 p-4 sm:p-5 rounded-2xl bg-surface-card border border-border">
          <ScenarioSwitcher
            scenarios={scenarios}
            activeScenarioId={activeScenarioId}
            onSelectScenario={handleScenarioSelect}
          />
        </div>

        {/* Main 2-Column Responsive Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Criteria Weight Sliders */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-5 rounded-2xl sm:rounded-3xl bg-surface-card border border-border">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-signal" />
                  <h3 className="text-sm font-bold text-slate-100 uppercase font-mono tracking-wider">
                    Criteria Weights
                  </h3>
                </div>
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-slate-400">Sum:</span>
                  <span
                    className={`font-bold px-2 py-0.5 rounded ${
                      totalWeight === 100
                        ? 'text-signal bg-signal/10 border border-signal/20'
                        : 'text-accent-amber bg-accent-amber/10 border border-accent-amber/20'
                    }`}
                  >
                    {totalWeight}%
                  </span>
                </div>
              </div>

              {/* Proportional distribution bar preview */}
              <div className="w-full h-2 bg-background rounded-full overflow-hidden flex mb-4 border border-border-subtle">
                {criteria.map((c, i) => {
                  const colors = ['#B8FF5A', '#38BDF8', '#818CF8', '#FB7185', '#F59E0B'];
                  return (
                    <div
                      key={c.id}
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${weights[c.id] || 0}%`,
                        backgroundColor: colors[i % colors.length],
                      }}
                      title={`${c.name}: ${weights[c.id]}%`}
                    />
                  );
                })}
              </div>

              {/* Sliders list */}
              <div className="space-y-3">
                {criteria.map((c) => (
                  <WeightSlider
                    key={c.id}
                    criterion={c}
                    weight={weights[c.id] ?? 0}
                    isLocked={lockedIds.includes(c.id)}
                    onWeightChange={(val) => handleSliderChange(c.id, val)}
                    onToggleLock={() => {
                      sound.playTick();
                      toggleLock(c.id);
                    }}
                  />
                ))}
              </div>

              <div className="mt-4 p-3 rounded-xl bg-surface-subtle border border-border-subtle text-[11px] text-slate-400 flex items-start gap-2">
                <HelpCircle className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                <span>
                  Adjusting any slider automatically normalizes the unlocked criteria so your total weight always equals 100%.
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Live Outcome & Score Cards */}
          <div className="lg:col-span-7 space-y-6">
            {/* Dynamic Recommendation Header Card */}
            <div className="p-5 sm:p-6 rounded-2xl sm:rounded-3xl bg-gradient-to-r from-surface-card to-surface border border-signal/40 shadow-glow-signal-sm">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-signal font-semibold">
                  Live Mathematical Outcome
                </span>
                <span className="text-xs font-mono text-slate-400">
                  Lead: +{explainability.pointLead} pts
                </span>
              </div>

              <h4 className="text-xl sm:text-2xl font-bold text-white mb-2 leading-snug">
                {explainability.headline}
              </h4>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {explainability.dynamicRationale}
              </p>
            </div>

            {/* Prominent Score Cards */}
            <div
              className={`grid gap-4 ${
                evaluations.length === 3 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'
              }`}
            >
              {evaluations.map((evaluation) => (
                <ScoreCard
                  key={evaluation.option.id}
                  evaluation={evaluation}
                  isLeader={evaluation.rank === 1}
                  totalOptions={evaluations.length}
                />
              ))}
            </div>

            {/* Sensitivity Analysis Tipping Point Bar */}
            <SensitivityBar
              sensitivity={sensitivity}
              runnerUpName={runnerUp?.option.name || null}
              onApplyTippingWeight={(cId, targetWeight) => {
                sound.playTick();
                setCriterionWeight(cId, targetWeight);
              }}
            />

            {/* Prompt to Deep Analytical Instruments Below */}
            <div className="p-4 rounded-2xl bg-surface border border-border flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span className="w-2 h-2 rounded-full bg-signal" />
                <span>Want to inspect radar polygons, sensitivity curves & Monte Carlo tests?</span>
              </div>
              <a
                href="#instruments"
                onClick={() => sound.playTick()}
                className="text-xs font-mono font-semibold text-signal hover:underline flex items-center gap-1"
              >
                <span>Scroll to Instruments</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
