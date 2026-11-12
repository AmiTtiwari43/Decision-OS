import mongoose from 'mongoose';
import { decisionRepository } from '../repositories/decision.repository.js';
import { evidenceRepository } from '../repositories/evidence.repository.js';
import { DecisionContributionModel } from '../models/contribution.model.js';
import { UserModel } from '../models/user.model.js';
import { authorizeDecisionAction } from './authorization.service.js';
import { auditService } from './audit.service.js';
import { collaborationService } from './collaboration.service.js';
import type { RequesterContext } from './decision.service.js';
import type {
  DecisionEvidenceDocument,
  CreateEvidenceInput,
  UpdateEvidenceInput,
  ListEvidenceFilter,
  EvidenceCapturedVia,
  DecisionCriterion,
  DecisionOption,
} from '../models/index.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  EvidenceNotFoundError,
  InvalidEvidenceTargetError,
  ForbiddenError,
} from '../errors/domain.errors.js';

export class EvidenceService {
  /**
   * Validates that the targetType and targetId exist in the parent decision.
   */
  private async validateTarget(
    decision: { _id: mongoose.Types.ObjectId; options?: DecisionOption[]; criteria?: DecisionCriterion[] },
    targetType: string,
    targetId: string
  ): Promise<void> {
    if (targetType === 'decision') {
      if (targetId !== 'decision' && targetId !== decision._id.toString()) {
        throw new InvalidEvidenceTargetError(
          "For targetType 'decision', targetId must be 'decision' or the decision's ID"
        );
      }
      return;
    }

    if (targetType === 'option') {
      const options = (decision.options || []) as DecisionOption[];
      if (!options.some((o) => o.id === targetId)) {
        throw new InvalidEvidenceTargetError(
          `Option '${targetId}' does not exist in this decision`
        );
      }
      return;
    }

    if (targetType === 'criterion') {
      const criteria = (decision.criteria || []) as DecisionCriterion[];
      if (!criteria.some((c) => c.id === targetId)) {
        throw new InvalidEvidenceTargetError(
          `Criterion '${targetId}' does not exist in this decision`
        );
      }
      return;
    }

    if (targetType === 'contribution') {
      if (!mongoose.isValidObjectId(targetId)) {
        throw new InvalidEvidenceTargetError(`Invalid contribution ID '${targetId}'`);
      }
      const contrib = await DecisionContributionModel.findOne({
        _id: new mongoose.Types.ObjectId(targetId),
        decisionId: decision._id,
      });
      if (!contrib) {
        throw new InvalidEvidenceTargetError(
          `Contribution '${targetId}' does not exist in this decision`
        );
      }
      return;
    }

    throw new InvalidEvidenceTargetError(`Unknown targetType '${targetType}'`);
  }

