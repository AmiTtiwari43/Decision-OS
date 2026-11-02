import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { DecisionDataset, Option, Criterion, EngineResult } from '../types/decision.js';
import { runDecisionEngine } from '../utils/decisionEngine.js';
import { mapServerAnalysisToEngineResult } from '../utils/engineMapper.js';
import { primaryJobOfferDataset } from '../data/decisionData.js';
import { normalizeWeights as canonicalNormalizeWeights } from '@decision-os/decision-engine';
import { getDecisionEvaluationStatus } from '../utils/decisionStatus.js';
import {
  apiClient,
  ApiClientError,
  type DecisionDto,
  type CreateDecisionPayload,
  type UpdateDecisionPayload,
  type ListDecisionsQuery,
  type PaginatedDecisionsDto,
  type DecisionCriterionDto,
  type DecisionOptionDto,
  type ScoreMatrixDto,
} from '../api/index.js';

export type DecisionMode = 'template' | 'draft' | 'saved';
export type OperationStatus = 'idle' | 'in_flight' | 'success' | 'error';

export interface MissingScoreCoordinate {
  optionId: string;
  criterionId: string;
  optionName: string;
  criterionName: string;
}

const PALETTE = ['#B8FF5A', '#38BDF8', '#F59E0B', '#FB7185', '#A78BFA', '#34D399', '#F472B6'];

/**
 * Normalizes criterion weights using the canonical engine's Hare-Niemeyer (Largest Remainder) algorithm.
 * Guarantees SUM(weights) = 100.0% exactly and preserves deterministic ID tie-breaking.
 */
export function computeCanonicalWeights(
  criteria: Criterion[],
  rawWeights: Record<string, number>,
  lockedIds: string[] = []
): Record<string, number> {
  if (criteria.length === 0) return {};
  const engineCriteria = criteria.map((c) => ({
    id: c.id,
    name: c.name,
    weight: Math.max(0, rawWeights[c.id] ?? c.defaultWeight ?? 0),
    isLocked: lockedIds.includes(c.id),
  }));
  return canonicalNormalizeWeights(engineCriteria, lockedIds);
}

// ─── Pure Dataset Transformation Helpers ─────────────────────────────────────

export function addAlternativeToDataset(
  dataset: DecisionDataset,
  name: string,
  tagline?: string,
  description?: string,
  color?: string
): { dataset: DecisionDataset; newOption: Option } {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Alternative name cannot be empty.');
  }
  if (dataset.options.some((o) => o.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`An alternative named "${trimmed}" already exists.`);
  }

  const newId = `opt-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const nextColor = color || PALETTE[dataset.options.length % PALETTE.length];

  const newOption: Option = {
    id: newId,
    name: trimmed,
    badge: (tagline || '').trim(),
    tagline: (tagline || '').trim(),
    description: (description || '').trim(),
    color: nextColor,
    accentBorder: 'border-slate-500',
    scores: {}, // Strictly unpopulated / missing until entered
    strengths: [],
    vulnerabilities: [],
  };

  return {
    dataset: {
      ...dataset,
      options: [...dataset.options, newOption],
    },
    newOption,
  };
}

export function renameAlternativeInDataset(
  dataset: DecisionDataset,
  optionId: string,
  newName: string
): DecisionDataset {
  const trimmed = newName.trim();
  if (!trimmed) {
    throw new Error('Alternative name cannot be empty.');
  }
  if (
    dataset.options.some(
      (o) => o.id !== optionId && o.name.toLowerCase() === trimmed.toLowerCase()
    )
  ) {
    throw new Error(`An alternative named "${trimmed}" already exists.`);
  }

  return {
    ...dataset,
    options: dataset.options.map((o) => (o.id === optionId ? { ...o, name: trimmed } : o)),
  };
}

export function updateAlternativeInDataset(
  dataset: DecisionDataset,
  optionId: string,
  updates: { name?: string; tagline?: string; description?: string; color?: string }
): DecisionDataset {
  if (updates.name !== undefined) {
    const trimmed = updates.name.trim();
    if (!trimmed) {
      throw new Error('Alternative name cannot be empty.');
    }
    if (
      dataset.options.some(
        (o) => o.id !== optionId && o.name.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      throw new Error(`An alternative named "${trimmed}" already exists.`);
    }
  }

  return {
    ...dataset,
    options: dataset.options.map((o) => {
      if (o.id !== optionId) return o;
      return {
        ...o,
        name: updates.name !== undefined ? updates.name.trim() : o.name,
        tagline: updates.tagline !== undefined ? updates.tagline.trim() : o.tagline,
        badge: updates.tagline !== undefined ? updates.tagline.trim() : o.badge,
        description: updates.description !== undefined ? updates.description.trim() : o.description,
        color: updates.color !== undefined ? updates.color : o.color,
      };
    }),
  };
}

export function removeAlternativeFromDataset(
  dataset: DecisionDataset,
  optionId: string
): DecisionDataset {
  return {
    ...dataset,
    options: dataset.options.filter((o) => o.id !== optionId),
  };
}

export function addCriterionToDataset(
  dataset: DecisionDataset,
  rawWeights: Record<string, number>,
  lockedIds: string[],
  name: string,
  category?: Criterion['category'],
  initialWeight?: number,
  shortName?: string,
  description?: string
): { dataset: DecisionDataset; newCriterion: Criterion; weights: Record<string, number> } {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Criterion name cannot be empty.');
  }
  if (dataset.criteria.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`A criterion named "${trimmed}" already exists.`);
  }

  const newId = `crit-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const categories: Criterion['category'][] = ['growth', 'finance', 'lifestyle', 'risk', 'execution'];
  const assignedCat = category || categories[dataset.criteria.length % categories.length];

  const newCriterion: Criterion = {
    id: newId,
    name: trimmed,
    shortName: (shortName || trimmed).trim(),
    description: (description || '').trim(),
    category: assignedCat,
    defaultWeight: initialWeight ?? 10,
  };

  const nextCriteria = [...dataset.criteria, newCriterion];
  const nextRawWeights = { ...rawWeights, [newId]: initialWeight ?? 10 };
  const normalized = computeCanonicalWeights(nextCriteria, nextRawWeights, lockedIds);

  return {
    dataset: {
      ...dataset,
      criteria: nextCriteria,
    },
    newCriterion,
    weights: normalized,
  };
}

