import { ValidationError } from './errors';
import type { EngineCriterion, EngineOption } from './types';

export function validateInput(
  criteria: ReadonlyArray<EngineCriterion>,
  options: ReadonlyArray<EngineOption>
): void {
  if (!criteria || criteria.length === 0) {
    throw new ValidationError('Decision matrix must contain at least one criterion');
  }

  if (!options || options.length === 0) {
    throw new ValidationError('Decision matrix must contain at least one option to evaluate');
  }

  const seenCriterionIds = new Set<string>();
  for (const c of criteria) {
    if (!c.id || typeof c.id !== 'string') {
      throw new ValidationError('Criterion must have a valid string id');
    }
    if (seenCriterionIds.has(c.id)) {
      throw new ValidationError(`Duplicate criterion ID '${c.id}' detected`);
    }
    seenCriterionIds.add(c.id);

    if (typeof c.weight !== 'number' || !Number.isFinite(c.weight)) {
      throw new ValidationError(`Weight for criterion '${c.id}' must be a finite number`);
    }
    if (c.weight < 0.0) {
      throw new ValidationError(`Weight for criterion '${c.id}' cannot be negative (${c.weight})`);
    }
  }

  const seenOptionIds = new Set<string>();
  for (const opt of options) {
    if (!opt.id || typeof opt.id !== 'string') {
      throw new ValidationError('Option must have a valid string id');
    }
    if (seenOptionIds.has(opt.id)) {
      throw new ValidationError(`Duplicate option ID '${opt.id}' detected`);
    }
    seenOptionIds.add(opt.id);

    if (!opt.scores || typeof opt.scores !== 'object') {
      throw new ValidationError(`Option '${opt.id}' is missing a scores object`);
    }

    for (const c of criteria) {
      const score = opt.scores[c.id];
      if (score === undefined || score === null) {
        throw new ValidationError(`Option '${opt.id}' is missing required score for criterion '${c.id}'`);
      }
      if (typeof score !== 'number' || !Number.isFinite(score)) {
        throw new ValidationError(`Score for option '${opt.id}' on criterion '${c.id}' must be a finite number`);
      }
      if (score < 0.0 || score > 100.0) {
        throw new ValidationError(
          `Score for option '${opt.id}' on criterion '${c.id}' must be between 0.0 and 100.0 (received ${score})`
        );
      }
    }
  }
}
