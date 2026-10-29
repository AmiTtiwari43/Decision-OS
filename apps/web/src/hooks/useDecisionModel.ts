import { useState, useMemo, useCallback, useRef } from 'react';
import type { DecisionDataset, Option, Criterion, EngineResult } from '../types/decision.js';
import { runDecisionEngine, normalizeWeights } from '../utils/decisionEngine.js';
import { mapServerAnalysisToEngineResult } from '../utils/engineMapper.js';
import { primaryJobOfferDataset } from '../data/decisionData.js';
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

export function reconstructDatasetFromDto(doc: DecisionDto): DecisionDataset {
  const palette = ['#B8FF5A', '#38BDF8', '#F59E0B', '#FB7185', '#A78BFA'];
  const borderPalette = [
    'border-signal',
    'border-sky-500',
    'border-amber-500',
    'border-rose-500',
    'border-purple-500',
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
      const color = o.color || palette[idx % palette.length];
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
        scores: optScores,
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

  const scores: ScoreMatrixDto = {};
  for (const opt of dataset.options) {
    scores[opt.id] = {};
    for (const crit of dataset.criteria) {
      scores[opt.id][crit.id] = opt.scores[crit.id] ?? 0;
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
    return normalizeWeights(initial, initialDataset.criteria);
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
  const [currentUserRole, setCurrentUserRole] = useState<'owner' | 'editor' | 'viewer'>('owner');
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<OperationStatus>('idle');
  const [loadStatus, setLoadStatus] = useState<OperationStatus>('idle');
  const [apiError, setApiError] = useState<ApiClientError | null>(null);

  // Stale request race-condition guards
  const saveSeqRef = useRef<number>(0);
  const loadSeqRef = useRef<number>(0);

  const activeOptions = useMemo(() => {
    return dataset.options.filter((o) => activeOptionIds.includes(o.id));
  }, [dataset.options, activeOptionIds]);

  // Authoritative server-side result vs optimistic local preview
  const engineResult = useMemo((): EngineResult => {
    const isAuthoritative = mode === 'saved' && !isDirty && serverDecision?.analysis != null;

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
  }, [mode, isDirty, serverDecision, activeOptions, dataset.criteria, weights, lockedIds]);

  const setCriterionWeight = useCallback(
    (criterionId: string, newWeight: number) => {
      setActiveScenarioId(null);
      setIsDirty(true);
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
    setIsDirty(true);
    setLockedIds((prev) =>
      prev.includes(criterionId) ? prev.filter((id) => id !== criterionId) : [...prev, criterionId]
    );
  }, []);

  const applyScenario = useCallback(
    (scenarioId: string) => {
      const scenario = dataset.scenarios.find((s) => s.id === scenarioId);
      if (!scenario) return;

      setActiveScenarioId(scenarioId);
      setLockedIds([]);
      setIsDirty(true);
      const normalized = normalizeWeights(scenario.weights, dataset.criteria);
      setWeightsState(normalized);
    },
    [dataset.scenarios, dataset.criteria]
  );

  const toggleOption = useCallback((optionId: string) => {
    setIsDirty(true);
    setActiveOptionIds((prev) => {
      if (prev.includes(optionId)) {
        if (prev.length <= 2) return prev;
        return prev.filter((id) => id !== optionId);
      } else {
        return [...prev, optionId];
      }
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    setActiveScenarioId('career-first');
    setLockedIds([]);
    setIsDirty(mode === 'saved');
    const initial: Record<string, number> = {};
    dataset.criteria.forEach((c) => {
      initial[c.id] = c.defaultWeight;
    });
    setWeightsState(normalizeWeights(initial, dataset.criteria));
    setActiveOptionIds(dataset.options.slice(0, 2).map((o) => o.id));
  }, [dataset, mode]);

  const switchDataset = useCallback((newDataset: DecisionDataset) => {
    setDatasetState(newDataset);
    setActiveScenarioId(newDataset.scenarios[0]?.id || null);
    setLockedIds([]);
    setMode('template');
    setDecisionId(null);
    setServerDecision(null);
    setIsDirty(false);
    setApiError(null);

    const initial: Record<string, number> = {};
    newDataset.criteria.forEach((c) => {
      initial[c.id] = c.defaultWeight;
    });
    setWeightsState(normalizeWeights(initial, newDataset.criteria));
    setActiveOptionIds(newDataset.options.slice(0, 2).map((o) => o.id));
  }, []);

  const updateOptionScore = useCallback(
    (optionId: string, criterionId: string, rawScore: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(rawScore)));
      setDatasetState((prev) => ({
        ...prev,
        options: prev.options.map((opt) => {
          if (opt.id !== optionId) return opt;
          return {
            ...opt,
            scores: {
              ...opt.scores,
              [criterionId]: clamped,
            },
          };
        }),
      }));
      setIsDirty(true);
    },
    []
  );

  const updateDecisionMetadata = useCallback((title: string, context?: string) => {
    setDatasetState((prev) => ({
      ...prev,
      title: title.trim(),
      question: title.trim(),
      context: context !== undefined ? context.trim() : prev.context,
    }));
    setIsDirty(true);
  }, []);

  const createNewDecision = useCallback(
    (custom?: { title?: string; question?: string; context?: string }) => {
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

      const initWeights: Record<string, number> = { 'crit-1': 50, 'crit-2': 50 };
      setWeightsState(initWeights);
    },
    []
  );

  const clearApiError = useCallback(() => {
    setApiError(null);
  }, []);

  /**
   * Saves the current decision to the backend database via POST or PUT /api/decisions.
   * Concurrency-safe: duplicate submissions while in-flight are prevented.
   * User input is strictly preserved upon any failure.
   */
  const saveDecision = useCallback(async (): Promise<DecisionDto | null> => {
    if (saveStatus === 'in_flight') {
      return null;
    }

    const currentSeq = ++saveSeqRef.current;
    setSaveStatus('in_flight');
    setApiError(null);

    const payload = buildPayloadFromState(dataset, weights, lockedIds);

    try {
      let savedDoc: DecisionDto;

      if (decisionId) {
        // Update existing decision
        savedDoc = await apiClient.updateDecision(decisionId, payload as UpdateDecisionPayload);
        // If analysis is null on the returned doc, explicitly trigger analysis
        if (!savedDoc.analysis) {
          savedDoc = await apiClient.analyzeDecision(decisionId);
        }
      } else {
        // Create new decision
        savedDoc = await apiClient.createDecision(payload);
        // If not analyzed during creation, trigger analysis
        if (!savedDoc.analysis) {
          savedDoc = await apiClient.analyzeDecision(savedDoc._id);
        }
      }

      // Check if a newer save was initiated while awaiting
      if (currentSeq !== saveSeqRef.current) {
        return savedDoc;
      }

      setServerDecision(savedDoc);
      setDecisionId(savedDoc._id);
      setMode('saved');
      setIsDirty(false);
      setSaveStatus('success');
      return savedDoc;
    } catch (err: unknown) {
      if (currentSeq !== saveSeqRef.current) {
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

      setApiError(clientErr);
      setSaveStatus('error');
      // Preserves dataset and weights intact for user correction/retry
      return null;
    }
  }, [saveStatus, dataset, weights, lockedIds, decisionId]);

  /**
   * Retrieves an authoritative persisted decision by ID via GET /api/decisions/:id.
   */
  const loadDecision = useCallback(async (id: string): Promise<DecisionDto | null> => {
    if (loadStatus === 'in_flight') {
      return null;
    }

    const currentSeq = ++loadSeqRef.current;
    setLoadStatus('in_flight');
    setApiError(null);

    try {
      let doc = await apiClient.getDecision(id);

      // If document lacks analysis, run server-side analysis
      if (!doc.analysis && doc.criteria.length > 0 && doc.options.length > 0) {
        try {
          doc = await apiClient.analyzeDecision(doc._id);
        } catch {
          // If analysis fails, we still load the doc
        }
      }

      if (currentSeq !== loadSeqRef.current) {
        return doc;
      }

      const reconstructed = reconstructDatasetFromDto(doc);
      setDatasetState(reconstructed);

      // Reconstruct weights from doc.criteria
      const newWeights: Record<string, number> = {};
      doc.criteria.forEach((c) => {
        newWeights[c.id] = c.weight;
      });
      setWeightsState(newWeights);

      // Reconstruct locked criteria
      const newLocked = doc.criteria.filter((c) => c.isLocked).map((c) => c.id);
      setLockedIds(newLocked);

      // Activate all options returned from the server
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
      if (currentSeq !== loadSeqRef.current) {
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
  }, [loadStatus]);

  /**
   * Lists persisted decisions for browsing and history selection.
   */
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
    // Phase 4 API extensions
    mode,
    decisionId,
    serverDecision,
    currentUserRole,
    isDirty,
    isAuthoritative: mode === 'saved' && !isDirty && serverDecision?.analysis != null,
    saveStatus,
    loadStatus,
    apiError,
    saveDecision,
    loadDecision,
    listSavedDecisions,
    createNewDecision,
    updateOptionScore,
    updateDecisionMetadata,
    clearApiError,
  };
}