export function renameCriterionInDataset(
  dataset: DecisionDataset,
  criterionId: string,
  newName: string
): DecisionDataset {
  const trimmed = newName.trim();
  if (!trimmed) {
    throw new Error('Criterion name cannot be empty.');
  }
  if (
    dataset.criteria.some(
      (c) => c.id !== criterionId && c.name.toLowerCase() === trimmed.toLowerCase()
    )
  ) {
    throw new Error(`A criterion named "${trimmed}" already exists.`);
  }

  return {
    ...dataset,
    criteria: dataset.criteria.map((c) =>
      c.id === criterionId ? { ...c, name: trimmed, shortName: trimmed } : c
    ),
  };
}

export function updateCriterionInDataset(
  dataset: DecisionDataset,
  criterionId: string,
  updates: {
    name?: string;
    shortName?: string;
    description?: string;
    category?: Criterion['category'];
  }
): DecisionDataset {
  if (updates.name !== undefined) {
    const trimmed = updates.name.trim();
    if (!trimmed) {
      throw new Error('Criterion name cannot be empty.');
    }
    if (
      dataset.criteria.some(
        (c) => c.id !== criterionId && c.name.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      throw new Error(`A criterion named "${trimmed}" already exists.`);
    }
  }

  return {
    ...dataset,
    criteria: dataset.criteria.map((c) => {
      if (c.id !== criterionId) return c;
      return {
        ...c,
        name: updates.name !== undefined ? updates.name.trim() : c.name,
        shortName: updates.shortName !== undefined ? updates.shortName.trim() : c.shortName,
        description: updates.description !== undefined ? updates.description.trim() : c.description,
        category: updates.category !== undefined ? updates.category : c.category,
      };
    }),
  };
}

export function removeCriterionFromDataset(
  dataset: DecisionDataset,
  rawWeights: Record<string, number>,
  lockedIds: string[],
  criterionId: string
): { dataset: DecisionDataset; lockedIds: string[]; weights: Record<string, number> } {
  const nextCriteria = dataset.criteria.filter((c) => c.id !== criterionId);
  const nextLocked = lockedIds.filter((id) => id !== criterionId);
  const nextRawWeights = { ...rawWeights };
  delete nextRawWeights[criterionId];

  // Clean up score entries for this criterion across all options
  const nextOptions = dataset.options.map((opt) => {
    const nextScores = { ...opt.scores };
    delete nextScores[criterionId];
    return { ...opt, scores: nextScores };
  });

  const normalized =
    nextCriteria.length > 0
      ? computeCanonicalWeights(nextCriteria, nextRawWeights, nextLocked)
      : {};

  return {
    dataset: {
      ...dataset,
      criteria: nextCriteria,
      options: nextOptions,
    },
    lockedIds: nextLocked,
    weights: normalized,
  };
}

export function updateOptionScoreInDataset(
  dataset: DecisionDataset,
  optionId: string,
  criterionId: string,
  rawScore: number | string | null | undefined
): DecisionDataset {
  return {
    ...dataset,
    options: dataset.options.map((opt) => {
      if (opt.id !== optionId) return opt;
      const newScores = { ...opt.scores };

      if (rawScore === '' || rawScore === null || rawScore === undefined) {
        delete newScores[criterionId];
      } else {
        const num = typeof rawScore === 'number' ? rawScore : Number(rawScore);
        newScores[criterionId] = num;
      }

      return {
        ...opt,
        scores: newScores,
      };
    }),
  };
}

export function getDatasetMissingScores(dataset: DecisionDataset): MissingScoreCoordinate[] {
  const missing: MissingScoreCoordinate[] = [];
  for (const opt of dataset.options) {
    for (const crit of dataset.criteria) {
      const val = opt.scores[crit.id];
      if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 100) {
        missing.push({
          optionId: opt.id,
          criterionId: crit.id,
          optionName: opt.name,
          criterionName: crit.name,
        });
      }
    }
  }
  return missing;
}

