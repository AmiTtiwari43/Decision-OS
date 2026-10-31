import { evaluateDecision } from './index';
import type {
  EngineCriterion,
  EngineOption,
  ContributorSubmissionInput,
  CriterionDisagreementMetrics,
  DisagreementIntelligenceItem,
  DisagreementIntelligenceResult,
} from './types';

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

const EPSILON = 1e-9;

/**
 * Calculates sample standard deviation (Bessel's correction n-1)
 */
export function calculateSampleStdDev(values: number[]): number | null {
  if (values.length < 2) return values.length === 1 ? 0 : null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return round1(Math.sqrt(variance));
}

/**
 * Calculates exact statistical median
 */
export function calculateMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return round1(sorted[mid]);
  }
  return round1((sorted[mid - 1] + sorted[mid]) / 2.0);
}

/**
 * Calculates confidence-weighted mean
 */
export function calculateConfidenceWeightedMean(
  scores: number[],
  confidences: number[]
): number | null {
  if (scores.length === 0) return null;
  let weightedSum = 0;
  let totalConfidence = 0;

  for (let i = 0; i < scores.length; i++) {
    const conf = Math.max(0, Math.min(1, confidences[i] ?? 1.0));
    weightedSum += scores[i] * conf;
    totalConfidence += conf;
  }

  if (totalConfidence <= EPSILON) {
    const unweightedMean = scores.reduce((a, b) => a + b, 0) / scores.length;
    return round1(unweightedMean);
  }

  return round1(weightedSum / totalConfidence);
}

export interface AnalyzeDisagreementsInput {
  readonly criteria: ReadonlyArray<EngineCriterion>;
  readonly options: ReadonlyArray<EngineOption>;
  readonly contributions: ReadonlyArray<ContributorSubmissionInput>;
  readonly lockedIds?: ReadonlyArray<string>;
}

/**
 * Analyzes structured disagreements across expert contributions against authoritative MCDA inputs.
 * Deterministically computes score dispersion, confidence-weighted statistics, and evaluates
 * whether disagreements are decision-critical by checking tipping thresholds and running Min/Median/Max scenarios.
 */
