import mongoose from 'mongoose';
import {
  decisionRepository,
  userRepository,
  decisionAccessRepository,
  invitationRepository,
} from '../repositories/index.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  InvitationNotFoundError,
  InvitationExpiredError,
  InvitationRevokedError,
  InvitationAlreadyAcceptedError,
  InvitationRecipientMismatchError,
  ActiveInvitationExistsError,
  UserAlreadyHasAccessError,
  CannotInviteOwnerError,
  AccessGrantNotFoundError,
  ForbiddenError,
} from '../errors/domain.errors.js';
import {
  generateSecureToken,
  hashInvitationToken,
} from '../utils/crypto.js';
import { authorizeDecisionAction } from './authorization.service.js';
import type { RequesterContext } from './decision.service.js';
import type {
  DecisionCollaboratorRole,
  DecisionInvitationDocument,
  DecisionAccessGrantDocument,
} from '../models/index.js';

export interface CreateInvitationResult {
  invitation: DecisionInvitationDocument;
  token: string;
  invitationLink: string;
}

export interface DecisionAccessListResponse {
  owner: {
    id: string;
    name: string;
    email: string;
  } | null;
  collaborators: Array<{
    id: string;
    user: {
      id: string;
      name: string;
      email: string;
    };
    role: DecisionCollaboratorRole;
    createdAt: Date;
  }>;
}

export interface InvitationDetailsResponse {
  email: string;
  role: DecisionCollaboratorRole;
  status: string;
  expiresAt: Date;
  decisionTitle: string;
  inviterName?: string;
}

/**
 * Creates a new invitation for a decision.
 * Only the decision owner (or admin) can create invitations.
 */
export async function createInvitation(
  decisionId: string,
  email: string,
  role: DecisionCollaboratorRole,
  requester: RequesterContext
): Promise<CreateInvitationResult> {
  if (!mongoose.isValidObjectId(decisionId)) {
    throw new InvalidDecisionIdError(decisionId);
  }

  const decision = await decisionRepository.findById(decisionId);
  if (!decision) {
    throw new DecisionNotFoundError(decisionId);
  }

  // Enforce share authorization (owner or admin only)
  await authorizeDecisionAction(decision, 'share', requester);

  const normalizedEmail = email.toLowerCase().trim();

  // Validate that owner cannot invite themselves
  if (decision.ownerId) {
    const owner = await userRepository.findById(decision.ownerId.toString());
    if (owner && owner.email.toLowerCase() === normalizedEmail) {
      throw new CannotInviteOwnerError('Cannot invite the owner of the decision');
    }
  }
  if (requester.email && requester.email.toLowerCase().trim() === normalizedEmail) {
    throw new CannotInviteOwnerError('Cannot invite yourself to a decision you own');
  }

  // Check if target user already has an active access grant
  const targetUser = await userRepository.findByEmail(normalizedEmail);
  if (targetUser) {
    const existingGrant = await decisionAccessRepository.findByDecisionAndUser(
      decisionId,
      targetUser._id.toString()
    );
    if (existingGrant) {
      throw new UserAlreadyHasAccessError(
        `User '${normalizedEmail}' already has access to this decision with role '${existingGrant.role}'`
      );
    }
  }

  // Check if an active pending invitation already exists
  const existingInv = await invitationRepository.findPendingByDecisionAndEmail(
    decisionId,
    normalizedEmail
  );
  if (existingInv) {
    if (new Date() > existingInv.expiresAt) {
      await invitationRepository.markExpired(existingInv._id.toString());
    } else {
      throw new ActiveInvitationExistsError(
        `A pending invitation already exists for '${normalizedEmail}'`
      );
    }
  }

  // Generate cryptographic token and hash
  const rawToken = generateSecureToken();
  const tokenHash = hashInvitationToken(rawToken);

  const invitation = await invitationRepository.create({
    decisionId,
    inviterId: requester.id,
    email: normalizedEmail,
    role,
    tokenHash,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });

  return {
    invitation,
    token: rawToken,
    invitationLink: `/invite?token=${rawToken}`,
  };
}

/**
 * Lists all invitations for a decision.
 * Only the decision owner (or admin) can view invitations.
 */
export async function listInvitations(
  decisionId: string,
  requester: RequesterContext
): Promise<DecisionInvitationDocument[]> {
  if (!mongoose.isValidObjectId(decisionId)) {
    throw new InvalidDecisionIdError(decisionId);
  }

  const decision = await decisionRepository.findById(decisionId);
  if (!decision) {
    throw new DecisionNotFoundError(decisionId);
  }

  await authorizeDecisionAction(decision, 'share', requester);

  return invitationRepository.listByDecision(decisionId);
}

