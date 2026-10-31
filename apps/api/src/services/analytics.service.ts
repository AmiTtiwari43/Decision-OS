import mongoose from 'mongoose';
import {
  evaluateDecision,
  runMonteCarloSimulation,
  calculateOptionScoreSensitivity,
  calculateMultiParameterCounterfactual,
} from '@decision-os/decision-engine';
import type {
  EngineResult,
  CounterfactualWeightShift,
} from '@decision-os/decision-engine';
import { decisionRepository } from '../repositories/decision.repository.js';
import { decisionAccessRepository } from '../repositories/decisionAccess.repository.js';
import { analyticsRepository } from '../repositories/analytics.repository.js';
import { authorizeDecisionAction } from './authorization.service.js';
import {
  validateCompleteness,
  mapToEngineInput,
  type RequesterContext,
} from './decision.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
} from '../errors/domain.errors.js';

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

export interface DecisionAnalyticsOptions {
  includeMonteCarlo?: boolean;
  iterations?: number;
  seed?: number;
  sigmaRelative?: number;
}

export interface WorkspaceAnalyticsQuery {
  startDate?: string;
  endDate?: string;
}

export interface DecisionAnalyticsDto {
  decisionId: string;
  title: string;
  description: string;
  evaluatedAt: string | null;
  outcome: 'decisive' | 'tie' | 'unscored';
  isAuthoritative: boolean;
  pointLead: number;
  winner: { id: string; name: string } | null;
  runnerUp: { id: string; name: string } | null;
  criteriaImportance: Array<{
    id: string;
    name: string;
    weight: number;
    isLocked: boolean;
    direction: 'benefit' | 'cost';
    relativeShare: number;
  }>;
  optionsPerformance: Array<{
    id: string;
    name: string;
    rank: number;
    weightedScore: number;
    unroundedScore: number;
    contributions: Array<{
      criterionId: string;
      criterionName: string;
      rawScore: number;
      weightedPoints: number;
      percentageOfTotal: number;
    }>;
  }>;
  sensitivityAnalysis: {
    analyticalTippingPoints: Array<{
      criterionId: string;
      criterionName: string;
      currentWeight: number;
      tippingPointWeight: number | null;
      weightDeltaNeeded: number | null;
      direction: 'increase' | 'decrease' | 'none';
      feasibility: 'low-threshold' | 'medium-threshold' | 'unreachable';
      wouldFlipToOptionId: string | null;
      wouldFlipToOptionName: string | null;
      summary: string;
    }>;
    optionScoreSensitivity: Array<{
      criterionId: string;
      criterionName: string;
      weight: number;
      scoreDeltaNeeded: number | null;
      leaderThresholdScore: number | null;
      challengerThresholdScore: number | null;
      feasibility: 'feasible' | 'unreachable';
      summary: string;
    }>;
    multiParameterCounterfactual: {
      isFeasible: boolean;
      totalWeightShiftL1: number;
      netShiftAmount: number;
      shifts: ReadonlyArray<CounterfactualWeightShift>;
      targetOptionId: string | null;
      targetOptionName: string | null;
      summary: string;
    };
  };
  uncertaintyAnalysis: {
    hasMonteCarlo: boolean;
    iterations: number;
    seed: number;
    sigmaRelative: number;
    distributionModel: 'Gaussian Box-Muller on unlocked weights';
    metricInterpretation: 'win probability under the specified uncertainty model';
    robustnessRating: 'robust' | 'moderate' | 'sensitive' | 'unavailable';
    dominantOptionId: string | null;
    dominantWinProbability: number | null;
    optionResults: Array<{
      optionId: string;
      optionName: string;
      winCount: number;
      winProbability: number;
    }>;
  };
  evidenceCoverage: {
    totalEvidenceCount: number;
    byTargetType: {
      decision: number;
      option: number;
      criterion: number;
      contribution: number;
    };
    bySourceType: {
      url: number;
      document: number;
      excerpt: number;
    };
    optionsCoverage: Array<{
      optionId: string;
      optionName: string;
      evidenceCount: number;
      hasEvidence: boolean;
    }>;
    criteriaCoverage: Array<{
      criterionId: string;
      criterionName: string;
      evidenceCount: number;
      hasEvidence: boolean;
    }>;
    missingEvidenceTargets: {
      options: Array<{ id: string; name: string }>;
      criteria: Array<{ id: string; name: string }>;
    };
    methodologyDisclaimer: string;
  };
  expertParticipation: {
    totalContributions: number;
    submittedCount: number;
    draftCount: number;
    withdrawnCount: number;
    isRoundLocked: boolean;
    roundLockedAt: string | null;
    recommendationTally: Array<{
      optionId: string;
      optionName: string;
      count: number;
    }>;
    scoreSpreadByCriterion: Array<{
      criterionId: string;
      criterionName: string;
      minScore: number | null;
      maxScore: number | null;
      averageScore: number | null;
      scoreRange: number | null;
    }>;
    methodologyDisclaimer: string;
  };
}

