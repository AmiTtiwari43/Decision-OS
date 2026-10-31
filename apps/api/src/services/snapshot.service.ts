import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  snapshotRepository,
  decisionRepository,
  evidenceRepository,
  contributionRepository,
  predictionRepository,
  disagreementRepository,
} from '../repositories/index.js';
import { authorizeDecisionAction } from './authorization.service.js';
import { auditService } from './audit.service.js';
import type { RequesterContext } from './decision.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  SnapshotNotFoundError,
} from '../errors/domain.errors.js';
import type {
  DecisionSnapshotDto,
  IDecisionSnapshot,
  DecisionCriterion,
  DecisionOption,
  ScoreMatrix,
} from '../models/index.js';

export interface CreateSnapshotInput {
  decisionId: string;
  reason?: 'calculation' | 'milestone' | 'manual' | 'round_lock';
  note?: string;
  requester?: RequesterContext;
}

export class SnapshotService {
  /**
   * Captures an immutable milestone snapshot of the current decision state and analysis.
   */
  async createSnapshot(input: CreateSnapshotInput): Promise<DecisionSnapshotDto> {
    const { decisionId, reason = 'manual', note, requester } = input;

    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    // Only editors or owners can manually capture milestone snapshots
    await authorizeDecisionAction(decision, 'edit', requester);

    // Collect related entity counts
    const [evidenceItems, contributions, predictions, disagreements, nextVersion] =
      await Promise.all([
        evidenceRepository.list({ decisionId }),
        contributionRepository.listByDecision(decisionId),
        predictionRepository.listByDecision(decisionId),
        disagreementRepository.listByDecision(decisionId),
        snapshotRepository.getNextVersion(decisionId),
      ]);

    const snapshotId = crypto.randomUUID();
    const createdById = requester?.id || decision.ownerId?.toString() || 'system';

    const snapshotData: Omit<IDecisionSnapshot, 'updatedAt'> = {
      snapshotId,
      decisionId: new mongoose.Types.ObjectId(decisionId),
      version: nextVersion,
      title: decision.title,
      description: decision.description || '',
      criteria: JSON.parse(JSON.stringify(decision.criteria || [])) as DecisionCriterion[],
      options: JSON.parse(JSON.stringify(decision.options || [])) as DecisionOption[],
      scores: JSON.parse(JSON.stringify(decision.scores || {})) as ScoreMatrix,
      analysis: decision.analysis ? JSON.parse(JSON.stringify(decision.analysis)) : null,
      metadata: {
        evidenceCount: evidenceItems.length,
        contributionCount: contributions.length,
        predictionCount: predictions.length,
        disagreementCount: disagreements.length,
      },
      snapshotReason: reason,
      snapshotNote: note,
      createdAt: new Date(),
      createdById,
    };

    const saved = await snapshotRepository.create(snapshotData);

    // Record audit event
    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'snapshot.created',
      entityType: 'snapshot',
      entityId: snapshotId,
      summary: `Created decision snapshot v${nextVersion} (${reason})${note ? `: ${note}` : ''}`,
      diff: {
        after: {
          version: nextVersion,
          reason,
          note,
        },
      },
    });

    return {
      snapshotId: saved.snapshotId,
      decisionId: saved.decisionId.toString(),
      version: saved.version,
      title: saved.title,
      description: saved.description,
      criteria: saved.criteria,
      options: saved.options,
      scores: saved.scores,
      analysis: saved.analysis,
      metadata: saved.metadata,
      snapshotReason: saved.snapshotReason,
      snapshotNote: saved.snapshotNote,
      createdAt: saved.createdAt.toISOString(),
      createdById: saved.createdById,
    };
  }

  /**
   * Lists historical snapshots for a decision.
   */
  async listSnapshots(
    decisionId: string,
    requester?: RequesterContext
  ): Promise<DecisionSnapshotDto[]> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    const snapshots = await snapshotRepository.listByDecisionId(decisionId);

    return snapshots.map(s => ({
      snapshotId: s.snapshotId,
      decisionId: s.decisionId.toString(),
      version: s.version,
      title: s.title,
      description: s.description,
      criteria: s.criteria,
      options: s.options,
      scores: s.scores,
      analysis: s.analysis,
      metadata: s.metadata,
      snapshotReason: s.snapshotReason,
      snapshotNote: s.snapshotNote,
      createdAt: s.createdAt.toISOString(),
      createdById: s.createdById,
    }));
  }

  /**
   * Retrieves a specific snapshot by its unique UUID.
   */
  async getSnapshotById(
    snapshotId: string,
    requester?: RequesterContext
  ): Promise<DecisionSnapshotDto> {
    const snapshot = await snapshotRepository.findBySnapshotId(snapshotId);
    if (!snapshot) {
      throw new SnapshotNotFoundError(`Snapshot "${snapshotId}" not found`);
    }

    const decision = await decisionRepository.findById(snapshot.decisionId.toString());
    if (!decision) {
      throw new DecisionNotFoundError(snapshot.decisionId.toString());
    }
    await authorizeDecisionAction(decision, 'read', requester);

    return {
      snapshotId: snapshot.snapshotId,
      decisionId: snapshot.decisionId.toString(),
      version: snapshot.version,
      title: snapshot.title,
      description: snapshot.description,
      criteria: snapshot.criteria,
      options: snapshot.options,
      scores: snapshot.scores,
      analysis: snapshot.analysis,
      metadata: snapshot.metadata,
      snapshotReason: snapshot.snapshotReason,
      snapshotNote: snapshot.snapshotNote,
      createdAt: snapshot.createdAt.toISOString(),
      createdById: snapshot.createdById,
    };
  }
}

export const snapshotService = new SnapshotService();

