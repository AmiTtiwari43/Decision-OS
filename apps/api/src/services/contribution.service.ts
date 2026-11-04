import mongoose from 'mongoose';
import {
  decisionRepository,
  contributionRepository,
} from '../repositories/index.js';
import {
  DecisionModel,
  type DecisionContributionDocument,
  type DecisionDocument,
  type SaveContributionInput,
  type AdoptContributionInput,
  type RejectContributionInput,
  type DecisionCriterion,
  type DecisionOption,
  type ScoreMatrix,
} from '../models/index.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  ContributionNotFoundError,
  ContributionRoundLockedError,
  InvalidOptionReferenceError,
  InvalidCriterionReferenceError,
  DecisionConflictError,
  DecisionQuarantinedError,
  InvalidContributionStatusError,
  EngineValidationError,
} from '../errors/domain.errors.js';
import { authorizeDecisionAction } from './authorization.service.js';
import { auditService } from './audit.service.js';
import { outboxService } from './outbox.service.js';
import { runInTransaction } from '../db/connection.js';
import { collaborationService } from './collaboration.service.js';
import { evaluationCache } from './evaluationCache.js';
import {
  runAnalysis,
  validateCompleteness,
  type RequesterContext,
} from './decision.service.js';
import { ValidationError } from '@decision-os/decision-engine';

export class ContributionService {
  /**
   * Saves or updates a draft contribution for the authenticated user.
   */
  async saveContribution(
    decisionId: string,
    data: SaveContributionInput,
    requester: RequesterContext
  ): Promise<DecisionContributionDocument> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    if (decision.auditIntegrityStatus === 'quarantined') {
      throw new DecisionQuarantinedError(decisionId, decision.quarantineReason || undefined);
    }

    // Must have contribution permission (owner, editor, contributor)
    await authorizeDecisionAction(decision, 'contribute', requester);

    // Verify round is not locked
    if (decision.isContributionRoundLocked) {
      throw new ContributionRoundLockedError();
    }

    // Validate preferredOptionId exists in decision.options
    const optionExists = decision.options.some((o) => o.id === data.preferredOptionId);
    if (!optionExists) {
      throw new InvalidOptionReferenceError(data.preferredOptionId);
    }

    // Validate criterionScores keys exist in decision.criteria
    if (data.criterionScores) {
      for (const criterionId of Object.keys(data.criterionScores)) {
        const criterionExists = decision.criteria.some((c) => c.id === criterionId);
        if (!criterionExists) {
          throw new InvalidCriterionReferenceError(criterionId);
        }
      }
    }

    // Validate criterionReasoning keys exist in decision.criteria
    if (data.criterionReasoning) {
      for (const criterionId of Object.keys(data.criterionReasoning)) {
        const criterionExists = decision.criteria.some((c) => c.id === criterionId);
        if (!criterionExists) {
          throw new InvalidCriterionReferenceError(criterionId);
        }
      }
    }