export interface WorkspaceAnalyticsDto {
  generatedAt: string;
  timeframe: {
    startDate: string | null;
    endDate: string | null;
  };
  decisionMetrics: {
    totalDecisions: number;
    statusDistribution: {
      decisive: number;
      tie: number;
      unscored: number;
    };
    roundLockDistribution: {
      locked: number;
      open: number;
    };
    completionRate: number;
    averagePointLead: number | null;
  };
  activityTrends: Array<{
    period: string;
    createdCount: number;
  }>;
  criteriaAndOptionsMetrics: {
    totalCriteriaDefined: number;
    averageCriteriaPerDecision: number;
    totalOptionsDefined: number;
    averageOptionsPerDecision: number;
    topCriteriaNames: Array<{ name: string; count: number }>;
  };
  evidenceMetrics: {
    totalEvidenceRecords: number;
    decisionsWithEvidenceCount: number;
    decisionEvidenceCoverageRate: number;
    sourceTypeBreakdown: {
      url: number;
      document: number;
      excerpt: number;
    };
    methodologyDisclaimer: string;
  };
  deliberationMetrics: {
    totalContributions: number;
    submittedContributions: number;
    draftContributions: number;
    withdrawnContributions: number;
    decisionsWithContributionsCount: number;
    averageContributionsPerDecision: number;
    methodologyDisclaimer: string;
  };
}

