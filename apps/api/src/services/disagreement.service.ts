import mongoose from 'mongoose';
import {
  analyzeDisagreements,
  type DisagreementIntelligenceItem,
  type CriterionDisagreementMetrics,
} from '@decision-os/decision-engine';
import {
  decisionRepository,
  contributionRepository,
  disagreementRepository,
  userRepository,
} from '../repositories/index.js';
import { authorizeDecisionAction } from './authorization.service.js';
import { auditService } from './audit.service.js';
import { collaborationService } from './collaboration.service.js';
import type { RequesterContext } from './decision.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  DisagreementNotFoundError,
} from '../errors/domain.errors.js';
import { getAIProvider } from './ai/providers/provider.factory.js';
import { env } from '../config/env.js';
import { z } from 'zod';

export interface DisagreementResolutionDto {
  status: 'open' | 'acknowledged' | 'resolved';
  explanation?: string;
  resolvedByName?: string;
  resolvedAt?: string;
}

export interface DisagreementItemDto extends DisagreementIntelligenceItem {
  resolution: DisagreementResolutionDto;
}

export interface DecisionDisagreementsDto {
  decisionId: string;
  hasSufficientData: boolean;
  totalContributors: number;
  totalDisagreements: number;
  decisionCriticalCount: number;
  items: DisagreementItemDto[];
  criteriaMetrics: ReadonlyArray<CriterionDisagreementMetrics>;
  priorityBreakdown: ReadonlyArray<{
    optionId: string;
    optionName: string;
    recommendationCount: number;
    percentage: number;
  }>;
  summary: string;
}

export interface AiDisagreementExplanationDto {
  disagreementId: string;
  neutralSummary: string;
  underlyingAssumptions: string[];
  suggestedClarificationQuestions: string[];
  disclaimer: string;
}

const aiDisagreementSchema = z.object({
  neutralSummary: z.string(),
  underlyingAssumptions: z.array(z.string()).default([]),
  suggestedClarificationQuestions: z.array(z.string()).min(1),
});

export class DisagreementService {
  /**
   * Evaluates structured disagreements for a decision, merging live analytical detection
   * with stored human resolution records.
   */
  async getDecisionDisagreements(
    decisionId: string,
    requester?: RequesterContext
  ): Promise<DecisionDisagreementsDto> {
    if (!decisionId || !mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    // Enforce read authorization (unrelated users receive 404 for enumeration defense)
    await authorizeDecisionAction(decision, 'read', requester);

    // Fetch submitted contributions only (excluding drafts of other users)
    const allContributions = await contributionRepository.listByDecision(decisionId, requester?.id);
    const submittedContributions = allContributions.filter(c => c.status === 'submitted');

    // Fetch contributor user details for clear human-readable names
    const contributorIds = submittedContributions.map(c => c.contributorId.toString());
    const userMap = new Map<string, string>();
    for (const uid of contributorIds) {
      if (!userMap.has(uid) && mongoose.isValidObjectId(uid)) {
        const u = await userRepository.findById(uid);
        if (u) {
          userMap.set(uid, u.name || u.email);
        }
      }
    }

    // Map contributions to decision engine input
    const engineContributions = submittedContributions.map(c => {
      const cIdStr = c.contributorId.toString();
      return {
        contributorId: cIdStr,
        contributorName: userMap.get(cIdStr) || 'Expert Contributor',
        preferredOptionId: c.recommendation?.preferredOptionId,
        scores: c.criterionScores || {},
        reasoning: c.criterionReasoning || {},
        confidence: typeof c.confidence === 'number' ? c.confidence : 1.0,
        predictionStatement: c.prediction?.statement,
        evidenceReferences: c.evidenceReferences || [],
      };
    });

    const lockedIds = (decision.criteria || []).filter(c => c.isLocked).map(c => c.id);

    const engineOptions = (decision.options || []).map(o => ({
      id: o.id,
      name: o.name,
      scores: decision.scores?.[o.id] || {},
    }));

    // Deterministic engine calculation
    const rawResult = analyzeDisagreements({
      criteria: decision.criteria || [],
      options: engineOptions,
      contributions: engineContributions,
      lockedIds,
    });

    // Fetch existing human resolution records
    const resolutionDocs = await disagreementRepository.listByDecision(decisionId);
    const resMap = new Map<string, (typeof resolutionDocs)[0]>();
    for (const r of resolutionDocs) {
      resMap.set(r.disagreementId, r);
    }

    // Merge resolutions into items
    const items: DisagreementItemDto[] = rawResult.items.map(item => {
      const stored = resMap.get(item.id);
      return {
        ...item,
        resolution: {
          status: stored?.status ?? 'open',
          explanation: stored?.resolutionExplanation || undefined,
          resolvedByName: stored?.resolvedByName || undefined,
          resolvedAt: stored?.resolvedAt ? stored.resolvedAt.toISOString() : undefined,
        },
      };
    });

    return {
      decisionId,
      hasSufficientData: rawResult.hasSufficientData,
      totalContributors: rawResult.totalContributors,
      totalDisagreements: items.length,
      decisionCriticalCount: rawResult.decisionCriticalCount,
      items,
      criteriaMetrics: rawResult.criteriaMetrics,
      priorityBreakdown: rawResult.priorityBreakdown,
      summary: rawResult.summary,
    };
  }

  /**
   * Updates the human governance resolution status for a disagreement.
   * Enforces 'edit' authorization (only owner, editor, or admin can acknowledge/resolve).
   */
  async updateResolution(
    decisionId: string,
    disagreementId: string,
    input: { status: 'open' | 'acknowledged' | 'resolved'; resolutionExplanation?: string },
    requester?: RequesterContext
  ): Promise<DisagreementResolutionDto> {
    if (!decisionId || !mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    // Enforce edit authorization
    await authorizeDecisionAction(decision, 'edit', requester);

    const isResolvedOrAck = input.status === 'acknowledged' || input.status === 'resolved';

    const updatedDoc = await disagreementRepository.upsertResolution(decisionId, disagreementId, {
      status: input.status,
      resolutionExplanation: input.resolutionExplanation ?? '',
      resolvedById: isResolvedOrAck && requester?.id ? new mongoose.Types.ObjectId(requester.id) : undefined,
      resolvedByName: isResolvedOrAck ? requester?.name || requester?.email || 'Authorized User' : undefined,
      resolvedAt: isResolvedOrAck ? new Date() : undefined,
    });

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'disagreement.resolved',
      entityType: 'disagreement',
      entityId: disagreementId,
      summary: `Updated disagreement status to "${input.status}"`,
      diff: {
        after: {
          status: input.status,
          explanation: input.resolutionExplanation,
        },
      },
    });

    if (input.status === 'resolved') {
      collaborationService.publishEvent(decisionId, {
        type: 'disagreement.resolved',
        decisionId,
        version: decision.version || 1,
        actorId: requester?.id,
        actorName: requester?.name || requester?.email,
        payload: {
          disagreementId,
          explanation: input.resolutionExplanation,
          resolvedByName: updatedDoc.resolvedByName,
        },
      });
    }

    return {
      status: updatedDoc.status,
      explanation: updatedDoc.resolutionExplanation || undefined,
      resolvedByName: updatedDoc.resolvedByName || undefined,
      resolvedAt: updatedDoc.resolvedAt ? updatedDoc.resolvedAt.toISOString() : undefined,
    };
  }

