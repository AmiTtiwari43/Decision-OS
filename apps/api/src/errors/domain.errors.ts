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
 * A coordinate identifying a synthetic score.
 */
export interface SyntheticScoreCoordinate {
  optionId: string;
  criterionId: string;
  optionName?: string;
  criterionName?: string;
}

/**
 * Thrown when authoritative calculation is attempted on a decision containing synthetic demonstration values.
 */
export class SyntheticScoresPresentError extends Error {
  readonly statusCode = 422;
  readonly syntheticCoordinates: SyntheticScoreCoordinate[];

  constructor(syntheticCoordinates: SyntheticScoreCoordinate[]) {
    super(
      `Authoritative analysis cannot be calculated while synthetic demonstration scores remain. ` +
        `Replace synthetic scores with verified assessments at ${syntheticCoordinates.length} coordinate(s): ` +
        syntheticCoordinates.map(c => `option '${c.optionId}' × criterion '${c.criterionId}'`).join(', ')
    );
    this.name = 'SyntheticScoresPresentError';
    this.syntheticCoordinates = syntheticCoordinates;
    Object.setPrototypeOf(this, SyntheticScoresPresentError.prototype);
  }
}

/**
 * Thrown when an update attempts an unauthorized provenance transition or downgrade,
 * such as clearing synthetic status via ordinary update or setting isSynthetic to false.
 */
export class InvalidProvenanceTransitionError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidProvenanceTransitionError';
    Object.setPrototypeOf(this, InvalidProvenanceTransitionError.prototype);
  }
}

/**
 * Thrown when a replacement operation targets a coordinate that does not possess synthetic provenance.
 */
export class CoordinateNotSyntheticError extends Error {
  readonly statusCode = 422;

  constructor(optionId: string, criterionId: string) {
    super(
      `Coordinate option '${optionId}' × criterion '${criterionId}' does not have synthetic provenance to replace.`
    );
    this.name = 'CoordinateNotSyntheticError';
    Object.setPrototypeOf(this, CoordinateNotSyntheticError.prototype);
  }
}

/**
 * Thrown when a coordinate references a nonexistent option or criterion, or an invalid replacement score.
 */
export class InvalidScoreCoordinateError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidScoreCoordinateError';
    Object.setPrototypeOf(this, InvalidScoreCoordinateError.prototype);
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

/**
 * Thrown when a contribution is not found.
 */
export class ContributionNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message = 'Contribution not found') {
    super(message);
    this.name = 'ContributionNotFoundError';
    Object.setPrototypeOf(this, ContributionNotFoundError.prototype);
  }
}

/**
 * Thrown when attempting to create, revise, or submit a contribution while the round is locked.
 */
export class ContributionRoundLockedError extends Error {
  readonly statusCode = 403;

  constructor(message = 'The contribution round for this decision has been locked by the owner') {
    super(message);
    this.name = 'ContributionRoundLockedError';
    Object.setPrototypeOf(this, ContributionRoundLockedError.prototype);
  }
}

/**
 * Thrown when a preferredOptionId does not match any option in the decision.
 */
export class InvalidOptionReferenceError extends Error {
  readonly statusCode = 400;

  constructor(optionId: string) {
    super(`Option '${optionId}' does not exist in this decision`);
    this.name = 'InvalidOptionReferenceError';
    Object.setPrototypeOf(this, InvalidOptionReferenceError.prototype);
  }
}

/**
 * Thrown when a criterionId in scores or reasoning does not match any criterion in the decision.
 */
export class InvalidCriterionReferenceError extends Error {
  readonly statusCode = 400;

  constructor(criterionId: string) {
    super(`Criterion '${criterionId}' does not exist in this decision`);
    this.name = 'InvalidCriterionReferenceError';
    Object.setPrototypeOf(this, InvalidCriterionReferenceError.prototype);
  }
}

/**
 * Thrown when an evidence document cannot be found.
 */
export class EvidenceNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message = 'Evidence record not found') {
    super(message);
    this.name = 'EvidenceNotFoundError';
    Object.setPrototypeOf(this, EvidenceNotFoundError.prototype);
  }
}

export class DisagreementNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message = 'Disagreement not found') {
    super(message);
    this.name = 'DisagreementNotFoundError';
    Object.setPrototypeOf(this, DisagreementNotFoundError.prototype);
  }
}

/**
 * Thrown when an evidence targetId does not exist in the referenced decision.
 */
export class InvalidEvidenceTargetError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidEvidenceTargetError';
    Object.setPrototypeOf(this, InvalidEvidenceTargetError.prototype);
  }
}

/**
 * Thrown when the AI provider service is unavailable, unconfigured, or unreachable.
 */
export class AIProviderUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(message = 'The AI Analyst service is currently unavailable or unconfigured.') {
    super(message);
    this.name = 'AIProviderUnavailableError';
    Object.setPrototypeOf(this, AIProviderUnavailableError.prototype);
  }
}

/**
 * Thrown when the AI provider request times out.
 */
export class AITimeoutError extends Error {
  readonly statusCode = 504;

  constructor(message = 'The AI Analyst request timed out.') {
    super(message);
    this.name = 'AITimeoutError';
    Object.setPrototypeOf(this, AITimeoutError.prototype);
  }
}

