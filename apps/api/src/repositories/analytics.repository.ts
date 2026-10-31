import mongoose from 'mongoose';
import {
  DecisionModel,
  DecisionEvidenceModel,
  DecisionContributionModel,
} from '../models/index.js';

export interface WorkspaceDateFilter {
  startDate?: Date;
  endDate?: Date;
}

export interface WorkspaceDecisionsAggregationResult {
  totalDecisions: number;
  decisiveCount: number;
  tieCount: number;
  unscoredCount: number;
  lockedRoundsCount: number;
  openRoundsCount: number;
  averagePointLead: number | null;
  totalCriteria: number;
  avgCriteriaPerDecision: number;
  totalOptions: number;
  avgOptionsPerDecision: number;
  activityTrends: Array<{ period: string; createdCount: number }>;
  topCriteria: Array<{ name: string; count: number }>;
}

export interface WorkspaceEvidenceAggregationResult {
  totalEvidenceCount: number;
  decisionsWithEvidenceCount: number;
  sourceTypeBreakdown: {
    url: number;
    document: number;
    excerpt: number;
  };
}

export interface WorkspaceContributionsAggregationResult {
  totalContributions: number;
  submittedCount: number;
  draftCount: number;
  withdrawnCount: number;
  decisionsWithContributionsCount: number;
}

export interface DecisionEvidenceAggregationResult {
  totalCount: number;
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
  targetCounts: Record<string, number>; // key: `${targetType}:${targetId}` -> count
}

export interface DecisionContributionAggregationResult {
  totalCount: number;
  submittedCount: number;
  draftCount: number;
  withdrawnCount: number;
  recommendations: Array<{ optionId: string; count: number }>;
  criterionScores: Record<string, number[]>; // criterionId -> array of scores from submitted contributions
}