export function reconstructDatasetFromDto(doc: DecisionDto): DecisionDataset {
  const borderPalette = [
    'border-signal',
    'border-sky-500',
    'border-amber-500',
    'border-rose-500',
    'border-purple-500',
    'border-emerald-500',
    'border-pink-500',
  ];

  return {
    id: doc._id,
    title: doc.title,
    question: doc.description || doc.title,
    context: doc.description || '',
    criteria: doc.criteria.map((c, idx) => ({
      id: c.id,
      name: c.name,
      shortName: c.shortName || c.name,
      description: '',
      category: (['growth', 'finance', 'lifestyle', 'risk', 'execution'] as const)[idx % 5],
      defaultWeight: c.weight,
    })),
    options: doc.options.map((o, idx) => {
      const color = o.color || PALETTE[idx % PALETTE.length];
      const accentBorder = borderPalette[idx % borderPalette.length];
      const optScores = doc.scores?.[o.id] || {};
      return {
        id: o.id,
        name: o.name,
        badge: o.tagline || '',
        tagline: o.tagline || '',
        description: o.description || '',
        color,
        accentBorder,
        scores: { ...optScores },
        strengths: [],
        vulnerabilities: [],
      };
    }),
    scenarios: [],
  };
}

export function buildPayloadFromState(
  dataset: DecisionDataset,
  weights: Record<string, number>,
  lockedIds: string[]
): CreateDecisionPayload {
  const criteria: DecisionCriterionDto[] = dataset.criteria.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.shortName,
    weight: weights[c.id] ?? c.defaultWeight ?? 0,
    direction: 'benefit',
    isLocked: lockedIds.includes(c.id),
  }));

  const options: DecisionOptionDto[] = dataset.options.map((o) => ({
    id: o.id,
    name: o.name,
    tagline: o.tagline,
    description: o.description,
    color: o.color,
  }));

  // Strict score serialization: only send finite numbers in [0, 100].
  // NEVER silently coerce missing scores into zero.
  const scores: ScoreMatrixDto = {};
  for (const opt of dataset.options) {
    scores[opt.id] = {};
    for (const crit of dataset.criteria) {
      const val = opt.scores[crit.id];
      if (typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 100) {
        scores[opt.id][crit.id] = val;
      }
    }
  }

  return {
    title: dataset.title,
    description: dataset.context || dataset.question || '',
    criteria,
    options,
    scores,
  };
}