export class AnalyticsService {
  /**
   * Retrieves comprehensive, multi-dimensional analytics for a specific decision.
   */
  async getDecisionAnalytics(
    decisionId: string,
    options: DecisionAnalyticsOptions = {},
    requester?: RequesterContext
  ): Promise<DecisionAnalyticsDto> {
    if (!decisionId || !mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    // Enforce read authorization (unrelated users receive 404 DecisionNotFoundError)
    await authorizeDecisionAction(decision, 'read', requester);

    // 1. Authoritative Engine Analysis Resolution
    const criteria = decision.criteria || [];
    const decisionOptions = decision.options || [];
    const missingPairs = validateCompleteness(criteria, decisionOptions, decision.scores);
    const isComplete = missingPairs.length === 0;

    let analysis: EngineResult | null = decision.analysis;
    const includeMonteCarlo = options.includeMonteCarlo !== false;
    const mcIterations = Math.max(100, Math.min(10000, options.iterations ?? 1000));
    const mcSeed = options.seed ?? 42;
    const mcSigma = Math.max(0.01, Math.min(0.5, options.sigmaRelative ?? 0.15));

    if (isComplete) {
      const lockedIds = criteria.filter(c => c.isLocked).map(c => c.id);
      const engineInput = mapToEngineInput(criteria, decisionOptions, decision.scores);

      if (!analysis) {
        analysis = evaluateDecision({
          ...engineInput,
          lockedIds,
          ...(includeMonteCarlo
            ? { monteCarloConfig: { iterations: mcIterations, seed: mcSeed, sigmaRelative: mcSigma } }
            : {}),
        });
      } else if (includeMonteCarlo && (!analysis.monteCarlo || analysis.monteCarlo.iterations !== mcIterations || analysis.monteCarlo.seed !== mcSeed)) {
        // Run on-demand Monte Carlo simulation with requested parameters
        const mcResult = runMonteCarloSimulation(
          engineInput.options,
          engineInput.criteria,
          analysis.normalizedWeights,
          lockedIds,
          { iterations: mcIterations, seed: mcSeed, sigmaRelative: mcSigma }
        );
        analysis = { ...analysis, monteCarlo: mcResult };
      }
    }

    const isAuthoritative = isComplete && analysis !== null;
    const outcome = !isAuthoritative || !analysis ? 'unscored' : analysis.decisionOutcome;
    const pointLead = analysis?.pointLead ?? 0;

    // Leader & Challenger resolution
    const leaderEval = analysis?.evaluations?.[0] ?? null;
    const runnerUpEval =
      analysis && analysis.evaluations && analysis.evaluations.length > 1 ? analysis.evaluations[1] : null;

    const leaderOption = leaderEval ? decisionOptions.find(o => o.id === leaderEval.optionId) ?? null : null;
    const runnerUpOption = runnerUpEval ? decisionOptions.find(o => o.id === runnerUpEval.optionId) ?? null : null;

    const winner = leaderOption ? { id: leaderOption.id, name: leaderOption.name } : null;
    const runnerUp = runnerUpOption ? { id: runnerUpOption.id, name: runnerUpOption.name } : null;

    // Criteria importance
    const normWeights = analysis?.normalizedWeights ?? {};
    const totalW = Object.values(normWeights).reduce((a, b) => a + b, 0) || 100;
    const criteriaImportance = criteria.map(c => {
      const w = normWeights[c.id] ?? c.weight;
      return {
        id: c.id,
        name: c.name,
        weight: w,
        isLocked: !!c.isLocked,
        direction: c.direction,
        relativeShare: round1((w / totalW) * 100),
      };
    });

    // Options performance
    const critMap = new Map<string, string>();
    for (const c of criteria) {
      critMap.set(c.id, c.name);
    }

    const optMap = new Map<string, string>();
    for (const o of decisionOptions) {
      optMap.set(o.id, o.name);
    }

    const optionsPerformance = (analysis?.evaluations ?? []).map(evalItem => ({
      id: evalItem.optionId,
      name: evalItem.optionName,
      rank: evalItem.rank,
      weightedScore: evalItem.weightedScore,
      unroundedScore: evalItem.unroundedScore,
      contributions: evalItem.contributions.map(contrib => ({
        criterionId: contrib.criterionId,
        criterionName: critMap.get(contrib.criterionId) || contrib.criterionId,
        rawScore: contrib.rawScore,
        weightedPoints: contrib.weightedPoints,
        percentageOfTotal: contrib.percentageOfTotal,
      })),
    }));

    // Analytical sensitivity tipping points
    const analyticalTippingPoints = (analysis?.sensitivity ?? []).map(tp => ({
      criterionId: tp.criterionId,
      criterionName: critMap.get(tp.criterionId) || tp.criterionId,
      currentWeight: tp.currentWeight,
      tippingPointWeight: tp.tippingPointWeight,
      weightDeltaNeeded: tp.weightDeltaNeeded,
      direction: tp.direction,
      feasibility: tp.feasibility,
      wouldFlipToOptionId: tp.wouldFlipToOptionId,
      wouldFlipToOptionName: tp.wouldFlipToOptionId ? optMap.get(tp.wouldFlipToOptionId) || tp.wouldFlipToOptionId : null,
      summary: tp.summary,
    }));

    // Option-score sensitivity & Counterfactuals
    let optionScoreSensitivity: ReturnType<typeof calculateOptionScoreSensitivity> = [];
    let multiParameterCounterfactual: ReturnType<typeof calculateMultiParameterCounterfactual> = {
      isFeasible: false,
      totalWeightShiftL1: 0,
      netShiftAmount: 0,
      shifts: [],
      targetOptionId: null,
      targetOptionName: null,
      summary: 'Insufficient data for counterfactual calculation.',
    };

    if (isAuthoritative && leaderOption) {
      const engineLeader = {
        id: leaderOption.id,
        name: leaderOption.name,
        scores: decision.scores[leaderOption.id] || {},
      };
      const engineChallenger = runnerUpOption
        ? {
            id: runnerUpOption.id,
            name: runnerUpOption.name,
            scores: decision.scores[runnerUpOption.id] || {},
          }
        : null;

      const engineCriteria = criteria.map(c => ({
        id: c.id,
        name: c.name,
        shortName: c.shortName,
        weight: c.weight,
        isLocked: c.isLocked,
      }));

      optionScoreSensitivity = calculateOptionScoreSensitivity(
        engineLeader,
        engineChallenger,
        engineCriteria,
        normWeights
      );

      const lockedIds = criteria.filter(c => c.isLocked).map(c => c.id);
      multiParameterCounterfactual = calculateMultiParameterCounterfactual(
        engineLeader,
        engineChallenger,
        engineCriteria,
        normWeights,
        lockedIds
      );
    }

    // Monte Carlo Uncertainty
    const mc = analysis?.monteCarlo;
    const uncertaintyAnalysis: DecisionAnalyticsDto['uncertaintyAnalysis'] = {
      hasMonteCarlo: !!mc,
      iterations: mc?.iterations ?? mcIterations,
      seed: mc?.seed ?? mcSeed,
      sigmaRelative: mc?.sigmaRelative ?? mcSigma,
      distributionModel: 'Gaussian Box-Muller on unlocked weights',
      metricInterpretation: 'win probability under the specified uncertainty model',
      robustnessRating: mc?.robustnessRating ?? 'unavailable',
      dominantOptionId: mc?.dominantOptionId ?? null,
      dominantWinProbability: mc?.dominantWinProbability ?? null,
      optionResults: (mc?.optionResults ?? []).map(r => ({
        optionId: r.optionId,
        optionName: r.optionName,
        winCount: r.winCount,
        winProbability: r.winProbability,
      })),
    };

    // 2. Evidence Coverage Aggregation
    const evidenceAgg = await analyticsRepository.getDecisionEvidenceAggregation(decisionId);

    const optionsCoverage = decisionOptions.map(opt => {
      const count = evidenceAgg.targetCounts[`option:${opt.id}`] ?? 0;
      return {
        optionId: opt.id,
        optionName: opt.name,
        evidenceCount: count,
        hasEvidence: count > 0,
      };
    });

    const criteriaCoverage = criteria.map(crit => {
      const count = evidenceAgg.targetCounts[`criterion:${crit.id}`] ?? 0;
      return {
        criterionId: crit.id,
        criterionName: crit.name,
        evidenceCount: count,
        hasEvidence: count > 0,
      };
    });

    const missingEvidenceOptions = optionsCoverage.filter(o => !o.hasEvidence).map(o => ({ id: o.optionId, name: o.optionName }));
    const missingEvidenceCriteria = criteriaCoverage.filter(c => !c.hasEvidence).map(c => ({ id: c.criterionId, name: c.criterionName }));

    const evidenceCoverage: DecisionAnalyticsDto['evidenceCoverage'] = {
      totalEvidenceCount: evidenceAgg.totalCount,
      byTargetType: evidenceAgg.byTargetType,
      bySourceType: evidenceAgg.bySourceType,
      optionsCoverage,
      criteriaCoverage,
      missingEvidenceTargets: {
        options: missingEvidenceOptions,
        criteria: missingEvidenceCriteria,
      },
      methodologyDisclaimer:
        'Evidence coverage reflects the presence of documented citations and excerpts. Evidence quantity does NOT imply evidence credibility, accuracy, or quality.',
    };

    // 3. Expert Participation & Deliberation Aggregation
    const contribAgg = await analyticsRepository.getDecisionContributionAggregation(decisionId);

    const scoreSpreadByCriterion = criteria.map(crit => {
      const scores = contribAgg.criterionScores[crit.id] || [];
      if (scores.length === 0) {
        return {
          criterionId: crit.id,
          criterionName: crit.name,
          minScore: null,
          maxScore: null,
          averageScore: null,
          scoreRange: null,
        };
      }

      const minScore = Math.min(...scores);
      const maxScore = Math.max(...scores);
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      return {
        criterionId: crit.id,
        criterionName: crit.name,
        minScore: round1(minScore),
        maxScore: round1(maxScore),
        averageScore: round1(avg),
        scoreRange: round1(maxScore - minScore),
      };
    });

    const expertParticipation: DecisionAnalyticsDto['expertParticipation'] = {
      totalContributions: contribAgg.totalCount,
      submittedCount: contribAgg.submittedCount,
      draftCount: contribAgg.draftCount,
      withdrawnCount: contribAgg.withdrawnCount,
      isRoundLocked: !!decision.isContributionRoundLocked,
      roundLockedAt: decision.contributionRoundLockedAt ? decision.contributionRoundLockedAt.toISOString() : null,
      recommendationTally: contribAgg.recommendations.map(r => ({
        optionId: r.optionId,
        optionName: optMap.get(r.optionId) || r.optionId,
        count: r.count,
      })),
      scoreSpreadByCriterion,
      methodologyDisclaimer:
        'Participation metrics measure submitted expert perspectives. Expert signals are descriptive and do not constitute reputation, calibration, or truth scores.',
    };

    return {
      decisionId: decision._id.toString(),
      title: decision.title,
      description: decision.description || '',
      evaluatedAt: analysis?.evaluatedAt ?? null,
      outcome,
      isAuthoritative,
      pointLead,
      winner,
      runnerUp,
      criteriaImportance,
      optionsPerformance,
      sensitivityAnalysis: {
        analyticalTippingPoints,
        optionScoreSensitivity,
        multiParameterCounterfactual,
      },
      uncertaintyAnalysis,
      evidenceCoverage,
      expertParticipation,
    };
  }

  /**
   * Retrieves portfolio-level analytics across decisions accessible to the requester.
   */
  async getWorkspaceAnalytics(
    query: WorkspaceAnalyticsQuery = {},
    requester?: RequesterContext
  ): Promise<WorkspaceAnalyticsDto> {
    const generatedAt = new Date().toISOString();

    // Enforce authentication
    if (!requester || !requester.id) {
      return {
        generatedAt,
        timeframe: { startDate: null, endDate: null },
        decisionMetrics: {
          totalDecisions: 0,
          statusDistribution: { decisive: 0, tie: 0, unscored: 0 },
          roundLockDistribution: { locked: 0, open: 0 },
          completionRate: 0,
          averagePointLead: null,
        },
        activityTrends: [],
        criteriaAndOptionsMetrics: {
          totalCriteriaDefined: 0,
          averageCriteriaPerDecision: 0,
          totalOptionsDefined: 0,
          averageOptionsPerDecision: 0,
          topCriteriaNames: [],
        },
        evidenceMetrics: {
          totalEvidenceRecords: 0,
          decisionsWithEvidenceCount: 0,
          decisionEvidenceCoverageRate: 0,
          sourceTypeBreakdown: { url: 0, document: 0, excerpt: 0 },
          methodologyDisclaimer: 'Evidence quantity does not measure evidence quality or credibility.',
        },
        deliberationMetrics: {
          totalContributions: 0,
          submittedContributions: 0,
          draftContributions: 0,
          withdrawnContributions: 0,
          decisionsWithContributionsCount: 0,
          averageContributionsPerDecision: 0,
          methodologyDisclaimer: 'Expert deliberation metrics are descriptive and avoid reputation scoring.',
        },
      };
    }

    // Resolve all accessible decision IDs for this user (cross-user data isolation!)
    const accessibleIdsSet = new Set<string>();

    if (requester.role === 'admin') {
      // Admins can view portfolio metrics across all decisions
      const allDecisions = await decisionRepository.list({}, { limit: 1000 });
      for (const d of allDecisions.items) {
        accessibleIdsSet.add(d._id.toString());
      }
    } else {
      // Regular users: owned decisions + decisions shared via access grants
      const owned = await decisionRepository.list({ ownerId: requester.id }, { limit: 1000 });
      for (const d of owned.items) {
        accessibleIdsSet.add(d._id.toString());
      }

      const sharedIds = await decisionAccessRepository.listSharedDecisionIdsForUser(requester.id);
      for (const sId of sharedIds) {
        accessibleIdsSet.add(sId);
      }
    }

    const accessibleIds = Array.from(accessibleIdsSet);

    // Parse date filters
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (query.startDate) {
      const parsed = new Date(query.startDate);
      if (!Number.isNaN(parsed.getTime())) {
        startDate = parsed;
      }
    }
    if (query.endDate) {
      const parsed = new Date(query.endDate);
      if (!Number.isNaN(parsed.getTime())) {
        endDate = parsed;
      }
    }

    const dateFilter = { startDate, endDate };

    // Run parallel MongoDB aggregations
    const [decisionStats, evidenceStats, contributionStats] = await Promise.all([
      analyticsRepository.getWorkspaceDecisionsAggregation(accessibleIds, dateFilter),
      analyticsRepository.getWorkspaceEvidenceAggregation(accessibleIds, dateFilter),
      analyticsRepository.getWorkspaceContributionsAggregation(accessibleIds, dateFilter),
    ]);

    const totalDecisions = decisionStats.totalDecisions;
    const decisiveOrTie = decisionStats.decisiveCount + decisionStats.tieCount;
    const completionRate = totalDecisions > 0 ? round1((decisiveOrTie / totalDecisions) * 100) : 0;
    const decisionEvidenceCoverageRate =
      totalDecisions > 0 ? round1((evidenceStats.decisionsWithEvidenceCount / totalDecisions) * 100) : 0;
    const avgContributionsPerDecision =
      totalDecisions > 0 ? round1(contributionStats.totalContributions / totalDecisions) : 0;

    return {
      generatedAt,
      timeframe: {
        startDate: startDate ? startDate.toISOString() : null,
        endDate: endDate ? endDate.toISOString() : null,
      },
      decisionMetrics: {
        totalDecisions,
        statusDistribution: {
          decisive: decisionStats.decisiveCount,
          tie: decisionStats.tieCount,
          unscored: decisionStats.unscoredCount,
        },
        roundLockDistribution: {
          locked: decisionStats.lockedRoundsCount,
          open: decisionStats.openRoundsCount,
        },
        completionRate,
        averagePointLead: decisionStats.averagePointLead,
      },
      activityTrends: decisionStats.activityTrends,
      criteriaAndOptionsMetrics: {
        totalCriteriaDefined: decisionStats.totalCriteria,
        averageCriteriaPerDecision: decisionStats.avgCriteriaPerDecision,
        totalOptionsDefined: decisionStats.totalOptions,
        averageOptionsPerDecision: decisionStats.avgOptionsPerDecision,
        topCriteriaNames: decisionStats.topCriteria,
      },
      evidenceMetrics: {
        totalEvidenceRecords: evidenceStats.totalEvidenceCount,
        decisionsWithEvidenceCount: evidenceStats.decisionsWithEvidenceCount,
        decisionEvidenceCoverageRate,
        sourceTypeBreakdown: evidenceStats.sourceTypeBreakdown,
        methodologyDisclaimer:
          'Evidence coverage rate measures decisions that possess documented supporting citations or excerpts. High coverage does not guarantee evidence credibility or accuracy.',
      },
      deliberationMetrics: {
        totalContributions: contributionStats.totalContributions,
        submittedContributions: contributionStats.submittedCount,
        draftContributions: contributionStats.draftCount,
        withdrawnContributions: contributionStats.withdrawnCount,
        decisionsWithContributionsCount: contributionStats.decisionsWithContributionsCount,
        averageContributionsPerDecision: avgContributionsPerDecision,
        methodologyDisclaimer:
          'Deliberation metrics reflect stakeholder participation counts. Scores are unweighted by reputation in Phase 10.',
      },
    };
  }
}

export const analyticsService = new AnalyticsService();