  /**
   * Creates an evidence record.
   */
  async createEvidence(
    decisionId: string,
    input: CreateEvidenceInput,
    requester: RequesterContext
  ): Promise<DecisionEvidenceDocument> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    // Safeguard: Synthetic metadata cannot be accepted as evidence or verified assessment
    const rawInput = input as unknown as Record<string, unknown>;
    if (Boolean(rawInput.isSynthetic) || Boolean(rawInput.synthetic)) {
      throw new InvalidEvidenceTargetError(
        'Synthetic demonstration metadata cannot be accepted as verified evidence or assessment.'
      );
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    // Role check: contributors, editors, owners can create evidence. Viewers cannot.
    await authorizeDecisionAction(decision, 'contribute', requester);

    // Validate target exists in this decision
    await this.validateTarget(decision, input.targetType, input.targetId);

    let capturedVia: EvidenceCapturedVia = 'manual_entry';
    if (input.type === 'url') {
      capturedVia = 'web_link';
    } else if (input.documentReference) {
      capturedVia = 'document_citation';
    }

    let createdByName = requester.name;
    if (!createdByName && mongoose.isValidObjectId(requester.id)) {
      const userDoc = await UserModel.findById(requester.id).select('name');
      createdByName = userDoc?.name;
    }

    const provenance = {
      createdByName: createdByName || 'User',
      createdByEmail: requester.email || 'user@example.com',
      capturedVia,
    };

    const created = await evidenceRepository.create(decisionId, requester.id, provenance, input);

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'evidence.created',
      entityType: 'evidence',
      entityId: created._id.toString(),
      summary: `Attached evidence "${created.title}" to ${created.targetType}`,
      diff: {
        after: {
          title: created.title,
          targetType: created.targetType,
          targetId: created.targetId,
        },
      },
    });

    collaborationService.publishEvent(decisionId, {
      type: 'evidence.created',
      decisionId,
      version: decision.version || 1,
      actorId: requester.id,
      actorName: createdByName || requester.email,
      payload: {
        evidenceId: created._id.toString(),
        title: created.title,
        targetType: created.targetType,
        targetId: created.targetId,
      },
    });

    return created;
  }

  /**
   * Lists evidence records for a decision.
   */
  async listEvidence(
    filter: ListEvidenceFilter,
    requester: RequesterContext
  ): Promise<DecisionEvidenceDocument[]> {
    if (!mongoose.isValidObjectId(filter.decisionId)) {
      throw new InvalidDecisionIdError(filter.decisionId);
    }

    const decision = await decisionRepository.findById(filter.decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(filter.decisionId);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    return evidenceRepository.list(filter);
  }

  /**
   * Retrieves an evidence record by ID.
   */
  async getEvidence(
    decisionId: string,
    evidenceId: string,
    requester: RequesterContext
  ): Promise<DecisionEvidenceDocument> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }
    if (!mongoose.isValidObjectId(evidenceId)) {
      throw new EvidenceNotFoundError('Invalid evidence ID');
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    const doc = await evidenceRepository.findById(evidenceId);
    if (!doc || doc.decisionId.toString() !== decisionId) {
      throw new EvidenceNotFoundError('Evidence record not found for this decision');
    }

    return doc;
  }

  /**
   * Updates an evidence record.
   * Can be updated by the evidence author, the decision owner, or an admin.
   */
  async updateEvidence(
    decisionId: string,
    evidenceId: string,
    data: UpdateEvidenceInput,
    requester: RequesterContext
  ): Promise<DecisionEvidenceDocument> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }
    if (!mongoose.isValidObjectId(evidenceId)) {
      throw new EvidenceNotFoundError('Invalid evidence ID');
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    const doc = await evidenceRepository.findById(evidenceId);
    if (!doc || doc.decisionId.toString() !== decisionId) {
      throw new EvidenceNotFoundError('Evidence record not found for this decision');
    }

    const role = await authorizeDecisionAction(decision, 'read', requester);

    const isCreator = doc.createdById.toString() === requester.id;
    const isOwner = role === 'owner';
    const isAdmin = requester.role === 'admin';

    if (!isCreator && !isOwner && !isAdmin) {
      throw new ForbiddenError('Only the author or decision owner can modify this evidence record');
    }

    const updated = await evidenceRepository.update(evidenceId, data);
    if (!updated) {
      throw new EvidenceNotFoundError('Evidence record not found');
    }

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'evidence.updated',
      entityType: 'evidence',
      entityId: updated._id.toString(),
      summary: `Updated evidence "${updated.title}"`,
      diff: {
        changedFields: Object.keys(data),
      },
    });

    return updated;
  }

  /**
   * Deletes an evidence record.
   * Can be deleted by the author, the decision owner, or an admin.
   */
  async deleteEvidence(
    decisionId: string,
    evidenceId: string,
    requester: RequesterContext
  ): Promise<void> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }
    if (!mongoose.isValidObjectId(evidenceId)) {
      throw new EvidenceNotFoundError('Invalid evidence ID');
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    const doc = await evidenceRepository.findById(evidenceId);
    if (!doc || doc.decisionId.toString() !== decisionId) {
      throw new EvidenceNotFoundError('Evidence record not found for this decision');
    }

    const role = await authorizeDecisionAction(decision, 'read', requester);

    const isCreator = doc.createdById.toString() === requester.id;
    const isOwner = role === 'owner';
    const isAdmin = requester.role === 'admin';

    if (!isCreator && !isOwner && !isAdmin) {
      throw new ForbiddenError('Only the author or decision owner can delete this evidence record');
    }

    await evidenceRepository.delete(evidenceId);

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'evidence.deleted',
      entityType: 'evidence',
      entityId: evidenceId,
      summary: `Deleted evidence "${doc.title}"`,
    });
  }
}

export const evidenceService = new EvidenceService();