export class AnalyticsRepository {
  /**
   * Aggregates portfolio metrics across a given set of accessible decision IDs.
   */
  async getWorkspaceDecisionsAggregation(
    accessibleIds: string[],
    filter?: WorkspaceDateFilter
  ): Promise<WorkspaceDecisionsAggregationResult> {
    if (accessibleIds.length === 0) {
      return {
        totalDecisions: 0,
        decisiveCount: 0,
        tieCount: 0,
        unscoredCount: 0,
        lockedRoundsCount: 0,
        openRoundsCount: 0,
        averagePointLead: null,
        totalCriteria: 0,
        avgCriteriaPerDecision: 0,
        totalOptions: 0,
        avgOptionsPerDecision: 0,
        activityTrends: [],
        topCriteria: [],
      };
    }

    const objectIds = accessibleIds
      .filter(id => mongoose.isValidObjectId(id))
      .map(id => new mongoose.Types.ObjectId(id));

    const matchQuery: Record<string, unknown> = {
      _id: { $in: objectIds },
    };

    if (filter?.startDate || filter?.endDate) {
      const dateCond: Record<string, Date> = {};
      if (filter.startDate) dateCond.$gte = filter.startDate;
      if (filter.endDate) dateCond.$lte = filter.endDate;
      matchQuery.createdAt = dateCond;
    }

    const [facetResult] = await DecisionModel.aggregate([
      { $match: matchQuery },
      {
        $facet: {
          total: [{ $count: 'count' }],
          statusCounts: [
            {
              $group: {
                _id: {
                  $cond: [
                    { $eq: [{ $ifNull: ['$analysis', null] }, null] },
                    'unscored',
                    { $ifNull: ['$analysis.decisionOutcome', 'unscored'] },
                  ],
                },
                count: { $sum: 1 },
              },
            },
          ],
          roundLockCounts: [
            {
              $group: {
                _id: { $ifNull: ['$isContributionRoundLocked', false] },
                count: { $sum: 1 },
              },
            },
          ],
          leadStats: [
            {
              $match: {
                'analysis.decisionOutcome': 'decisive',
                'analysis.pointLead': { $ne: null },
              },
            },
            {
              $group: {
                _id: null,
                avgLead: { $avg: '$analysis.pointLead' },
              },
            },
          ],
          elementStats: [
            {
              $project: {
                numCriteria: { $size: { $ifNull: ['$criteria', []] } },
                numOptions: { $size: { $ifNull: ['$options', []] } },
              },
            },
            {
              $group: {
                _id: null,
                totalCriteria: { $sum: '$numCriteria' },
                avgCriteria: { $avg: '$numCriteria' },
                totalOptions: { $sum: '$numOptions' },
                avgOptions: { $avg: '$numOptions' },
              },
            },
          ],
          activityTrends: [
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
          topCriteria: [
            { $unwind: '$criteria' },
            {
              $group: {
                _id: { $toLower: '$criteria.name' },
                name: { $first: '$criteria.name' },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ],
        },
      },
    ]).exec();

    const totalDecisions = facetResult?.total?.[0]?.count ?? 0;

    let decisiveCount = 0;
    let tieCount = 0;
    let unscoredCount = 0;
    for (const sc of facetResult?.statusCounts ?? []) {
      if (sc._id === 'decisive') decisiveCount = sc.count;
      else if (sc._id === 'tie') tieCount = sc.count;
      else unscoredCount += sc.count;
    }

    let lockedRoundsCount = 0;
    let openRoundsCount = 0;
    for (const rc of facetResult?.roundLockCounts ?? []) {
      if (rc._id === true) lockedRoundsCount = rc.count;
      else openRoundsCount += rc.count;
    }

    const rawAvgLead = facetResult?.leadStats?.[0]?.avgLead;
    const averagePointLead = typeof rawAvgLead === 'number' ? Math.round(rawAvgLead * 10) / 10 : null;

    const elStats = facetResult?.elementStats?.[0];
    const totalCriteria = elStats?.totalCriteria ?? 0;
    const avgCriteriaPerDecision = totalDecisions > 0 ? Math.round((totalCriteria / totalDecisions) * 10) / 10 : 0;
    const totalOptions = elStats?.totalOptions ?? 0;
    const avgOptionsPerDecision = totalDecisions > 0 ? Math.round((totalOptions / totalDecisions) * 10) / 10 : 0;

    const activityTrends = (facetResult?.activityTrends ?? []).map((t: { _id: string; count: number }) => ({
      period: t._id,
      createdCount: t.count,
    }));

    const topCriteria = (facetResult?.topCriteria ?? []).map((c: { name: string; count: number }) => ({
      name: c.name,
      count: c.count,
    }));

    return {
      totalDecisions,
      decisiveCount,
      tieCount,
      unscoredCount,
      lockedRoundsCount,
      openRoundsCount,
      averagePointLead,
      totalCriteria,
      avgCriteriaPerDecision,
      totalOptions,
      avgOptionsPerDecision,
      activityTrends,
      topCriteria,
    };
  }

  /**
   * Aggregates portfolio evidence statistics across accessible decisions.
   */
  async getWorkspaceEvidenceAggregation(
    accessibleIds: string[],
    filter?: WorkspaceDateFilter
  ): Promise<WorkspaceEvidenceAggregationResult> {
    if (accessibleIds.length === 0) {
      return {
        totalEvidenceCount: 0,
        decisionsWithEvidenceCount: 0,
        sourceTypeBreakdown: { url: 0, document: 0, excerpt: 0 },
      };
    }

    const objectIds = accessibleIds
      .filter(id => mongoose.isValidObjectId(id))
      .map(id => new mongoose.Types.ObjectId(id));

    const matchQuery: Record<string, unknown> = {
      decisionId: { $in: objectIds },
    };

    if (filter?.startDate || filter?.endDate) {
      const dateCond: Record<string, Date> = {};
      if (filter.startDate) dateCond.$gte = filter.startDate;
      if (filter.endDate) dateCond.$lte = filter.endDate;
      matchQuery.createdAt = dateCond;
    }

    const [facetResult] = await DecisionEvidenceModel.aggregate([
      { $match: matchQuery },
      {
        $facet: {
          total: [{ $count: 'count' }],
          bySourceType: [
            {
              $group: {
                _id: '$type',
                count: { $sum: 1 },
              },
            },
          ],
          distinctDecisions: [
            {
              $group: {
                _id: '$decisionId',
              },
            },
            { $count: 'count' },
          ],
        },
      },
    ]).exec();

    const totalEvidenceCount = facetResult?.total?.[0]?.count ?? 0;
    const decisionsWithEvidenceCount = facetResult?.distinctDecisions?.[0]?.count ?? 0;

    const sourceTypeBreakdown = { url: 0, document: 0, excerpt: 0 };
    for (const s of facetResult?.bySourceType ?? []) {
      if (s._id in sourceTypeBreakdown) {
        sourceTypeBreakdown[s._id as keyof typeof sourceTypeBreakdown] = s.count;
      }
    }

    return {
      totalEvidenceCount,
      decisionsWithEvidenceCount,
      sourceTypeBreakdown,
    };
  }

  /**
   * Aggregates portfolio deliberation/contribution statistics across accessible decisions.
   */
  async getWorkspaceContributionsAggregation(
    accessibleIds: string[],
    filter?: WorkspaceDateFilter
  ): Promise<WorkspaceContributionsAggregationResult> {
    if (accessibleIds.length === 0) {
      return {
        totalContributions: 0,
        submittedCount: 0,
        draftCount: 0,
        withdrawnCount: 0,
        decisionsWithContributionsCount: 0,
      };
    }

    const objectIds = accessibleIds
      .filter(id => mongoose.isValidObjectId(id))
      .map(id => new mongoose.Types.ObjectId(id));

    const matchQuery: Record<string, unknown> = {
      decisionId: { $in: objectIds },
    };

    if (filter?.startDate || filter?.endDate) {
      const dateCond: Record<string, Date> = {};
      if (filter.startDate) dateCond.$gte = filter.startDate;
      if (filter.endDate) dateCond.$lte = filter.endDate;
      matchQuery.createdAt = dateCond;
    }

    const [facetResult] = await DecisionContributionModel.aggregate([
      { $match: matchQuery },
      {
        $facet: {
          total: [{ $count: 'count' }],
          byStatus: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
              },
            },
          ],
          distinctDecisions: [
            {
              $group: {
                _id: '$decisionId',
              },
            },
            { $count: 'count' },
          ],
        },
      },
    ]).exec();

    const totalContributions = facetResult?.total?.[0]?.count ?? 0;
    const decisionsWithContributionsCount = facetResult?.distinctDecisions?.[0]?.count ?? 0;

    let submittedCount = 0;
    let draftCount = 0;
    let withdrawnCount = 0;

    for (const st of facetResult?.byStatus ?? []) {
      if (st._id === 'submitted') submittedCount = st.count;
      else if (st._id === 'draft') draftCount = st.count;
      else if (st._id === 'withdrawn') withdrawnCount = st.count;
    }

    return {
      totalContributions,
      submittedCount,
      draftCount,
      withdrawnCount,
      decisionsWithContributionsCount,
    };
  }

