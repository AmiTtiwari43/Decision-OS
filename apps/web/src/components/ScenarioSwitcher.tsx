import React from 'react';
import { Sparkles, TrendingUp, DollarSign, Heart, Scale, MousePointerClick, CheckCircle2 } from 'lucide-react';
import type { Scenario } from '../types/decision';

interface ScenarioSwitcherProps {
  scenarios: Scenario[];
  activeScenarioId: string | null;
  onSelectScenario: (id: string) => void;
}

const scenarioIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  'career-first': TrendingUp,
  'money-first': DollarSign,
  'wlb-first': Heart,
  'balanced': Scale,
};

export const ScenarioSwitcher: React.FC<ScenarioSwitcherProps> = ({
  scenarios,
  activeScenarioId,
  onSelectScenario,
}) => {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-signal shrink-0" />
          <span className="text-xs font-mono font-bold uppercase text-slate-300 tracking-wider">
            Preset Priority Scenarios
          </span>
          <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">(Click any preset to test)</span>
        </div>
        <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
          {activeScenarioId ? 'Scenario Applied' : 'Custom Weights Active'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {scenarios.map((scenario) => {
          const Icon = scenarioIcons[scenario.id] || Sparkles;
          const isActive = activeScenarioId === scenario.id;

          return (
            <button
              key={scenario.id}
              onClick={() => onSelectScenario(scenario.id)}
              className={`p-3.5 rounded-xl text-left transition-all duration-200 border flex flex-col justify-between gap-2 group cursor-pointer ${
                isActive
                  ? 'bg-surface border-signal shadow-glow-signal-sm text-white ring-1 ring-signal/30'
                  : 'bg-surface/50 border-border-subtle hover:border-signal/50 text-slate-300 hover:text-white hover:bg-surface'
              }`}
            >
              <div>
                <div className="flex items-center justify-between w-full mb-1">
                  <div className="flex items-center gap-2 truncate">
                    <div
                      className={`p-1.5 rounded-lg border ${
                        isActive
                          ? 'bg-signal text-background border-signal'
                          : 'bg-surface-subtle text-slate-400 border-border-subtle group-hover:text-signal'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-bold truncate">{scenario.name}</span>
                  </div>
                  {isActive ? (
                    <span className="w-2 h-2 rounded-full bg-signal shrink-0 animate-pulse" />
                  ) : null}
                </div>

                <div className="text-[10px] font-mono text-signal truncate mb-1">
                  {scenario.badge}
                </div>

                <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                  {scenario.description}
                </p>
              </div>

              {/* Explicit Click Indicator Sign */}
              <div
                className={`pt-2 border-t border-border-subtle flex items-center gap-1.5 text-[10px] font-mono font-semibold ${
                  isActive
                    ? 'text-signal'
                    : 'text-slate-500 group-hover:text-slate-300'
                }`}
              >
                {isActive ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 text-signal" />
                    <span>Active Scenario</span>
                  </>
                ) : (
                  <>
                    <MousePointerClick className="w-3 h-3 text-slate-500 group-hover:text-signal" />
                    <span>Click to apply preset</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
