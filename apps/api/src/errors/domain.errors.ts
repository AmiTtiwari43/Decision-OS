import type { EngineResult } from '@decision-os/decision-engine';

/**
 * Thrown when a requested Decision document does not exist in the database.
 */
export class DecisionNotFoundError extends Error {
  readonly statusCode = 404;
  readonly id: string;

  constructor(id: string) {
    super(`Decision with id '${id}' not found`);
    this.name = 'DecisionNotFoundError';
    this.id = id;
    Object.setPrototypeOf(this, DecisionNotFoundError.prototype);
  }
}

/**
 * Thrown when a supplied decision ID is not a valid MongoDB ObjectId format.
 */
export class InvalidDecisionIdError extends Error {
  readonly statusCode = 400;
  readonly id: string;

  constructor(id: string) {
    super(`'${id}' is not a valid decision ID`);
    this.name = 'InvalidDecisionIdError';
    this.id = id;
    Object.setPrototypeOf(this, InvalidDecisionIdError.prototype);
  }
}

/**
 * A single option–criterion pair whose score is missing or out-of-range.
 */
export interface MissingScorePair {
  optionId: string;
  criterionId: string;
}

/**
 * Thrown when the score matrix is incomplete and a full analysis is requested.
 */
export class IncompleteScoresError extends Error {
  readonly statusCode = 422;
  readonly missingPairs: MissingScorePair[];

  constructor(missingPairs: MissingScorePair[]) {
    super(
      `Decision scores are incomplete. Missing ${missingPairs.length} score(s): ` +
        missingPairs.map(p => `option '${p.optionId}' × criterion '${p.criterionId}'`).join(', ')
    );
    this.name = 'IncompleteScoresError';
    this.missingPairs = missingPairs;
    Object.setPrototypeOf(this, IncompleteScoresError.prototype);
  }
}

/**
 * Thrown when the decision engine's internal ValidationError is raised.
 * Wraps the original engine error to keep the service layer decoupled.
 */
export class EngineValidationError extends Error {
  readonly statusCode = 422;
  readonly originalError: Error;

  constructor(originalError: Error) {
    super(`Engine validation failed: ${originalError.message}`);
    this.name = 'EngineValidationError';
    this.originalError = originalError;
    Object.setPrototypeOf(this, EngineValidationError.prototype);
  }
}

/**
 * Thrown when login fails due to incorrect email or password.
 * Generic message prevents account enumeration attacks.
 */
export class InvalidCredentialsError extends Error {
  readonly statusCode = 401;

  constructor(message = 'Invalid email or password') {
    super(message);
    this.name = 'InvalidCredentialsError';
    Object.setPrototypeOf(this, InvalidCredentialsError.prototype);
  }
}

/**
 * Thrown when registration is attempted with an existing email.
 */
export class UserAlreadyExistsError extends Error {
  readonly statusCode = 409;

  constructor(message = 'A user with this email address already exists') {
    super(message);
    this.name = 'UserAlreadyExistsError';
    Object.setPrototypeOf(this, UserAlreadyExistsError.prototype);
  }
}

/**
 * Thrown when an unauthenticated request attempts to access a protected resource.
 */
export class UnauthorizedError extends Error {
  readonly statusCode = 401;

  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

/**
 * Thrown when an authenticated user attempts an operation they lack permission for.
 */
export class ForbiddenError extends Error {
  readonly statusCode = 403;

  constructor(message = 'Insufficient permissions') {
    super(message);
    this.name = 'ForbiddenError';
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

/**
 * Thrown when an invitation token or ID is not found.
 */
export class InvitationNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message = 'Invitation not found or invalid token') {
    super(message);
    this.name = 'InvitationNotFoundError';
    Object.setPrototypeOf(this, InvitationNotFoundError.prototype);
  }
}

/**
 * Thrown when attempting to accept an expired invitation.
 */
export class InvitationExpiredError extends Error {
  readonly statusCode = 410;

  constructor(message = 'Invitation has expired') {
    super(message);
    this.name = 'InvitationExpiredError';
    Object.setPrototypeOf(this, InvitationExpiredError.prototype);
  }
}

/**
 * Thrown when attempting to accept a revoked invitation.
 */
export class InvitationRevokedError extends Error {
  readonly statusCode = 410;

  constructor(message = 'Invitation has been revoked') {
    super(message);
    this.name = 'InvitationRevokedError';
    Object.setPrototypeOf(this, InvitationRevokedError.prototype);
  }
}

/**
 * Thrown when attempting to accept an already redeemed invitation.
 */
export class InvitationAlreadyAcceptedError extends Error {
  readonly statusCode = 409;

  constructor(message = 'Invitation has already been accepted') {
    super(message);
    this.name = 'InvitationAlreadyAcceptedError';
    Object.setPrototypeOf(this, InvitationAlreadyAcceptedError.prototype);
  }
}

/**
 * Thrown when an authenticated user attempts to redeem an invitation issued to someone else.
 */
export class InvitationRecipientMismatchError extends Error {
  readonly statusCode = 403;

  constructor(message = 'This invitation was issued to another email address') {
    super(message);
    this.name = 'InvitationRecipientMismatchError';
    Object.setPrototypeOf(this, InvitationRecipientMismatchError.prototype);
  }
}

/**
 * Thrown when an active pending invitation already exists for the recipient.
 */
export class ActiveInvitationExistsError extends Error {
  readonly statusCode = 409;

  constructor(message = 'An active pending invitation already exists for this email') {
    super(message);
    this.name = 'ActiveInvitationExistsError';
    Object.setPrototypeOf(this, ActiveInvitationExistsError.prototype);
  }
}

/**
 * Thrown when attempting to invite a user who already has access.
 */
export class UserAlreadyHasAccessError extends Error {
  readonly statusCode = 409;

  constructor(message = 'User already has access to this decision') {
    super(message);
    this.name = 'UserAlreadyHasAccessError';
    Object.setPrototypeOf(this, UserAlreadyHasAccessError.prototype);
  }
}

/**
 * Thrown when attempting to invite the owner of the decision.
 */
export class CannotInviteOwnerError extends Error {
  readonly statusCode = 400;

  constructor(message = 'Cannot invite the owner of the decision') {
    super(message);
    this.name = 'CannotInviteOwnerError';
    Object.setPrototypeOf(this, CannotInviteOwnerError.prototype);
  }
}

/**
 * Thrown when a decision access grant is not found.
 */
export class AccessGrantNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message = 'Access grant not found') {
    super(message);
    this.name = 'AccessGrantNotFoundError';
    Object.setPrototypeOf(this, AccessGrantNotFoundError.prototype);
  }
}

// Re-export EngineResult so callers don't need a separate import
export type { EngineResult };
