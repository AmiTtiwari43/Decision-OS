import mongoose from 'mongoose';
import {
  decisionRepository,
  contributionRepository,
} from '../repositories/index.js';
import { updateDecision } from './decision.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  ContributionNotFoundError,
  ContributionRoundLockedError,
  InvalidOptionReferenceError,
  InvalidCriterionReferenceError,
  ForbiddenError,
} from '../errors/domain.errors.js';
import { authorizeDecisionAction } from './authorization.service.js';
import type { RequesterContext } from './decision.service.js';
import type {
  DecisionContributionDocument,
  DecisionDocument,
  SaveContributionInput,
} from '../models/index.js';

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

    await authorizeDecisionAction(decision, 'lock_round', requester);

    const updated = await decisionRepository.update(decisionId, {
      isContributionRoundLocked: true,
      contributionRoundLockedAt: new Date(),
    });

    if (!updated) {
      throw new DecisionNotFoundError(decisionId);
    }

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

    await authorizeDecisionAction(decision, 'lock_round', requester);

    const updated = await decisionRepository.update(decisionId, {
      isContributionRoundLocked: false,
      contributionRoundLockedAt: null,
    });

    if (!updated) {
      throw new DecisionNotFoundError(decisionId);
    }

    return updated;
  }

  /**
   * Explicit adoption of expert scores into the decision's core score matrix (Owner only).
   */
  async adoptExpertScores(
    decisionId: string,
    contributionId: string,
    requester: RequesterContext
  ): Promise<DecisionDocument> {
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

    // Owner or admin only
    await authorizeDecisionAction(decision, 'edit', requester);

    const contribution = await contributionRepository.findById(contributionId);
    if (!contribution || contribution.decisionId.toString() !== decisionId) {
      throw new ContributionNotFoundError('Contribution not found for this decision');
    }

    if (contribution.status !== 'submitted') {
      throw new ForbiddenError('Only submitted contributions can be adopted');
    }

    const preferredOptionId = contribution.recommendation.preferredOptionId;
    const expertCriterionScores = contribution.criterionScores || {};

    // Copy existing scores matrix and merge the expert's scores for the preferred option
    const newScores = JSON.parse(JSON.stringify(decision.scores || {}));
    if (!newScores[preferredOptionId]) {
      newScores[preferredOptionId] = {};
    }

    for (const [criterionId, scoreVal] of Object.entries(expertCriterionScores)) {
      if (typeof scoreVal === 'number') {
        newScores[preferredOptionId][criterionId] = scoreVal;
      }
    }

    // Update decision and re-run canonical MCDA analysis deterministically
    return updateDecision(decisionId, { scores: newScores }, requester);
  }
}

export const contributionService = new ContributionService();