    return contributionRepository.saveDraft(decisionId, requester.id, data);
  }

  /**
   * Submits a contribution, transitioning it to 'submitted'.
   */
  async submitContribution(
    decisionId: string,
    requester: RequesterContext
  ): Promise<DecisionContributionDocument> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    if (decision.auditIntegrityStatus === 'quarantined') {
      throw new DecisionQuarantinedError(decisionId, decision.quarantineReason || undefined);
    }

    await authorizeDecisionAction(decision, 'contribute', requester);

    if (decision.isContributionRoundLocked) {
      throw new ContributionRoundLockedError();
    }

    const existing = await contributionRepository.findByDecisionAndContributor(
      decisionId,
      requester.id
    );

    if (!existing) {
      throw new ContributionNotFoundError('No draft contribution found to submit');
    }

    if (existing.status === 'submitted') {
      return existing;
    }

    const submitted = await contributionRepository.submit(decisionId, requester.id);
    if (!submitted) {
      throw new ContributionNotFoundError('Failed to submit contribution');
    }

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'contribution.submitted',
      entityType: 'contribution',
      entityId: submitted._id.toString(),
      summary: `Submitted expert contribution (revision ${submitted.revision})`,
      diff: {
        after: {
          preferredOptionId: submitted.recommendation?.preferredOptionId,
          revision: submitted.revision,
        },
      },
    });

    collaborationService.publishEvent(decisionId, {
      type: 'contribution.submitted',
      decisionId,
      version: decision.version || 1,
      actorId: requester.id,
      actorName: requester.name || requester.email,
      payload: {
        contributionId: submitted._id.toString(),
        contributorId: requester.id,
        preferredOptionId: submitted.recommendation?.preferredOptionId,
        revision: submitted.revision,
      },
    });

    return submitted;
  }

  /**
   * Withdraws a contribution.
   */
  async withdrawContribution(
    decisionId: string,
    requester: RequesterContext
  ): Promise<DecisionContributionDocument> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    if (decision.auditIntegrityStatus === 'quarantined') {
      throw new DecisionQuarantinedError(decisionId, decision.quarantineReason || undefined);
    }

    await authorizeDecisionAction(decision, 'contribute', requester);

    if (decision.isContributionRoundLocked) {
      throw new ContributionRoundLockedError();
    }

    const existing = await contributionRepository.findByDecisionAndContributor(
      decisionId,
      requester.id
    );

    if (!existing) {
      throw new ContributionNotFoundError('No contribution found to withdraw');
    }

    if (existing.status === 'withdrawn') {
      return existing;
    }

    const withdrawn = await contributionRepository.withdraw(decisionId, requester.id);
    if (!withdrawn) {
      throw new ContributionNotFoundError('Failed to withdraw contribution');
    }

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'contribution.withdrawn',
      entityType: 'contribution',
      entityId: withdrawn._id.toString(),
      summary: 'Withdrew expert contribution',
    });

    return withdrawn;
  }

  /**
   * Gets the authenticated user's contribution for a decision (if any).
   */
  async getMineContribution(
    decisionId: string,
    requester: RequesterContext
  ): Promise<DecisionContributionDocument | null> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    return contributionRepository.findByDecisionAndContributor(decisionId, requester.id);
  }

  /**
   * Lists contributions for a decision.
   */
  async listContributions(
    decisionId: string,
    requester: RequesterContext
  ): Promise<DecisionContributionDocument[]> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    return contributionRepository.listByDecision(decisionId, requester.id);
  }

  /**
   * Locks the contribution round (Owner only).
   */
  async lockRound(
    decisionId: string,
    requester: RequesterContext
  ): Promise<DecisionDocument> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    if (decision.auditIntegrityStatus === 'quarantined') {
      throw new DecisionQuarantinedError(decisionId, decision.quarantineReason || undefined);
    }

    await authorizeDecisionAction(decision, 'lock_round', requester);

    const updated = await decisionRepository.update(decisionId, {
      isContributionRoundLocked: true,
      contributionRoundLockedAt: new Date(),
    });

    if (!updated) {
      throw new DecisionNotFoundError(decisionId);
    }

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'decision.round_locked',
      entityType: 'decision',
      entityId: decisionId,
      summary: 'Locked contribution round',
    });

    return updated;
  }

  /**
   * Unlocks the contribution round (Owner only).
   */
  async unlockRound(
    decisionId: string,
    requester: RequesterContext
  ): Promise<DecisionDocument> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    if (decision.auditIntegrityStatus === 'quarantined') {
      throw new DecisionQuarantinedError(decisionId, decision.quarantineReason || undefined);
    }

    await authorizeDecisionAction(decision, 'lock_round', requester);

    const updated = await decisionRepository.update(decisionId, {
      isContributionRoundLocked: false,
      contributionRoundLockedAt: null,
    });

    if (!updated) {
      throw new DecisionNotFoundError(decisionId);
    }

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'decision.round_unlocked',
      entityType: 'decision',
      entityId: decisionId,
      summary: 'Unlocked contribution round',
    });

    return updated;
  }

  /**
   * Rejects an expert contribution with rationale (Owner only).
   */
  async rejectContribution(
    decisionId: string,
    contributionId: string,
    input: RejectContributionInput,
    requester: RequesterContext
  ): Promise<DecisionContributionDocument> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }
    if (!mongoose.isValidObjectId(contributionId)) {
      throw new ContributionNotFoundError('Invalid contribution ID');
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    if (decision.auditIntegrityStatus === 'quarantined') {
      throw new DecisionQuarantinedError(decisionId, decision.quarantineReason || undefined);
    }

    await authorizeDecisionAction(decision, 'reject_contribution', requester);

    const contribution = await contributionRepository.findById(contributionId);
    if (!contribution || contribution.decisionId.toString() !== decisionId) {
      throw new ContributionNotFoundError('Contribution not found for this decision');
    }

    if (contribution.status !== 'submitted') {
      throw new InvalidContributionStatusError(
        `Only submitted contributions can be rejected (current status: ${contribution.status})`
      );
    }

    const rejected = await contributionRepository.reject(
      contributionId,
      input.rejectionReason.trim(),
      {
        id: requester.id,
        name: requester.name || requester.email || 'Decision Owner',
        role: 'owner',
      }
    );

    if (!rejected) {
      throw new ContributionNotFoundError('Failed to reject contribution');
    }

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'contribution.rejected',
      entityType: 'contribution',
      entityId: contributionId,
      summary: `Rejected expert contribution from ${rejected.contributorId}: "${input.rejectionReason.trim()}"`,
      diff: {
        after: {
          status: 'rejected',
          rejectionReason: input.rejectionReason.trim(),
        },
      },
    });

    collaborationService.publishEvent(decisionId, {
      type: 'contribution.rejected',
      decisionId,
      version: decision.version || 1,
      actorId: requester.id,
      actorName: requester.name || requester.email,
      payload: {
        contributionId,
        rejectionReason: input.rejectionReason.trim(),
      },
    });

    return rejected;
  }

  /**
   * Explicit adoption of expert scores into the decision's core score matrix (Owner only).
   * Implements strict optimistic concurrency, synchronous canonical evaluation,
   * idempotent replay, and monotonic compensation.
   */
  async adoptExpertScores(
    decisionId: string,
    contributionId: string,
    input: AdoptContributionInput,
    requester: RequesterContext
  ): Promise<{ decision: DecisionDocument; isIdempotentReplay: boolean }> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }
    if (!mongoose.isValidObjectId(contributionId)) {
      throw new ContributionNotFoundError('Invalid contribution ID');
    }

    if (input.confirmation !== true) {
      throw new InvalidContributionStatusError('Explicit confirmation: true is required to adopt expert scores');
    }

    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new InvalidContributionStatusError('expectedVersion must be a positive integer');
    }

    const decision = await DecisionModel.findById(decisionId).exec();
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    if (decision.auditIntegrityStatus === 'quarantined') {
      throw new DecisionQuarantinedError(decisionId, decision.quarantineReason || undefined);
    }

    // Owner or admin only
    await authorizeDecisionAction(decision, 'adopt', requester);

    const contribution = await contributionRepository.findById(contributionId);
    if (!contribution || contribution.decisionId.toString() !== decisionId) {
      throw new ContributionNotFoundError('Contribution not found for this decision');
    }

    // ─── Idempotent Replay Check ──────────────────────────────────────────────
    if (contribution.status === 'adopted') {
      const preferredOpt = contribution.recommendation?.preferredOptionId;
      const scoresMatch = Boolean(
        preferredOpt &&
          decision.scores?.[preferredOpt] &&
          Object.entries(contribution.criterionScores || {}).every(
            ([critId, val]) => decision.scores?.[preferredOpt]?.[critId] === val
          )
      );

      if (scoresMatch) {
        return { decision, isIdempotentReplay: true };
      }
    }

    // ─── In-Flight Collision Guard ────────────────────────────────────────────
    if (decision.pendingOperationId) {
      throw new DecisionConflictError(
        decision.version || 1,
        'Decision has an in-flight operation pending reconciliation; retry shortly'
      );
    }

    if (contribution.status !== 'submitted') {
      throw new InvalidContributionStatusError(
        `Only submitted contributions can be adopted (current status: ${contribution.status})`
      );
    }

    // Optimistic concurrency check
    const currentVersion = decision.version || 1;
    if (input.expectedVersion !== currentVersion) {
      throw new DecisionConflictError(
        currentVersion,
        `Decision has been modified by another participant (current version: ${currentVersion}, expected: ${input.expectedVersion})`
      );
    }

    const preferredOptionId = contribution.recommendation.preferredOptionId;
    const optionExists = decision.options.some((o) => o.id === preferredOptionId);
    if (!optionExists) {
      throw new InvalidOptionReferenceError(preferredOptionId);
    }

    const expertCriterionScores = contribution.criterionScores || {};
    for (const [criterionId, scoreVal] of Object.entries(expertCriterionScores)) {
      if (input.selectedCriterionIds && !input.selectedCriterionIds.includes(criterionId)) {
        continue;
      }
      const criterionExists = decision.criteria.some((c) => c.id === criterionId);
      if (!criterionExists) {
        throw new InvalidCriterionReferenceError(criterionId);
      }
      if (typeof scoreVal !== 'number' || !Number.isFinite(scoreVal) || scoreVal < 0 || scoreVal > 100) {
        throw new InvalidContributionStatusError(
          `Expert score for criterion '${criterionId}' must be a finite number between 0 and 100`
        );
      }
    }

    // Prepare candidate scores
    const candidateScores: ScoreMatrix = JSON.parse(JSON.stringify(decision.scores || {}));
    if (!candidateScores[preferredOptionId]) {
      candidateScores[preferredOptionId] = {};
    }
    for (const [criterionId, scoreVal] of Object.entries(expertCriterionScores)) {
      if (input.selectedCriterionIds && !input.selectedCriterionIds.includes(criterionId)) {
        continue;
      }
      if (typeof scoreVal === 'number' && Number.isFinite(scoreVal)) {
        candidateScores[preferredOptionId][criterionId] = scoreVal;
      }
    }

    const previousSnapshot = {
      version: currentVersion,
      scores: JSON.parse(JSON.stringify(decision.scores || {})),
      criteria: decision.criteria,
      options: decision.options,
    };

    const criteria = decision.criteria as DecisionCriterion[];
    const options = decision.options as DecisionOption[];
    let freshAnalysis = null;
    let calcError: unknown = null;

    if (criteria.length > 0 && options.length > 0 && validateCompleteness(criteria, options, candidateScores).length === 0) {
      try {
        freshAnalysis = runAnalysis(criteria, options, candidateScores);
      } catch (err) {
        calcError = err;
      }
    }

    if (calcError) {
      // Monotonic compensation rule:
      // When calculation fails, advance version from targetVersion (input.expectedVersion + 1)
      // to targetVersion + 1 (failedVersion + 1), restoring previous baseline snapshot.
      const targetVersion = input.expectedVersion + 1;
      const compensatingVersion = targetVersion + 1;
      await runInTransaction(async (session) => {
        await DecisionModel.updateOne(
          { _id: decisionId, version: input.expectedVersion },
          {
            $set: {
              version: compensatingVersion,
              scores: previousSnapshot.scores,
              analysis: null,
              isAudited: true,
              pendingOperationId: null,
            },
          },
          { session }
        ).exec();

        await auditService.recordEvent(
          {
            decisionId,
            action: 'decision.updated',
            entityType: 'decision',
            entityId: decisionId,
            actor: { id: requester.id, role: 'owner', name: requester.name },
            summary: `Compensating rollback to restore baseline inputs following failed operation on adoption`,
            diff: {
              before: { version: targetVersion },
              after: {
                version: compensatingVersion,
                isCompensated: true,
                restoredVersion: previousSnapshot.version,
              },
            },
          },
          session
        );
      });

      evaluationCache.invalidate(decisionId);

      if (calcError instanceof ValidationError || calcError instanceof EngineValidationError) {
        throw new EngineValidationError(
          calcError instanceof EngineValidationError ? calcError.originalError : calcError
        );
      }
      throw calcError;
    }

    // Mandatory Replica Set ACID Transaction (PHASE 4)
    const updatedDecision = await runInTransaction(async (session) => {
      const targetVersion = input.expectedVersion + 1;
      const mutated = await DecisionModel.findOneAndUpdate(
        { _id: decisionId, version: input.expectedVersion },
        {
          $set: {
            scores: candidateScores,
            analysis: freshAnalysis,
            version: targetVersion,
            isAudited: true,
            pendingOperationId: null,
          },
        },
        { new: true, session }
      ).exec();

      if (!mutated) {
        throw new DecisionConflictError(
          currentVersion,
          'Concurrent write conflict during adoption commit'
        );
      }

      // Guard status: 'submitted' within the transaction
      const adopted = await contributionRepository.markAdopted(
        contributionId,
        requester.id,
        preferredOptionId,
        session
      );

      if (!adopted) {
        throw new InvalidContributionStatusError(
          'Contribution is no longer submitted or was concurrently modified'
        );
      }

      // Record audit event within the transaction (advances authoritative auditHead)
      await auditService.recordEvent(
        {
          decisionId,
          actor: requester,
          action: 'contribution.adopted',
          entityType: 'contribution',
          entityId: contributionId,
          summary: `Adopted expert scores from contribution for option "${preferredOptionId}"`,
          diff: {
            after: {
              preferredOptionId,
              expertScores: expertCriterionScores,
            },
          },
        },
        session
      );

      // Persist notification outbox record transactionally (F7)
      await outboxService.createNotification(
        {
          decisionId,
          eventType: 'contribution.adopted',
          payload: {
            contributionId,
            contributorId: contribution.contributorId,
            preferredOptionId,
            version: targetVersion,
          },
        },
        session
      );

      return mutated;
    });

    evaluationCache.invalidate(decisionId);

    // Ephemeral WebSocket notification published only after durable transaction commit
    collaborationService.publishEvent(decisionId, {
      type: 'contribution.adopted',
      decisionId,
      version: updatedDecision.version || 1,
      actorId: requester.id,
      actorName: requester.name || requester.email,
      payload: {
        contributionId,
        preferredOptionId,
        version: updatedDecision.version,
      },
    });

    return { decision: updatedDecision, isIdempotentReplay: false };
  }
}

export const contributionService = new ContributionService();