/**
 * Revokes a pending invitation.
 * Only the decision owner (or admin) can revoke invitations.
 */
export async function revokeInvitation(
  decisionId: string,
  invitationId: string,
  requester: RequesterContext
): Promise<DecisionInvitationDocument> {
  if (!mongoose.isValidObjectId(decisionId)) {
    throw new InvalidDecisionIdError(decisionId);
  }
  if (!mongoose.isValidObjectId(invitationId)) {
    throw new InvitationNotFoundError('Invalid invitation ID');
  }

  const decision = await decisionRepository.findById(decisionId);
  if (!decision) {
    throw new DecisionNotFoundError(decisionId);
  }

  await authorizeDecisionAction(decision, 'share', requester);

  const invitation = await invitationRepository.findById(invitationId);
  if (!invitation || invitation.decisionId.toString() !== decisionId) {
    throw new InvitationNotFoundError('Invitation not found for this decision');
  }

  if (invitation.status === 'accepted') {
    throw new ForbiddenError('Cannot revoke an already accepted invitation');
  }

  if (invitation.status === 'revoked') {
    return invitation;
  }

  const revoked = await invitationRepository.revoke(invitationId, requester.id);
  if (!revoked) {
    throw new InvitationNotFoundError('Invitation not found or could not be revoked');
  }

  return revoked;
}

/**
 * Lists users with access to a decision (owner and collaborators).
 */
export async function listAccessGrants(
  decisionId: string,
  requester: RequesterContext
): Promise<DecisionAccessListResponse> {
  if (!mongoose.isValidObjectId(decisionId)) {
    throw new InvalidDecisionIdError(decisionId);
  }

  const decision = await decisionRepository.findById(decisionId);
  if (!decision) {
    throw new DecisionNotFoundError(decisionId);
  }

  // Any user with read access can see who has access to the decision
  await authorizeDecisionAction(decision, 'read', requester);

  let ownerInfo: DecisionAccessListResponse['owner'] = null;
  if (decision.ownerId) {
    const owner = await userRepository.findById(decision.ownerId.toString());
    if (owner) {
      ownerInfo = {
        id: owner._id.toString(),
        name: owner.name,
        email: owner.email,
      };
    }
  }

  const rawGrants = await decisionAccessRepository.listByDecision(decisionId);

  const collaborators = rawGrants.map(grant => {
    const userDoc = grant.userId as unknown as {
      _id?: mongoose.Types.ObjectId;
      id?: string;
      name?: string;
      email?: string;
    };
    return {
      id: grant._id.toString(),
      user: {
        id: userDoc?._id?.toString() || userDoc?.id || grant.userId.toString(),
        name: userDoc?.name || 'Unknown',
        email: userDoc?.email || '',
      },
      role: grant.role,
      createdAt: grant.createdAt,
    };
  });

  return {
    owner: ownerInfo,
    collaborators,
  };
}

/**
 * Updates an existing collaborator's access role (e.g. editor -> viewer).
 * Only the decision owner (or admin) can alter access grants.
 */
export async function updateAccessGrant(
  decisionId: string,
  grantId: string,
  role: DecisionCollaboratorRole,
  requester: RequesterContext
): Promise<DecisionAccessGrantDocument> {
  if (!mongoose.isValidObjectId(decisionId)) {
    throw new InvalidDecisionIdError(decisionId);
  }
  if (!mongoose.isValidObjectId(grantId)) {
    throw new AccessGrantNotFoundError('Invalid grant ID');
  }

  const decision = await decisionRepository.findById(decisionId);
  if (!decision) {
    throw new DecisionNotFoundError(decisionId);
  }

  await authorizeDecisionAction(decision, 'share', requester);

  const grant = await decisionAccessRepository.findById(grantId);
  if (!grant || grant.decisionId.toString() !== decisionId) {
    throw new AccessGrantNotFoundError('Access grant not found for this decision');
  }

  const updated = await decisionAccessRepository.updateRole(grantId, role);
  if (!updated) {
    throw new AccessGrantNotFoundError('Failed to update access grant');
  }

  return updated;
}

/**
 * Revokes an existing collaborator's access grant.
 * Only the decision owner (or admin) can revoke access grants.
 */
