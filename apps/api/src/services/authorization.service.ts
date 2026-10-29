import type { DecisionDocument } from '../models/index.js';
import { decisionAccessRepository } from '../repositories/decisionAccess.repository.js';
import {
  DecisionNotFoundError,
  ForbiddenError,
} from '../errors/domain.errors.js';
import type { RequesterContext } from './decision.service.js';

export type DecisionRole = 'owner' | 'editor' | 'viewer';
export type DecisionAction = 'read' | 'edit' | 'analyze' | 'delete' | 'share';

/**
 * Resolves the effective role of a requester for a given decision.
 * Returns:
 * - 'owner' if user is system admin or decision owner.
 * - 'editor' or 'viewer' if user has an active DecisionAccessGrant.
 * - 'viewer' for legacy unowned decisions (read-only demonstration).
 * - null if user has no authorized relationship to this decision.
 */
export async function getDecisionRole(
  decision: DecisionDocument,
  requester?: RequesterContext
): Promise<DecisionRole | null> {
  // If no requester context is provided (internal programmatic/service invocations), permit full access
  if (!requester) {
    return 'owner';
  }

  // System administrators retain global oversight
  if (requester.role === 'admin') {
    return 'owner';
  }

  // If decision has an owner
  if (decision.ownerId) {
    if (decision.ownerId.toString() === requester.id) {
      return 'owner';
    }

    // Check explicit access grant
    const grant = await decisionAccessRepository.findByDecisionAndUser(
      decision._id.toString(),
      requester.id
    );

    if (grant) {
      return grant.role;
    }

    // No access
    return null;
  }

  // Legacy unowned decisions: viewable by all, but mutations restricted to admin
  return 'viewer';
}

/**
 * Central authorization policy enforcement.
 * Checks whether the requester is permitted to perform the specified action.
 *
 * Boundary rules:
 * - Unrelated users receive 404 DecisionNotFoundError (ID enumeration defense).
 * - Viewers cannot mutate, analyze, delete, or share (403 Forbidden).
 * - Editors cannot delete or share (403 Forbidden).
 * - Legacy unowned records cannot be mutated/deleted/shared by non-admins (404 DecisionNotFoundError).
 */
export async function authorizeDecisionAction(
  decision: DecisionDocument,
  action: DecisionAction,
  requester?: RequesterContext
): Promise<DecisionRole> {
  // If no requester context is provided (internal programmatic/service invocations), permit full access
  if (!requester) {
    return 'owner';
  }

  const role = await getDecisionRole(decision, requester);

  // If user has no authorized role, return 404 to avoid leaking decision existence
  if (!role) {
    throw new DecisionNotFoundError(decision._id.toString());
  }

  // Special handling for legacy unowned records: only admin can mutate/delete/share
  if (!decision.ownerId && requester?.role !== 'admin' && action !== 'read') {
    throw new DecisionNotFoundError(decision._id.toString());
  }

  switch (action) {
    case 'read':
      // Owner, Editor, and Viewer can all read
      return role;

    case 'edit':
      if (role === 'viewer') {
        throw new ForbiddenError('Viewers are not permitted to modify decision inputs');
      }
      return role;

    case 'analyze':
      if (role === 'viewer') {
        throw new ForbiddenError('Viewers are not permitted to run analysis on this decision');
      }
      return role;

    case 'delete':
      if (role !== 'owner') {
        throw new ForbiddenError('Only the decision owner can delete this decision');
      }
      return role;

    case 'share':
      if (role !== 'owner') {
        throw new ForbiddenError('Only the decision owner can manage sharing permissions and invitations');
      }
      return role;

    default:
      throw new ForbiddenError('Unknown or unauthorized action');
  }
}
