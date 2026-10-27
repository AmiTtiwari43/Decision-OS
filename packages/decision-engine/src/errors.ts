export class ValidationError extends Error {
  readonly code: string;

  constructor(message: string, code: string = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