export function useDecisionModel(initialDataset: DecisionDataset = primaryJobOfferDataset) {
  const [dataset, setDatasetState] = useState<DecisionDataset>(initialDataset);

  const [weights, setWeightsState] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    initialDataset.criteria.forEach((c) => {
      initial[c.id] = c.defaultWeight;
    });
    return computeCanonicalWeights(initialDataset.criteria, initial);
  });

  const [lockedIds, setLockedIds] = useState<string[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>('career-first');
  const [activeOptionIds, setActiveOptionIds] = useState<string[]>(() =>
    initialDataset.options.slice(0, 2).map((o) => o.id)
  );

  // Persistence & API State
  const [mode, setMode] = useState<DecisionMode>('template');
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [serverDecision, setServerDecision] = useState<DecisionDto | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<'owner' | 'editor' | 'viewer' | 'contributor'>('owner');
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<OperationStatus>('idle');
  const [loadStatus, setLoadStatus] = useState<OperationStatus>('idle');
  const [apiError, setApiError] = useState<ApiClientError | null>(null);
  const [conflictState, setConflictState] = useState<{ isConflict: boolean; currentVersion?: number } | null>(null);

  // Stale request race-condition guards
  const saveSeqRef = useRef<number>(0);
  const loadSeqRef = useRef<number>(0);

  // Mutation sequence counter (F-B3-01) and unmount guard
  const mutationSeqRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const activeOptions = useMemo(() => {
    return dataset.options.filter((o) => activeOptionIds.includes(o.id));
  }, [dataset.options, activeOptionIds]);

  // Evaluates completeness: checks if every alternative has a finite valid score in [0, 100] for every criterion
  const getMissingScores = useCallback((): MissingScoreCoordinate[] => {
    return getDatasetMissingScores(dataset);
  }, [dataset]);

  const isScoreMatrixComplete = useCallback((): boolean => {
    if (dataset.criteria.length === 0 || dataset.options.length === 0) return false;
    return getMissingScores().length === 0;
  }, [dataset.criteria.length, dataset.options.length, getMissingScores]);

  // Determine if the current evaluation is authoritative, stale, or draft
  const isEvaluationStale = useMemo((): boolean => {
    if (isDirty) return true;
    if (!serverDecision) return false;
    const status = getDecisionEvaluationStatus(serverDecision);
    return status === 'stale';
  }, [isDirty, serverDecision]);

  const isAuthoritative = useMemo((): boolean => {
    if (mode !== 'saved' || isDirty || !serverDecision?.analysis) return false;
    const status = getDecisionEvaluationStatus(serverDecision);
    return status === 'decisive' || status === 'tie';
  }, [mode, isDirty, serverDecision]);

  // Authoritative server-side result vs optimistic local preview
  const engineResult = useMemo((): EngineResult => {
    if (isAuthoritative && serverDecision?.analysis) {
      return mapServerAnalysisToEngineResult(
        serverDecision.analysis,
        activeOptions,
        dataset.criteria
      );
    }

    // Local optimistic calculation preview
    const localResult = runDecisionEngine(activeOptions, dataset.criteria, weights, lockedIds);
    return {
      ...localResult,
      isAuthoritative: false,
    };
  }, [isAuthoritative, serverDecision, activeOptions, dataset.criteria, weights, lockedIds]);

  // Weight Calibration with Canonical Largest Remainder Normalization
  const setCriterionWeight = useCallback(
    (criterionId: string, newWeight: number) => {
      if (currentUserRole === 'viewer' || currentUserRole === 'contributor') return;

      mutationSeqRef.current += 1;
      setActiveScenarioId(null);
      setIsDirty(true);
      const clamped = Math.max(0, Math.min(100, Math.round(newWeight * 10) / 10));

      const newRawWeights = {
        ...weights,
        [criterionId]: clamped,
      };

      try {
        const normalized = computeCanonicalWeights(dataset.criteria, newRawWeights, lockedIds);
        setWeightsState(normalized);
      } catch {
        setWeightsState(newRawWeights);
      }
    },
    [currentUserRole, weights, lockedIds, dataset.criteria]
  );

  const toggleLock = useCallback(
    (criterionId: string) => {
      if (currentUserRole === 'viewer' || currentUserRole === 'contributor') return;
      mutationSeqRef.current += 1;
      setIsDirty(true);

      setLockedIds((prev) => {
        if (prev.includes(criterionId)) {
          const next = prev.filter((id) => id !== criterionId);
          try {
            setWeightsState(computeCanonicalWeights(dataset.criteria, weights, next));
          } catch {
            // retain current weights
          }
          return next;
        } else {
          // Verify sum of locked weights will not exceed 100%
          const currentWeight = weights[criterionId] ?? 0;
          const lockedSum = prev.reduce((sum, id) => sum + (weights[id] ?? 0), 0);
          if (lockedSum + currentWeight > 100.0) {
            return prev;
          }
          const next = [...prev, criterionId];
          try {
            setWeightsState(computeCanonicalWeights(dataset.criteria, weights, next));
          } catch {
            // retain current weights
          }
          return next;
        }
      });
    },
    [currentUserRole, dataset.criteria, weights]
  );

  const applyScenario = useCallback(
    (scenarioId: string) => {
      const scenario = dataset.scenarios.find((s) => s.id === scenarioId);
      if (!scenario) return;

      mutationSeqRef.current += 1;
      setActiveScenarioId(scenarioId);
      setLockedIds([]);
      setIsDirty(true);
      const normalized = computeCanonicalWeights(dataset.criteria, scenario.weights);
      setWeightsState(normalized);
    },
    [dataset.scenarios, dataset.criteria]
  );

  const toggleOption = useCallback((optionId: string) => {
    mutationSeqRef.current += 1;
    setIsDirty(true);
    setActiveOptionIds((prev) => {
      if (prev.includes(optionId)) {
        if (prev.length <= 1) return prev;
        return prev.filter((id) => id !== optionId);
      } else {
        return [...prev, optionId];
      }
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    if (currentUserRole === 'viewer' || currentUserRole === 'contributor') return;
    mutationSeqRef.current += 1;
    setActiveScenarioId('career-first');
    setLockedIds([]);
    setIsDirty(mode === 'saved');
    const initial: Record<string, number> = {};
    dataset.criteria.forEach((c) => {
      initial[c.id] = c.defaultWeight;
    });
    setWeightsState(computeCanonicalWeights(dataset.criteria, initial));
    setActiveOptionIds(dataset.options.map((o) => o.id));
  }, [currentUserRole, dataset, mode]);

  const switchDataset = useCallback((newDataset: DecisionDataset) => {
    mutationSeqRef.current += 1;
    setDatasetState(newDataset);
    setActiveScenarioId(newDataset.scenarios[0]?.id || null);
    setLockedIds([]);
    setMode('template');
    setDecisionId(null);
    setServerDecision(null);
    setIsDirty(false);
    setApiError(null);
    setConflictState(null);

    const initial: Record<string, number> = {};
    newDataset.criteria.forEach((c) => {
      initial[c.id] = c.defaultWeight;
    });
    setWeightsState(computeCanonicalWeights(newDataset.criteria, initial));
    setActiveOptionIds(newDataset.options.map((o) => o.id));
  }, []);

  // ─── Score Matrix Editing ──────────────────────────────────────────────────

  const updateOptionScore = useCallback(
    (optionId: string, criterionId: string, rawScore: number | string | null | undefined) => {
      if (currentUserRole === 'viewer' || currentUserRole === 'contributor') return;

      mutationSeqRef.current += 1;
      setDatasetState((prev) => updateOptionScoreInDataset(prev, optionId, criterionId, rawScore));
      setIsDirty(true);
    },
    [currentUserRole]
  );

  const updateDecisionMetadata = useCallback(
    (title: string, context?: string) => {
      if (currentUserRole === 'viewer' || currentUserRole === 'contributor') return;
      mutationSeqRef.current += 1;
      setDatasetState((prev) => ({
        ...prev,
        title: title.trim(),
        question: title.trim(),
        context: context !== undefined ? context.trim() : prev.context,
      }));
      setIsDirty(true);
    },
    [currentUserRole]
  );

  // ─── Phase 1: Alternatives Management CRUD ─────────────────────────────────

  const addAlternative = useCallback(
    (name: string, tagline?: string, description?: string, color?: string): Option => {
      if (currentUserRole === 'viewer' || currentUserRole === 'contributor') {
        throw new Error('You do not have permission to modify decision alternatives.');
      }
      const { dataset: nextDataset, newOption } = addAlternativeToDataset(
        dataset,
        name,
        tagline,
        description,
        color
      );
      mutationSeqRef.current += 1;
      setDatasetState(nextDataset);
      setActiveOptionIds((prev) => [...prev, newOption.id]);
      setIsDirty(true);
      return newOption;
    },
    [currentUserRole, dataset]
  );

  const renameAlternative = useCallback(
    (optionId: string, newName: string) => {
      if (currentUserRole === 'viewer' || currentUserRole === 'contributor') {
        throw new Error('You do not have permission to modify decision alternatives.');
      }
      mutationSeqRef.current += 1;
      setDatasetState((prev) => renameAlternativeInDataset(prev, optionId, newName));
      setIsDirty(true);
    },
    [currentUserRole]
  );

  const updateAlternative = useCallback(
    (
      optionId: string,
      updates: { name?: string; tagline?: string; description?: string; color?: string }
    ) => {
      if (currentUserRole === 'viewer' || currentUserRole === 'contributor') {
        throw new Error('You do not have permission to modify decision alternatives.');
      }
      mutationSeqRef.current += 1;
      setDatasetState((prev) => updateAlternativeInDataset(prev, optionId, updates));
      setIsDirty(true);
    },
    [currentUserRole]
  );

  const removeAlternative = useCallback(
    (optionId: string) => {
      if (currentUserRole === 'viewer' || currentUserRole === 'contributor') {
        throw new Error('You do not have permission to modify decision alternatives.');
      }
      mutationSeqRef.current += 1;
      setDatasetState((prev) => removeAlternativeFromDataset(prev, optionId));
      setActiveOptionIds((prev) => prev.filter((id) => id !== optionId));
      setIsDirty(true);
    },
    [currentUserRole]
  );

  // ─── Phase 2: Criteria Management CRUD ─────────────────────────────────────

  const addCriterion = useCallback(
    (
      name: string,
      category?: Criterion['category'],
      initialWeight?: number,
      shortName?: string,
      description?: string
    ): Criterion => {
      if (currentUserRole === 'viewer' || currentUserRole === 'contributor') {
        throw new Error('You do not have permission to modify decision criteria.');
      }
      const { dataset: nextDataset, newCriterion, weights: nextWeights } = addCriterionToDataset(
        dataset,
        weights,
        lockedIds,
        name,
        category,
        initialWeight,
        shortName,
        description
      );
      mutationSeqRef.current += 1;
      setDatasetState(nextDataset);
      setWeightsState(nextWeights);
      setIsDirty(true);
      return newCriterion;
    },
    [currentUserRole, dataset, weights, lockedIds]
  );

  const renameCriterion = useCallback(
    (criterionId: string, newName: string) => {
      if (currentUserRole === 'viewer' || currentUserRole === 'contributor') {
        throw new Error('You do not have permission to modify decision criteria.');
      }
      mutationSeqRef.current += 1;
      setDatasetState((prev) => renameCriterionInDataset(prev, criterionId, newName));
      setIsDirty(true);
    },
    [currentUserRole]
  );

  const updateCriterion = useCallback(
    (
      criterionId: string,
      updates: {
        name?: string;
        shortName?: string;
        description?: string;
        category?: Criterion['category'];
      }
    ) => {
      if (currentUserRole === 'viewer' || currentUserRole === 'contributor') {
        throw new Error('You do not have permission to modify decision criteria.');
      }
      mutationSeqRef.current += 1;
      setDatasetState((prev) => updateCriterionInDataset(prev, criterionId, updates));
      setIsDirty(true);
    },
    [currentUserRole]
  );

  const removeCriterion = useCallback(
    (criterionId: string) => {
      if (currentUserRole === 'viewer' || currentUserRole === 'contributor') {
        throw new Error('You do not have permission to modify decision criteria.');
      }
      const { dataset: nextDataset, lockedIds: nextLocked, weights: nextWeights } =
        removeCriterionFromDataset(dataset, weights, lockedIds, criterionId);
      mutationSeqRef.current += 1;
      setDatasetState(nextDataset);
      setLockedIds(nextLocked);
      setWeightsState(nextWeights);
      setIsDirty(true);
    },
    [currentUserRole, dataset, weights, lockedIds]
  );

  const createNewDecision = useCallback(
    (custom?: { title?: string; question?: string; context?: string }) => {
      mutationSeqRef.current += 1;
      const defaultCriteria: Criterion[] = [
        {
          id: 'crit-1',
          name: 'Core Priority 1',
          shortName: 'Priority 1',
          description: '',
          category: 'growth',
          defaultWeight: 50,
        },
        {
          id: 'crit-2',
          name: 'Core Priority 2',
          shortName: 'Priority 2',
          description: '',
          category: 'finance',
          defaultWeight: 50,
        },
      ];

      const defaultOptions: Option[] = [
        {
          id: 'opt-a',
          name: 'Option A',
          tagline: 'Leading candidate',
          description: '',
          color: '#B8FF5A',
          accentBorder: 'border-signal',
          scores: { 'crit-1': 85, 'crit-2': 75 },
          strengths: [],
          vulnerabilities: [],
        },
        {
          id: 'opt-b',
          name: 'Option B',
          tagline: 'Alternative approach',
          description: '',
          color: '#38BDF8',
          accentBorder: 'border-sky-500',
          scores: { 'crit-1': 70, 'crit-2': 90 },
          strengths: [],
          vulnerabilities: [],
        },
      ];

      const newDs: DecisionDataset = {
        id: `draft-${Date.now()}`,
        title: custom?.title || 'Custom Decision Evaluation',
        question: custom?.question || custom?.title || 'What is the best choice for this scenario?',
        context: custom?.context || 'Structured evaluation model',
        criteria: defaultCriteria,
        options: defaultOptions,
        scenarios: [],
      };

      setDatasetState(newDs);
      setMode('draft');
      setDecisionId(null);
      setServerDecision(null);
      setCurrentUserRole('owner');
      setIsDirty(true);
      setLockedIds([]);
      setActiveScenarioId(null);
      setActiveOptionIds(['opt-a', 'opt-b']);
      setApiError(null);
      setConflictState(null);

      const initWeights = computeCanonicalWeights(defaultCriteria, { 'crit-1': 50, 'crit-2': 50 });
      setWeightsState(initWeights);
    },
    []
  );

  const clearApiError = useCallback(() => {
    setApiError(null);
  }, []);

  const dismissConflict = useCallback(() => {
    setConflictState(null);
  }, []);

  // ─── Persistence & Authoritative Calculation ───────────────────────────────

  const saveDecision = useCallback(async (): Promise<DecisionDto | null> => {
    if (saveStatus === 'in_flight') {
      return null;
    }

    const currentSeq = ++saveSeqRef.current;
    const startMutationSeq = mutationSeqRef.current;
    setSaveStatus('in_flight');
    setApiError(null);
    setConflictState(null);

    const payload = buildPayloadFromState(dataset, weights, lockedIds);

    try {
      let savedDoc: DecisionDto;

      if (decisionId) {
        const updatePayload: UpdateDecisionPayload = {
          ...(payload as UpdateDecisionPayload),
          expectedVersion: serverDecision?.version,
        };
        savedDoc = await apiClient.updateDecision(decisionId, updatePayload);
      } else {
        savedDoc = await apiClient.createDecision(payload);
      }

      if (!isMountedRef.current) return null;

      if (currentSeq !== saveSeqRef.current) {
        return savedDoc;
      }

      setServerDecision(savedDoc);
      setDecisionId(savedDoc._id);
      setMode('saved');
      setSaveStatus('success');

      // Only mark clean if no newer mutations occurred while save was in flight
      if (mutationSeqRef.current === startMutationSeq) {
        setIsDirty(false);
      }
      return savedDoc;
    } catch (err: unknown) {
      if (!isMountedRef.current || currentSeq !== saveSeqRef.current) {
        return null;
      }

      const clientErr =
        err instanceof ApiClientError
          ? err
          : new ApiClientError({
              statusCode: 0,
              error: 'Client Error',
              message: (err as Error)?.message || 'An unexpected error occurred during save.',
              isNetworkError: true,
            });

      if (clientErr.statusCode === 409) {
        setConflictState({
          isConflict: true,
          currentVersion: (clientErr as any).currentVersion,
        });
      }

      setApiError(clientErr);
      setSaveStatus('error');
      return null;
    }
  }, [saveStatus, dataset, weights, lockedIds, decisionId, serverDecision]);

  const calculateAuthoritative = useCallback(async (): Promise<DecisionDto | null> => {
    if (currentUserRole === 'viewer' || currentUserRole === 'contributor') {
      const err = new ApiClientError({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Viewers and contributors are not permitted to execute authoritative MCDA calculations.',
      });
      setApiError(err);
      throw err;
    }

    if (dataset.criteria.length === 0 || dataset.options.length === 0) {
      const err = new ApiClientError({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Cannot calculate: Decision must have at least 1 criterion and at least 1 alternative.',
      });
      setApiError(err);
      throw err;
    }

    const missing = getMissingScores();
    if (missing.length > 0) {
      const err = new ApiClientError({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: `Cannot calculate: Decision has ${missing.length} missing score(s). Every alternative must have a finite score between 0 and 100 on every criterion.`,
        missingPairs: missing.map((m) => ({ optionId: m.optionId, criterionId: m.criterionId })),
      });
      setApiError(err);
      throw err;
    }

    if (saveStatus === 'in_flight') {
      return null;
    }

    const currentSeq = ++saveSeqRef.current;
    const startMutationSeq = mutationSeqRef.current;
    setSaveStatus('in_flight');
    setApiError(null);
    setConflictState(null);

    const payload = buildPayloadFromState(dataset, weights, lockedIds);

    try {
      let targetId = decisionId;
      if (!targetId) {
        const created = await apiClient.createDecision(payload);
        targetId = created._id;
      } else {
        const updatePayload: UpdateDecisionPayload = {
          ...(payload as UpdateDecisionPayload),
          expectedVersion: serverDecision?.version,
        };
        await apiClient.updateDecision(targetId, updatePayload);
      }

      // Execute authoritative backend MCDA analysis
      const analyzedDoc = await apiClient.analyzeDecision(targetId);

      if (!isMountedRef.current) return null;

      if (currentSeq !== saveSeqRef.current) {
        return analyzedDoc;
      }

      setServerDecision(analyzedDoc);
      setDecisionId(analyzedDoc._id);
      setMode('saved');
      setSaveStatus('success');

      // F-B3-01 Mutation sequence protection:
      // If user mutated inputs while calculation was in flight:
      // - Do NOT overwrite newer local inputs with older server data
      // - Do NOT mark clean (keep isDirty = true, which keeps isAuthoritative = false and isEvaluationStale = true)
      // - Preserve the newer local draft
      if (mutationSeqRef.current !== startMutationSeq) {
        return analyzedDoc;
      }

      // Clean execution: apply authoritative server state and mark clean
      setIsDirty(false);

      // Reconstruct local state with authoritative server data
      const reconstructed = reconstructDatasetFromDto(analyzedDoc);
      setDatasetState(reconstructed);

      const newWeights: Record<string, number> = {};
      analyzedDoc.criteria.forEach((c) => {
        newWeights[c.id] = c.weight;
      });
      setWeightsState(newWeights);

      const newLocked = analyzedDoc.criteria.filter((c) => c.isLocked).map((c) => c.id);
      setLockedIds(newLocked);
      setActiveOptionIds(analyzedDoc.options.map((o) => o.id));

      return analyzedDoc;
    } catch (err: unknown) {
      if (!isMountedRef.current || currentSeq !== saveSeqRef.current) return null;

      const clientErr =
        err instanceof ApiClientError
          ? err
          : new ApiClientError({
              statusCode: 0,
              error: 'Client Error',
              message: (err as Error)?.message || 'Failed to execute authoritative calculation.',
              isNetworkError: true,
            });

      if (clientErr.statusCode === 409) {
        setConflictState({
          isConflict: true,
          currentVersion: (clientErr as any).currentVersion,
        });
      }

      setApiError(clientErr);
      setSaveStatus('error');
      throw clientErr;
    }
  }, [
    currentUserRole,
    dataset,
    weights,
    lockedIds,
    decisionId,
    serverDecision,
    saveStatus,
    getMissingScores,
  ]);

  const loadDecision = useCallback(
    async (id: string): Promise<DecisionDto | null> => {
      if (loadStatus === 'in_flight') {
        return null;
      }

      const currentSeq = ++loadSeqRef.current;
      setLoadStatus('in_flight');
      setApiError(null);
      setConflictState(null);

      try {
        let doc = await apiClient.getDecision(id);

        if (!isMountedRef.current) return null;

        if (currentSeq !== loadSeqRef.current) {
          return doc;
        }

        const reconstructed = reconstructDatasetFromDto(doc);
        setDatasetState(reconstructed);

        const newWeights: Record<string, number> = {};
        doc.criteria.forEach((c) => {
          newWeights[c.id] = c.weight;
        });
        setWeightsState(newWeights);

        const newLocked = doc.criteria.filter((c) => c.isLocked).map((c) => c.id);
        setLockedIds(newLocked);
        setActiveOptionIds(doc.options.map((o) => o.id));

        setServerDecision(doc);
        setDecisionId(doc._id);
        setCurrentUserRole(doc.currentUserRole || 'owner');
        setMode('saved');
        setIsDirty(false);
        setActiveScenarioId(null);
        setLoadStatus('success');
        return doc;
      } catch (err: unknown) {
        if (!isMountedRef.current || currentSeq !== loadSeqRef.current) {
          return null;
        }

        const clientErr =
          err instanceof ApiClientError
            ? err
            : new ApiClientError({
                statusCode: 0,
                error: 'Client Error',
                message: (err as Error)?.message || 'Failed to retrieve decision.',
                isNetworkError: true,
              });

        setApiError(clientErr);
        setLoadStatus('error');
        return null;
      }
    },
    [loadStatus]
  );

  const listSavedDecisions = useCallback(
    async (query?: ListDecisionsQuery): Promise<PaginatedDecisionsDto> => {
      return apiClient.listDecisions(query);
    },
    []
  );

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
    mode,
    decisionId,
    serverDecision,
    currentUserRole,
    isDirty,
    isAuthoritative,
    isEvaluationStale,
    saveStatus,
    loadStatus,
    apiError,
    conflictState,
    dismissConflict,
    saveDecision,
    loadDecision,
    listSavedDecisions,
    createNewDecision,
    updateOptionScore,
    updateDecisionMetadata,
    clearApiError,

    // Batch 3 CRUD & Authoritative Calculation Extensions
    addAlternative,
    renameAlternative,
    updateAlternative,
    removeAlternative,
    addCriterion,
    renameCriterion,
    updateCriterion,
    removeCriterion,
    calculateAuthoritative,
    getMissingScores,
    isScoreMatrixComplete,

    // Mutation Sequence & Operation In-Flight Protection (F-B3-01 & F-B3-04)
    getMutationSeq: () => mutationSeqRef.current,
    isOperationInFlight: saveStatus === 'in_flight',
  };
}