  /**
   * Generates neutral, advisory AI explanation and clarification questions for a specific disagreement.
   */
  async explainDisagreementWithAi(
    decisionId: string,
    disagreementId: string,
    requester?: RequesterContext
  ): Promise<AiDisagreementExplanationDto> {
    const analysis = await this.getDecisionDisagreements(decisionId, requester);
    const item = analysis.items.find(i => i.id === disagreementId);

    if (!item) {
      throw new DisagreementNotFoundError(`Disagreement with ID "${disagreementId}" not found for this decision.`);
    }

    // Demarcate untrusted participant context
    const participantsData = item.participants
      .map(
        p =>
          `- Participant: ${p.contributorName || 'Expert'} | Stated Value: ${p.value} | Confidence: ${
            p.confidence !== undefined ? `${Math.round(p.confidence * 100)}%` : 'N/A'
          } | Reasoning: ${p.reasoning || 'No qualitative rationale provided'}`
      )
      .join('\n');

    const contextPrompt = `You are an impartial, neutral decision-science mediator assisting with an internal deliberation in Decision OS.

<untrusted_data>
Disagreement Title: ${item.title}
Category: ${item.category}
Decision Criticality: ${item.isDecisionCritical ? 'YES (Decision-Critical - flips winner)' : 'NO (Non-critical)'}
Numerical Explanation: ${item.numericalExplanation}

Participant Perspectives:
${participantsData}
</untrusted_data>

Task:
1. Provide a neutral, balanced summary explaining why participants differ without taking a side or picking a winner.
2. Identify 1-2 unstated assumptions that may underlie these differing perspectives.
3. Formulate 2-3 specific, neutral clarification questions to help participants bridge this disagreement.

Output strict JSON with fields:
{
  "neutralSummary": string,
  "underlyingAssumptions": string[],
  "suggestedClarificationQuestions": string[]
}`;

    const systemPrompt =
      'You are Decision OS Disagreement Intelligence. You never pick winners, never assign reputation scores, and never alter mathematical MCDA scores. Return strictly valid JSON.';

    const provider = getAIProvider();
    const response = await provider.generateText(contextPrompt, systemPrompt, {
      timeoutMs: env.AI_TIMEOUT_MS,
    });

    let parsed;
    try {
      const cleaned = response.rawText.replace(/```json\n?|\n?```/g, '').trim();
      parsed = JSON.parse(cleaned);
      parsed = aiDisagreementSchema.parse(parsed);
    } catch {
      // Deterministic fallback if provider output fails parsing
      parsed = {
        neutralSummary: `Participants hold differing assessments on this item (${item.numericalExplanation}). Divergent evaluations often arise from different operational risk tolerances, varying past benchmark experiences, or disparate baseline assumptions.`,
        underlyingAssumptions: [
          'Participants may assume different operating scale requirements or risk tolerances.',
          'Participants may rely on different empirical benchmarks or reference data.',
        ],
        suggestedClarificationQuestions: [
          `What empirical data or reference benchmarks would help reconcile the evaluation gap?`,
          `Are the underlying constraints or operational assumptions shared across all participants?`,
        ],
      };
    }

    return {
      disagreementId,
      neutralSummary: parsed.neutralSummary,
      underlyingAssumptions: parsed.underlyingAssumptions,
      suggestedClarificationQuestions: parsed.suggestedClarificationQuestions,
      disclaimer:
        'AI explanations are advisory synthesis tools designed for mediation. They do not alter authoritative MCDA evaluations or declare a participant correct.',
    };
  }
}

export const disagreementService = new DisagreementService();