  /**
   * Aggregates evidence records for a single decision.
   */
  async getDecisionEvidenceAggregation(decisionId: string): Promise<DecisionEvidenceAggregationResult> {
    if (!mongoose.isValidObjectId(decisionId)) {
      return {
        totalCount: 0,
        byTargetType: { decision: 0, option: 0, criterion: 0, contribution: 0 },
        bySourceType: { url: 0, document: 0, excerpt: 0 },
        targetCounts: {},
      };
    }

    const [facetResult] = await DecisionEvidenceModel.aggregate([
      { $match: { decisionId: new mongoose.Types.ObjectId(decisionId) } },
      {
        $facet: {
          total: [{ $count: 'count' }],
          byTargetType: [
            {
              $group: {
                _id: '$targetType',
                count: { $sum: 1 },
              },
            },
          ],
          bySourceType: [
            {
              $group: {
                _id: '$type',
                count: { $sum: 1 },
              },
            },
          ],
          byTarget: [
            {
              $group: {
                _id: { targetType: '$targetType', targetId: '$targetId' },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]).exec();

    const totalCount = facetResult?.total?.[0]?.count ?? 0;

    const byTargetType = { decision: 0, option: 0, criterion: 0, contribution: 0 };
    for (const t of facetResult?.byTargetType ?? []) {
      if (t._id in byTargetType) {
        byTargetType[t._id as keyof typeof byTargetType] = t.count;
      }
    }

    const bySourceType = { url: 0, document: 0, excerpt: 0 };
    for (const s of facetResult?.bySourceType ?? []) {
      if (s._id in bySourceType) {
        bySourceType[s._id as keyof typeof bySourceType] = s.count;
      }
    }

    const targetCounts: Record<string, number> = {};
    for (const tg of facetResult?.byTarget ?? []) {
      if (tg._id?.targetType && tg._id?.targetId) {
        targetCounts[`${tg._id.targetType}:${tg._id.targetId}`] = tg.count;
      }
    }

    return {
      totalCount,
      byTargetType,
      bySourceType,
      targetCounts,
    };
  }

  /**
   * Aggregates contributions for a single decision.
   */
  async getDecisionContributionAggregation(decisionId: string): Promise<DecisionContributionAggregationResult> {
    if (!mongoose.isValidObjectId(decisionId)) {
      return {
        totalCount: 0,
        submittedCount: 0,
        draftCount: 0,
        withdrawnCount: 0,
        recommendations: [],
        criterionScores: {},
      };
    }

    const contributions = await DecisionContributionModel.find({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    }).lean().exec();

    let submittedCount = 0;
    let draftCount = 0;
    let withdrawnCount = 0;
    const recMap: Record<string, number> = {};
    const criterionScores: Record<string, number[]> = {};

    for (const c of contributions) {
      if (c.status === 'submitted') {
        submittedCount++;
        const pref = c.recommendation?.preferredOptionId;
        if (pref) {
          recMap[pref] = (recMap[pref] ?? 0) + 1;
        }

        if (c.criterionScores && typeof c.criterionScores === 'object') {
          for (const [critId, score] of Object.entries(c.criterionScores)) {
            if (typeof score === 'number' && Number.isFinite(score)) {
              if (!criterionScores[critId]) {
                criterionScores[critId] = [];
              }
              criterionScores[critId].push(score);
            }
          }
        }
      } else if (c.status === 'draft') {
        draftCount++;
      } else if (c.status === 'withdrawn') {
        withdrawnCount++;
      }
    }

    const recommendations = Object.entries(recMap).map(([optionId, count]) => ({
      optionId,
      count,
    }));
    recommendations.sort((a, b) => b.count - a.count);

    return {
      totalCount: contributions.length,
      submittedCount,
      draftCount,
      withdrawnCount,
      recommendations,
      criterionScores,
    };
  }
}

export const analyticsRepository = new AnalyticsRepository();

