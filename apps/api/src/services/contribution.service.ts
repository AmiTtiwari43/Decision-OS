import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  decisionRepository,
  contributionRepository,
  operationJournalRepository,
} from '../repositories/index.js';
import {
  DecisionModel,
  OperationJournalModel,
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
import { collaborationService } from './collaboration.service.js';
import { evaluationCache } from './evaluationCache.js';
import {
  runAnalysis,
  validateCompleteness,
  type RequesterContext,
} from './decision.service.js';
import {
  executeCompensatingRollback,
} from './recoveryWorker.service.js';
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

    // ─── Topology Detection ───────────────────────────────────────────────────
    const client = mongoose.connection.getClient() as unknown as {
      topology?: { description?: { type?: string } };
    };
    const topologyType = client.topology?.description?.type;
    const supportsTransactions =
      topologyType === 'ReplicaSetWithPrimary' || topologyType === 'Sharded';

    // ─── Path A: Replica Set (Multi-Document Transaction) ─────────────────────
    if (supportsTransactions) {
      const criteria = decision.criteria as DecisionCriterion[];
      const options = decision.options as DecisionOption[];
      let freshAnalysis = null;

      if (criteria.length > 0 && options.length > 0 && validateCompleteness(criteria, options, candidateScores).length === 0) {
        try {
          freshAnalysis = runAnalysis(criteria, options, candidateScores);
        } catch (err) {
          if (err instanceof ValidationError) {
            throw new EngineValidationError(err);
          }
          throw err;
        }
      }

      const session = await mongoose.startSession();
      try {
        let updatedDecision: DecisionDocument | null = null;
        await session.withTransaction(async () => {
          const targetVersion = input.expectedVersion + 1;
          updatedDecision = await DecisionModel.findOneAndUpdate(
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

          if (!updatedDecision) {
            throw new DecisionConflictError(
              currentVersion,
              'Concurrent write conflict during adoption commit'
            );
          }

          await contributionRepository.markAdopted(
            contributionId,
            requester.id,
            preferredOptionId,
            session
          );

          await auditService.recordEvent({
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
          });
        });

        evaluationCache.invalidate(decisionId);
        return { decision: updatedDecision!, isIdempotentReplay: false };
      } finally {
        await session.endSession();
      }
    }

    // ─── Path B: Standalone MongoDB (Durable Operation Journal) ───────────────
    const opId = crypto.randomUUID();
    const targetVersion = input.expectedVersion + 1;
    const auditDraft = {
      eventId: crypto.randomUUID(),
      entityType: 'contribution',
      entityId: contributionId,
      summary: `Adopted expert scores from contribution for option "${preferredOptionId}"`,
      diff: {
        after: {
          preferredOptionId,
          expertScores: expertCriterionScores,
        },
      },
    };

    // 1. Write Journal Entry
    await operationJournalRepository.createEntry({
      operationId: opId,
      decisionId,
      action: 'contribution.adopted',
      actor: {
        id: requester.id,
        role: 'owner',
        name: requester.name,
        email: requester.email,
      },
      expectedVersion: input.expectedVersion,
      targetVersion,
      payload: {
        contributionId,
        preferredOptionId,
        expertScores: expertCriterionScores,
      },
      previousSnapshot,
      auditDraft,
    });

    // 2. Atomic findOneAndUpdate with optimistic concurrency match and in-flight guard
    const mutatedDecision = await DecisionModel.findOneAndUpdate(
      {
        _id: decisionId,
        version: input.expectedVersion,
        pendingOperationId: null,
      },
      {
        $set: {
          scores: candidateScores,
          version: targetVersion,
          analysis: null, // Clear stale evaluation
          pendingOperationId: opId,
          isAudited: false,
          recoveryFencingToken: 0,
          recoveryOwner: null,
          recoveryLeaseExpiresAt: null,
        },
      },
      { new: true }
    ).exec();

    if (!mutatedDecision) {
      await OperationJournalModel.updateOne(
        { operationId: opId },
        { $set: { state: 'REVERTED', errorDetails: 'Version conflict on decision write' } }
      );
      const fresh = await DecisionModel.findById(decisionId);
      throw new DecisionConflictError(
        fresh?.version || input.expectedVersion,
        'Decision has been modified by another participant'
      );
    }

    // Transition journal: PENDING -> DECISION_MUTATED
    await OperationJournalModel.updateOne(
      { operationId: opId, state: 'PENDING' },
      { $set: { state: 'DECISION_MUTATED', heartbeatAt: new Date() } }
    );

    // Invalidate cached engine evaluation
    evaluationCache.invalidate(decisionId);

    // 3. Synchronous Authoritative Recalculation
    const criteria = mutatedDecision.criteria as DecisionCriterion[];
    const options = mutatedDecision.options as DecisionOption[];
    let freshAnalysis = null;
    let calcError: unknown = null;

    if (criteria.length > 0 && options.length > 0 && validateCompleteness(criteria, options, candidateScores).length === 0) {
      try {
        freshAnalysis = runAnalysis(criteria, options, candidateScores, undefined, {
          decisionId,
          version: targetVersion,
        });
      } catch (err) {
        calcError = err;
      }
    }

    if (calcError) {
      // Engine evaluation failed -> Monotonic compensation to targetVersion + 1 ($v5 \to v6 \to v7$)
      await OperationJournalModel.updateOne(
        { operationId: opId, state: 'DECISION_MUTATED' },
        {
          $set: {
            state: 'COMPENSATING',
            heartbeatAt: new Date(),
            compensatingVersion: targetVersion + 1,
          },
        }
      );

      await executeCompensatingRollback(
        decisionId,
        targetVersion,
        previousSnapshot,
        opId,
        0,
        'standalone-primary'
      );

      await OperationJournalModel.updateOne(
        { operationId: opId, state: 'COMPENSATING' },
        { $set: { state: 'REVERTED', errorDetails: (calcError as Error).message } }
      );

      if (calcError instanceof ValidationError || calcError instanceof EngineValidationError) {
        throw new EngineValidationError(
          calcError instanceof EngineValidationError ? calcError.originalError : calcError
        );
      }
      throw calcError;
    }

    // Update Decision with fresh evaluation
    await DecisionModel.updateOne(
      { _id: decisionId, version: targetVersion, pendingOperationId: opId },
      { $set: { analysis: freshAnalysis } }
    ).exec();

    await OperationJournalModel.updateOne(
      { operationId: opId, state: 'DECISION_MUTATED' },
      { $set: { state: 'EVALUATED', heartbeatAt: new Date() } }
    );

    // 4. Update Contribution Status
    await contributionRepository.markAdopted(
      contributionId,
      requester.id,
      preferredOptionId
    );

    await OperationJournalModel.updateOne(
      { operationId: opId, state: 'EVALUATED' },
      { $set: { state: 'ENTITIES_UPDATED', heartbeatAt: new Date() } }
    );

    // 5. Append Audit Event
    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'contribution.adopted',
      entityType: 'contribution',
      entityId: contributionId,
      summary: auditDraft.summary,
      diff: auditDraft.diff,
      eventId: auditDraft.eventId,
    });

    await OperationJournalModel.updateOne(
      { operationId: opId, state: 'ENTITIES_UPDATED' },
      { $set: { state: 'AUDITED', heartbeatAt: new Date() } }
    );

    // 6. Finalize Decision
    const finalizedDecision = await DecisionModel.findOneAndUpdate(
      { _id: decisionId, version: targetVersion, pendingOperationId: opId },
      {
        $set: {
          pendingOperationId: null,
          isAudited: true,
          auditIntegrityStatus: 'healthy',
          recoveryOwner: null,
          recoveryLeaseExpiresAt: null,
        },
      },
      { new: true }
    ).exec();

    await OperationJournalModel.updateOne(
      { operationId: opId, state: 'AUDITED' },
      { $set: { state: 'COMPLETED', heartbeatAt: new Date() } }
    );

    return { decision: finalizedDecision!, isIdempotentReplay: false };
  }
}

export const contributionService = new ContributionService();