/**
 * Thrown when the AI provider response fails schema validation after bounded retries.
 */
export class AIOutputValidationError extends Error {
  readonly statusCode = 502;

  constructor(message = 'The AI Analyst response did not conform to the required output schema.') {
    super(message);
    this.name = 'AIOutputValidationError';
    Object.setPrototypeOf(this, AIOutputValidationError.prototype);
  }
}

/**
 * Thrown when the AI provider returns a rate limit error.
 */
export class AIRateLimitError extends Error {
  readonly statusCode = 429;

  constructor(message = 'AI Analyst rate limit exceeded. Please try again later.') {
    super(message);
    this.name = 'AIRateLimitError';
    Object.setPrototypeOf(this, AIRateLimitError.prototype);
  }
}

// Re-export EngineResult so callers don't need a separate import
export type { EngineResult };

/**
 * Thrown when a prediction is not found by ID.
 */
export class PredictionNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message = 'Prediction not found') {
    super(message);
    this.name = 'PredictionNotFoundError';
    Object.setPrototypeOf(this, PredictionNotFoundError.prototype);
  }
}

/**
 * Thrown when a prediction is submitted after the target date or outcome date has already passed.
 */
export class RetrospectivePredictionError extends Error {
  readonly statusCode = 400;

  constructor(
    message = 'Predictions must be prospective. Submitting a forecast for an outcome that has already occurred is not permitted.'
  ) {
    super(message);
    this.name = 'RetrospectivePredictionError';
    Object.setPrototypeOf(this, RetrospectivePredictionError.prototype);
  }
}

/**
 * Thrown when an outcome date precedes the prediction submission date.
 */
export class InvalidOutcomeDateError extends Error {
  readonly statusCode = 400;

  constructor(
    message = 'Outcome date cannot precede the prediction submission timestamp.'
  ) {
    super(message);
    this.name = 'InvalidOutcomeDateError';
    Object.setPrototypeOf(this, InvalidOutcomeDateError.prototype);
  }
}

/**
 * Thrown when a decision snapshot is not found by ID.
 */
export class SnapshotNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message = 'Decision snapshot not found') {
    super(message);
    this.name = 'SnapshotNotFoundError';
    Object.setPrototypeOf(this, SnapshotNotFoundError.prototype);
  }
}

/**
 * Thrown when an optimistic concurrency conflict is detected.
 */
export class DecisionConflictError extends Error {
  readonly statusCode = 409;
  readonly currentVersion: number;

  constructor(
    currentVersion: number,
    message = `Decision has been modified by another participant (current version: ${currentVersion})`
  ) {
    super(message);
    this.name = 'DecisionConflictError';
    this.currentVersion = currentVersion;
    Object.setPrototypeOf(this, DecisionConflictError.prototype);
  }
}

/**
 * Thrown when an operation is attempted against a quarantined decision.
 */
export class DecisionQuarantinedError extends Error {
  readonly statusCode = 423;
  readonly decisionId: string;

  constructor(
    decisionId: string,
    message = 'Decision is quarantined due to unrecoverable audit desynchronization. Mutations are disabled.'
  ) {
    super(message);
    this.name = 'DecisionQuarantinedError';
    this.decisionId = decisionId;
    Object.setPrototypeOf(this, DecisionQuarantinedError.prototype);
  }
}

/**
 * Thrown when a recovery worker's fencing token is superseded or lease is lost.
 */
export class ConcurrencyFencingError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyFencingError';
    Object.setPrototypeOf(this, ConcurrencyFencingError.prototype);
  }
}

/**
 * Thrown when a comment is not found by ID.
 */
export class CommentNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message = 'Comment not found') {
    super(message);
    this.name = 'CommentNotFoundError';
    Object.setPrototypeOf(this, CommentNotFoundError.prototype);
  }
}

/**
 * Thrown when comment reply nesting exceeds the single-level limit (depth = 1).
 */
export class CommentDepthExceededError extends Error {
  readonly statusCode = 400;

  constructor(
    message = 'Replies cannot be nested deeper than 1 level; reply directly to the root comment'
  ) {
    super(message);
    this.name = 'CommentDepthExceededError';
    Object.setPrototypeOf(this, CommentDepthExceededError.prototype);
  }
}

/**
 * Thrown when comment resolution is attempted on a child reply rather than root comment.
 */
export class InvalidCommentResolutionError extends Error {
  readonly statusCode = 400;

  constructor(message = 'Resolution status can only be toggled on root comments') {
    super(message);
    this.name = 'InvalidCommentResolutionError';
    Object.setPrototypeOf(this, InvalidCommentResolutionError.prototype);
  }
}

/**
 * Thrown when a comment target reference is invalid or incongruent.
 */
export class InvalidCommentTargetError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidCommentTargetError';
    Object.setPrototypeOf(this, InvalidCommentTargetError.prototype);
  }
}

/**
 * Thrown when an action is performed on a contribution in an incompatible status.
 */
export class InvalidContributionStatusError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidContributionStatusError';
    Object.setPrototypeOf(this, InvalidContributionStatusError.prototype);
  }
}