export async function revokeAccessGrant(
  decisionId: string,
  grantId: string,
  requester: RequesterContext
): Promise<void> {
  if (!mongoose.isValidObjectId(decisionId)) {
    throw new InvalidDecisionIdError(decisionId);
  }
  if (!mongoose.isValidObjectId(grantId)) {
    throw new AccessGrantNotFoundError('Invalid grant ID');
  }

  const decision = await decisionRepository.findById(decisionId);
  if (!decision) {
    throw new DecisionNotFoundError(decisionId);
  }

  await authorizeDecisionAction(decision, 'share', requester);

  const grant = await decisionAccessRepository.findById(grantId);
  if (!grant || grant.decisionId.toString() !== decisionId) {
    throw new AccessGrantNotFoundError('Access grant not found for this decision');
  }

  await decisionAccessRepository.delete(grantId);
}

/**
 * Accepts an invitation using a raw cryptographic token.
 * Single-use, race-free redemption.
 */
export async function acceptInvitation(
  rawToken: string,
  requester: RequesterContext
): Promise<{ message: string; decisionId: string; role: DecisionCollaboratorRole }> {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new InvitationNotFoundError('Invalid invitation token');
  }

  const tokenHash = hashInvitationToken(rawToken);
  const invitation = await invitationRepository.findByTokenHash(tokenHash);

  if (!invitation) {
    throw new InvitationNotFoundError('Invitation not found or invalid token');
  }

  if (invitation.status === 'revoked') {
    throw new InvitationRevokedError('This invitation has been revoked by the decision owner');
  }

  if (invitation.status === 'accepted') {
    throw new InvitationAlreadyAcceptedError('This invitation has already been accepted');
  }

  if (new Date() > invitation.expiresAt) {
    await invitationRepository.markExpired(invitation._id.toString());
    throw new InvitationExpiredError('This invitation has expired');
  }

  // Recipient email verification: authenticated user email must match invitation email
  if (requester.email && requester.email.toLowerCase().trim() !== invitation.email.toLowerCase().trim()) {
    throw new InvitationRecipientMismatchError(
      `This invitation was issued to '${invitation.email}', but you are signed in as '${requester.email}'`
    );
  }

  // Ensure decision still exists
  const decision = await decisionRepository.findById(invitation.decisionId.toString());
  if (!decision) {
    throw new DecisionNotFoundError(invitation.decisionId.toString());
  }

  // Prevent decision owner from accepting an invitation to their own decision
  if (decision.ownerId && decision.ownerId.toString() === requester.id) {
    throw new CannotInviteOwnerError('You are already the owner of this decision');
  }

  // Atomic state transition: ensures single-use redemption even under concurrent requests
  const accepted = await invitationRepository.accept(invitation._id.toString(), requester.id);
  if (!accepted) {
    throw new InvitationAlreadyAcceptedError(
      'Invitation has already been accepted or is no longer pending'
    );
  }

  // Create or update the access grant consistently
  try {
    const existingGrant = await decisionAccessRepository.findByDecisionAndUser(
      invitation.decisionId.toString(),
      requester.id
    );

    if (existingGrant) {
      await decisionAccessRepository.updateRole(existingGrant._id.toString(), invitation.role);
    } else {
      await decisionAccessRepository.create({
        decisionId: invitation.decisionId,
        userId: requester.id,
        role: invitation.role,
        grantedBy: invitation.inviterId,
      });
    }
  } catch (err) {
    // Rollback atomic acceptance if grant creation fails to preserve consistency
    await invitationRepository.rollbackAcceptance(invitation._id.toString());
    throw err;
  }

  return {
    message: 'Invitation accepted successfully',
    decisionId: invitation.decisionId.toString(),
    role: invitation.role,
  };
}

/**
 * Retrieves public details of an invitation by token without accepting it.
 */
export async function getInvitationDetails(rawToken: string): Promise<InvitationDetailsResponse> {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new InvitationNotFoundError('Invalid invitation token');
  }

  const tokenHash = hashInvitationToken(rawToken);
  const invitation = await invitationRepository.findByTokenHash(tokenHash);

  if (!invitation) {
    throw new InvitationNotFoundError('Invitation not found or invalid token');
  }

  const decision = await decisionRepository.findById(invitation.decisionId.toString());
  const inviter = await userRepository.findById(invitation.inviterId.toString());

  return {
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    decisionTitle: decision?.title || 'Decision',
    inviterName: inviter?.name || 'A team member',
  };
}

/**
 * Lists pending invitations for the authenticated user based on their email.
 */
export async function listPendingInvitationsForUser(
  email: string
): Promise<DecisionInvitationDocument[]> {
  return invitationRepository.listPendingByEmail(email);
}

