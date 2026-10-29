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

// Re-export EngineResult so callers don't need a separate import
export type { EngineResult };