export function analyzeDisagreements(
  input: AnalyzeDisagreementsInput
): DisagreementIntelligenceResult {
  const { criteria, options, contributions, lockedIds = [] } = input;
  const totalContributors = contributions.length;
  const hasSufficientData = totalContributors >= 2;

  // Step 1: Base Authoritative MCDA Evaluation
  let baseWinnerId: string | null = null;
  let baseWinnerName: string = 'None';
  let baseRunnerUpId: string | null = null;
  let baseLead = 0;
  let normalizedWeights: Record<string, number> = {};

  const optNameMap = new Map<string, string>();
  for (const o of options) {
    optNameMap.set(o.id, o.name);
  }

  const critNameMap = new Map<string, string>();
  for (const c of criteria) {
    critNameMap.set(c.id, c.name);
  }

  if (options.length >= 2 && criteria.length >= 1) {
    try {
      const baseEval = evaluateDecision({
        criteria: criteria as EngineCriterion[],
        options: options as EngineOption[],
        lockedIds: lockedIds as string[],
      });
      baseWinnerId = baseEval.winnerId;
      baseWinnerName = baseWinnerId ? optNameMap.get(baseWinnerId) || baseWinnerId : 'Tie';
      baseLead = baseEval.pointLead;
      normalizedWeights = { ...baseEval.normalizedWeights };
      if (baseEval.evaluations.length > 1) {
        baseRunnerUpId = baseEval.evaluations[1].optionId;
      }
    } catch {
      // Base evaluation not available due to incomplete inputs
    }
  }

  if (!hasSufficientData) {
    return {
      hasSufficientData: false,
      totalContributors,
      totalDisagreements: 0,
      decisionCriticalCount: 0,
      criteriaMetrics: [],
      items: [],
      priorityBreakdown: [],
      summary:
        totalContributors === 1
          ? 'Single expert contribution submitted. At least 2 submitted contributions are required to identify disagreements.'
          : 'No submitted expert contributions available for disagreement analysis.',
    };
  }

  const items: DisagreementIntelligenceItem[] = [];
  const criteriaMetrics: CriterionDisagreementMetrics[] = [];
  let decisionCriticalCount = 0;

  // Step 2: Per-Criterion Numerical Score Disagreements
  for (const crit of criteria) {
    const cId = crit.id;
    const cName = crit.name;
    const w = normalizedWeights[cId] ?? crit.weight;

    const scoresList: number[] = [];
    const confList: number[] = [];
    const contributorScoreEntries: Array<{
      contributorId: string;
      contributorName?: string;
      score: number;
      confidence?: number;
      reasoning?: string;
    }> = [];

    for (const contrib of contributions) {
      const s = contrib.scores[cId];
      if (typeof s === 'number' && Number.isFinite(s)) {
        scoresList.push(s);
        confList.push(contrib.confidence ?? 1.0);
        contributorScoreEntries.push({
          contributorId: contrib.contributorId,
          contributorName: contrib.contributorName,
          score: s,
          confidence: contrib.confidence ?? 1.0,
          reasoning: contrib.reasoning?.[cId],
        });
      }
    }

    if (scoresList.length < 2) {
      continue;
    }

    const minScore = round1(Math.min(...scoresList));
    const maxScore = round1(Math.max(...scoresList));
    const scoreRange = round1(maxScore - minScore);
    const meanScore = round1(scoresList.reduce((a, b) => a + b, 0) / scoresList.length);
    const sampleStdDev = calculateSampleStdDev(scoresList);
    const medianScore = calculateMedian(scoresList);
    const confidenceWeightedMean = calculateConfidenceWeightedMean(scoresList, confList);

    // Analytical Tipping Delta: deltaScore = (100 * baseLead) / w
    let tippingDeltaThreshold: number | null = null;
    if (w > EPSILON && baseLead >= 0) {
      tippingDeltaThreshold = round1((100.0 * baseLead) / w);
    }

    // Step 3: Run Deterministic Expert Scenarios (Min, Median, Max)
    let minScenarioWinnerId: string | null = null;
    let minScenarioWinnerFlips = false;
    let medianScenarioWinnerId: string | null = null;
    let medianScenarioWinnerFlips = false;
    let maxScenarioWinnerId: string | null = null;
    let maxScenarioWinnerFlips = false;

    if (baseWinnerId && options.length >= 2) {
      const runnerUpOption =
        (baseRunnerUpId ? options.find(o => o.id === baseRunnerUpId) : null) ||
        options.find(o => o.id !== baseWinnerId);

      // Pessimistic Scenario (Min): Replace base winner score on this criterion with minScore
      const minOptions = options.map(o => {
        if (o.id === baseWinnerId) {
          return { ...o, scores: { ...o.scores, [cId]: minScore } };
        }
        return o;
      });
      try {
        const minEval = evaluateDecision({
          criteria: criteria as EngineCriterion[],
          options: minOptions,
          lockedIds: lockedIds as string[],
        });
        minScenarioWinnerId = minEval.winnerId;
        minScenarioWinnerFlips = minEval.isTie || (minEval.winnerId !== null && minEval.winnerId !== baseWinnerId);
      } catch {
        // Fallback
      }

      // Central Scenario (Median): Replace base winner score with medianScore
      if (medianScore !== null) {
        const medOptions = options.map(o => {
          if (o.id === baseWinnerId) {
            return { ...o, scores: { ...o.scores, [cId]: medianScore } };
          }
          return o;
        });
        try {
          const medEval = evaluateDecision({
            criteria: criteria as EngineCriterion[],
            options: medOptions,
            lockedIds: lockedIds as string[],
          });
          medianScenarioWinnerId = medEval.winnerId;
          medianScenarioWinnerFlips = medEval.isTie || (medEval.winnerId !== null && medEval.winnerId !== baseWinnerId);
        } catch {
          // Fallback
        }
      }

      // Optimistic Scenario (Max): Challenger / RunnerUp receives maxScore
      if (runnerUpOption) {
        const maxOptions = options.map(o => {
          if (o.id === runnerUpOption.id) {
            return { ...o, scores: { ...o.scores, [cId]: maxScore } };
          }
          return o;
        });
        try {
          const maxEval = evaluateDecision({
            criteria: criteria as EngineCriterion[],
            options: maxOptions,
            lockedIds: lockedIds as string[],
          });
          maxScenarioWinnerId = maxEval.winnerId;
          maxScenarioWinnerFlips = maxEval.isTie || (maxEval.winnerId !== null && maxEval.winnerId !== baseWinnerId);
        } catch {
          // Fallback
        }
      }
    }

    // Decision-Criticality Check
    const rangeExceedsTipping =
      tippingDeltaThreshold !== null && tippingDeltaThreshold <= 100.0 && scoreRange >= tippingDeltaThreshold;
    const isDecisionCritical =
      scoreRange > 0 &&
      (minScenarioWinnerFlips || medianScenarioWinnerFlips || maxScenarioWinnerFlips || rangeExceedsTipping);

    let criticalReason = 'Score dispersion does not alter the winning alternative under any tested scenario.';
    if (isDecisionCritical) {
      decisionCriticalCount++;
      const reasons: string[] = [];
      if (rangeExceedsTipping) {
        reasons.push(
          `Score range (${scoreRange} pts) meets or exceeds tipping threshold (${tippingDeltaThreshold} pts)`
        );
      }
      if (minScenarioWinnerFlips) {
        const altName = minScenarioWinnerId ? optNameMap.get(minScenarioWinnerId) || minScenarioWinnerId : 'Tie';
        reasons.push(`Pessimistic scenario (min score ${minScore} pts) inverts winner to '${altName}'`);
      }
      if (maxScenarioWinnerFlips) {
        const altName = maxScenarioWinnerId ? optNameMap.get(maxScenarioWinnerId) || maxScenarioWinnerId : 'Tie';
        reasons.push(`Optimistic scenario (max score ${maxScore} pts) inverts winner to '${altName}'`);
      }
      criticalReason = reasons.join('; ');
    }

    const metric: CriterionDisagreementMetrics = {
      criterionId: cId,
      criterionName: cName,
      weight: w,
      sampleCount: scoresList.length,
      minScore,
      maxScore,
      scoreRange,
      meanScore,
      sampleStdDev,
      medianScore,
      confidenceWeightedMean,
      isDecisionCritical,
      tippingDeltaThreshold,
      criticalReason,
      scenarioResults: {
        minScenarioWinnerId,
        minScenarioWinnerFlips,
        medianScenarioWinnerId,
        medianScenarioWinnerFlips,
        maxScenarioWinnerId,
        maxScenarioWinnerFlips,
      },
    };
    criteriaMetrics.push(metric);

    // Only create a score disagreement item if range > 0
    if (scoreRange > 0) {
      const numExplanation = `Spread of ${scoreRange} pts (min: ${minScore}, max: ${maxScore}, stdDev: ${sampleStdDev}) across ${scoresList.length} expert evaluations. Confidence-weighted mean: ${confidenceWeightedMean} pts (arithmetic mean: ${meanScore} pts). Tipping threshold: ${tippingDeltaThreshold !== null ? `${tippingDeltaThreshold} pts` : 'N/A'}. ${criticalReason}`;

      items.push({
        id: `disag_score_${cId}`,
        category: 'score',
        title: `Score Disagreement on '${cName}'`,
        criterionId: cId,
        criterionName: cName,
        isDecisionCritical,
        scoreMetrics: metric,
        description: `Experts differ by ${scoreRange} points on criterion '${cName}'. ${isDecisionCritical ? 'This disagreement is decision-critical and can alter the winning option.' : 'This disagreement is non-critical as the current winner remains invariant.'}`,
        numericalExplanation: numExplanation,
        participants: contributorScoreEntries.map(e => ({
          contributorId: e.contributorId,
          contributorName: e.contributorName,
          value: e.score,
          confidence: e.confidence,
          reasoning: e.reasoning,
        })),
        suggestedClarificationQuestions: [
          `What empirical benchmarks or operational assumptions justify a score of ${minScore} versus ${maxScore} on '${cName}'?`,
          `Would additional testing or external reference data help narrow the ${scoreRange}-point evaluation spread on '${cName}'?`,
        ],
      });
    }

    // Step 4: Interpretation Disagreements (Diverging Reasoning on Criterion)
    const reasoningEntries = contributorScoreEntries.filter(e => e.reasoning && e.reasoning.trim().length > 0);
    if (reasoningEntries.length >= 2 && scoreRange >= 15) {
      items.push({
        id: `disag_interp_${cId}`,
        category: 'interpretation',
        title: `Interpretation Divergence on '${cName}'`,
        criterionId: cId,
        criterionName: cName,
        isDecisionCritical,
        description: `Multiple contributors provided conflicting qualitative rationales regarding '${cName}'.`,
        numericalExplanation: `Qualitative reasoning diverges alongside a ${scoreRange}-point score spread between ${reasoningEntries.length} contributors.`,
        participants: reasoningEntries.map(e => ({
          contributorId: e.contributorId,
          contributorName: e.contributorName,
          value: e.score,
          confidence: e.confidence,
          reasoning: e.reasoning,
        })),
        suggestedClarificationQuestions: [
          `Do participants share the same definition of success for '${cName}'?`,
          `Can the underlying qualitative arguments be cross-verified against recorded evidence?`,
        ],
      });
    }
  }

  // Step 5: Priority Disagreements (Conflicting Preferred Options)
  const recMap = new Map<string, Array<{ contributorId: string; contributorName?: string; confidence?: number; reasoning?: string }>>();
  for (const contrib of contributions) {
    if (contrib.preferredOptionId) {
      const pId = contrib.preferredOptionId;
      if (!recMap.has(pId)) {
        recMap.set(pId, []);
      }
      recMap.get(pId)!.push({
        contributorId: contrib.contributorId,
        contributorName: contrib.contributorName,
        confidence: contrib.confidence,
        reasoning: contrib.reasoning?.general,
      });
    }
  }

  const priorityBreakdown: Array<{
    optionId: string;
    optionName: string;
    recommendationCount: number;
    percentage: number;
  }> = [];

  for (const [optId, recs] of recMap.entries()) {
    priorityBreakdown.push({
      optionId: optId,
      optionName: optNameMap.get(optId) || optId,
      recommendationCount: recs.length,
      percentage: round1((recs.length / totalContributors) * 100),
    });
  }
  priorityBreakdown.sort((a, b) => b.recommendationCount - a.recommendationCount);

  if (recMap.size > 1) {
    const isPriorityCritical = !baseWinnerId || Array.from(recMap.keys()).some(id => id !== baseWinnerId);
    if (isPriorityCritical) decisionCriticalCount++;

    const breakdownText = priorityBreakdown
      .map(p => `'${p.optionName}': ${p.recommendationCount} votes (${p.percentage}%)`)
      .join(', ');

    const participantsList: Array<{
      contributorId: string;
      contributorName?: string;
      value: string;
      confidence?: number;
      reasoning?: string;
    }> = [];

    for (const [optId, recs] of recMap.entries()) {
      const optName = optNameMap.get(optId) || optId;
      for (const r of recs) {
        participantsList.push({
          contributorId: r.contributorId,
          contributorName: r.contributorName,
          value: `Prefers ${optName}`,
          confidence: r.confidence,
          reasoning: r.reasoning,
        });
      }
    }

    items.push({
      id: 'disag_prio_options',
      category: 'priority',
      title: 'Divergent Preferred Alternatives',
      isDecisionCritical: isPriorityCritical,
      description: `Participants recommend ${recMap.size} distinct alternatives as their top choice.`,
      numericalExplanation: `Recommendation distribution across ${totalContributors} participants: ${breakdownText}. Authoritative MCDA leader is '${baseWinnerName}'.`,
      participants: participantsList,
      suggestedClarificationQuestions: [
        `What fundamental criteria trade-offs lead participants to favor different alternatives?`,
        `Would establishing minimum non-negotiable constraints help align stakeholder priorities?`,
      ],
    });
  }

  // Step 6: Assumption Disagreements (Significant Confidence Spreads)
  const confidences = contributions
    .map(c => c.confidence)
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c));

  if (confidences.length >= 2) {
    const minConf = Math.round(Math.min(...confidences) * 100) / 100;
    const maxConf = Math.round(Math.max(...confidences) * 100) / 100;
    const confSpread = Math.round((maxConf - minConf) * 100) / 100;

    if (confSpread >= 0.3) {
      items.push({
        id: 'disag_assump_confidence',
        category: 'assumption',
        title: 'Significant Confidence Disparity Across Participants',
        isDecisionCritical: false,
        description: `Self-reported confidence ranges from ${Math.round(minConf * 100)}% to ${Math.round(maxConf * 100)}% across contributors.`,
        numericalExplanation: `Confidence spread is ${Math.round(confSpread * 100)} percentage points (min: ${minConf}, max: ${maxConf}) across ${confidences.length} participants.`,
        participants: contributions.map(c => ({
          contributorId: c.contributorId,
          contributorName: c.contributorName,
          value: `${Math.round((c.confidence ?? 1.0) * 100)}% confidence`,
          confidence: c.confidence,
        })),
        suggestedClarificationQuestions: [
          `What unverified assumptions or data gaps cause lower confidence ratings for certain contributors?`,
          `What evidence would be required to increase participant confidence above 80%?`,
        ],
      });
    }
  }

  // Step 7: Evidence Disagreements (Disparate Evidence Citations)
  const evidenceUsageMap = new Map<string, string[]>();
  for (const contrib of contributions) {
    if (contrib.evidenceReferences && contrib.evidenceReferences.length > 0) {
      for (const ref of contrib.evidenceReferences) {
        if (!evidenceUsageMap.has(ref)) {
          evidenceUsageMap.set(ref, []);
        }
        evidenceUsageMap.get(ref)!.push(contrib.contributorName || contrib.contributorId);
      }
    }
  }

  const uniqueEvidenceCount = evidenceUsageMap.size;
  if (totalContributors >= 2 && uniqueEvidenceCount >= 2) {
    const sharedCount = Array.from(evidenceUsageMap.values()).filter(users => users.length > 1).length;
    if (sharedCount === 0 && uniqueEvidenceCount >= 2) {
      items.push({
        id: 'disag_evidence_silos',
        category: 'evidence',
        title: 'Isolated Evidence References (No Shared Citations)',
        isDecisionCritical: false,
        description: `Contributors rely on ${uniqueEvidenceCount} distinct evidence sources with zero overlapping citations.`,
        numericalExplanation: `${uniqueEvidenceCount} evidence references cited across ${totalContributors} contributors, but 0 references are shared by more than one participant.`,
        participants: contributions.map(c => ({
          contributorId: c.contributorId,
          contributorName: c.contributorName,
          value: `${c.evidenceReferences?.length ?? 0} citations`,
        })),
        suggestedClarificationQuestions: [
          `Should contributors cross-review citations used by peer experts to establish a shared factual baseline?`,
          `Are conflicting conclusions rooted in different sources of empirical data?`,
        ],
      });
    }
  }

  const summary = `Detected ${items.length} disagreements across ${totalContributors} participants (${decisionCriticalCount} decision-critical).`;

  return {
    hasSufficientData: true,
    totalContributors,
    totalDisagreements: items.length,
    decisionCriticalCount,
    criteriaMetrics,
    items,
    priorityBreakdown,
    summary,
  };
}
