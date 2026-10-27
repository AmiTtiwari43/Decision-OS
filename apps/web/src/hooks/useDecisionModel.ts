import { useState, useMemo, useCallback } from 'react';
import type { DecisionDataset } from '../types/decision';
import { runDecisionEngine, normalizeWeights } from '../utils/decisionEngine';
import { primaryJobOfferDataset } from '../data/decisionData';

export function useDecisionModel(initialDataset: DecisionDataset = primaryJobOfferDataset) {
  const [dataset, setDatasetState] = useState<DecisionDataset>(initialDataset);

  const [weights, setWeightsState] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    initialDataset.criteria.forEach(c => {
      initial[c.id] = c.defaultWeight;
    });
    return normalizeWeights(initial, initialDataset.criteria);
  });

  const [lockedIds, setLockedIds] = useState<string[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>('career-first');
  const [activeOptionIds, setActiveOptionIds] = useState<string[]>(() =>
    initialDataset.options.slice(0, 2).map(o => o.id)
  );

  const activeOptions = useMemo(() => {
    return dataset.options.filter(o => activeOptionIds.includes(o.id));
  }, [dataset.options, activeOptionIds]);

  const engineResult = useMemo(() => {
    return runDecisionEngine(activeOptions, dataset.criteria, weights, lockedIds);
  }, [activeOptions, dataset.criteria, weights, lockedIds]);

  const setCriterionWeight = useCallback(
    (criterionId: string, newWeight: number) => {
      setActiveScenarioId(null);
      const clamped = Math.max(0, Math.min(100, Math.round(newWeight)));
      
      const newRawWeights = {
        ...weights,
        [criterionId]: clamped,
      };

      const lockedPass = Array.from(new Set([...lockedIds, criterionId]));
      const normalized = normalizeWeights(newRawWeights, dataset.criteria, lockedPass);
      
      setWeightsState(normalized);
    },
    [weights, lockedIds, dataset.criteria]
  );

  const toggleLock = useCallback((criterionId: string) => {
    setLockedIds(prev =>
      prev.includes(criterionId) ? prev.filter(id => id !== criterionId) : [...prev, criterionId]
    );
  }, []);

  const applyScenario = useCallback(
    (scenarioId: string) => {
      const scenario = dataset.scenarios.find(s => s.id === scenarioId);
      if (!scenario) return;

      setActiveScenarioId(scenarioId);
      setLockedIds([]);
      const normalized = normalizeWeights(scenario.weights, dataset.criteria);
      setWeightsState(normalized);
    },
    [dataset.scenarios, dataset.criteria]
  );

  const toggleOption = useCallback((optionId: string) => {
    setActiveOptionIds(prev => {
      if (prev.includes(optionId)) {
        if (prev.length <= 2) return prev;
        return prev.filter(id => id !== optionId);
      } else {
        return [...prev, optionId];
      }
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    setActiveScenarioId('career-first');
    setLockedIds([]);
    const initial: Record<string, number> = {};
    dataset.criteria.forEach(c => {
      initial[c.id] = c.defaultWeight;
    });
    setWeightsState(normalizeWeights(initial, dataset.criteria));
    setActiveOptionIds(dataset.options.slice(0, 2).map(o => o.id));
  }, [dataset]);

  const switchDataset = useCallback((newDataset: DecisionDataset) => {
    setDatasetState(newDataset);
    setActiveScenarioId(newDataset.scenarios[0]?.id || null);
    setLockedIds([]);
    const initial: Record<string, number> = {};
    newDataset.criteria.forEach(c => {
      initial[c.id] = c.defaultWeight;
    });
    setWeightsState(normalizeWeights(initial, newDataset.criteria));
    setActiveOptionIds(newDataset.options.slice(0, 2).map(o => o.id));
  }, []);

  return {
    dataset,
    criteria: dataset.criteria,
    options: dataset.options,
    scenarios: dataset.scenarios,
    weights,
    lockedIds,
    activeScenarioId,
    activeOptionIds,
    activeOptions,
    engineResult,
    setCriterionWeight,
    toggleLock,
    applyScenario,
    toggleOption,
    resetToDefaults,
    switchDataset,
  };
}
