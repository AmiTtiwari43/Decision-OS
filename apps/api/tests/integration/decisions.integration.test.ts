import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connectToDatabase, disconnectFromDatabase } from '../../src/db/connection';
import { assertTestDatabase } from '../../src/db/guard';
import { DecisionModel } from '../../src/models/decision.model';
import {
  createDecision,
  analyzeDecision,
  updateDecision,
} from '../../src/services/decision.service';

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os_test';

assertTestDatabase(TEST_MONGODB_URI);

const baseCriteria = [
  { id: 'cost', name: 'Cost', weight: 50, direction: 'benefit' as const },
  { id: 'perf', name: 'Performance', weight: 50, direction: 'benefit' as const },
];

const baseOptions = [
  { id: 'opt-a', name: 'Option A' },
  { id: 'opt-b', name: 'Option B' },
];

const completeScores = {
  'opt-a': { cost: 80, perf: 90 },
  'opt-b': { cost: 70, perf: 60 },
};

describe('Decision Service — MongoDB Integration', () => {
  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
  });

  afterAll(async () => {
    await DecisionModel.deleteMany({});
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await DecisionModel.deleteMany({});
  });

  it('1. Create → persisted document has correct fields', async () => {
    const doc = await createDecision({
      title: 'Integration Test Decision',
      description: 'Test description',
      criteria: baseCriteria,
      options: baseOptions,
      scores: {},
    });

    expect(doc._id).toBeDefined();
    expect(doc.title).toBe('Integration Test Decision');
    expect(doc.description).toBe('Test description');
    expect(doc.criteria).toHaveLength(2);
    expect(doc.options).toHaveLength(2);
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.updatedAt).toBeInstanceOf(Date);

    // Verify in DB
    const persisted = await DecisionModel.findById(doc._id).exec();
    expect(persisted).not.toBeNull();
    expect(persisted!.title).toBe('Integration Test Decision');
  });

  it('2. Create with complete scores → analysis persisted in MongoDB', async () => {
    const doc = await createDecision({
      title: 'Complete Decision',
      criteria: baseCriteria,
      options: baseOptions,
      scores: completeScores,
    });

    expect(doc.analysis).not.toBeNull();

    // Verify analysis is actually in the database
    const persisted = await DecisionModel.findById(doc._id).exec();
    expect(persisted).not.toBeNull();
    expect(persisted!.analysis).not.toBeNull();
    const analysis = persisted!.analysis as { engineVersion: string; winnerId: string | null };
    expect(analysis.engineVersion).toBe('1.0.0');
    expect(typeof analysis.winnerId === 'string' || analysis.winnerId === null).toBe(true);
  });

  it('3. Analyze → analysis stored matches response', async () => {
    const doc = await createDecision({
      title: 'Pre-analyze Decision',
      criteria: baseCriteria,
      options: baseOptions,
      scores: completeScores,
    });

    const analyzed = await analyzeDecision(doc._id.toString());
    expect(analyzed.analysis).not.toBeNull();

    // Verify the stored analysis matches what was returned
    const persisted = await DecisionModel.findById(doc._id).exec();
    expect(persisted).not.toBeNull();
    const storedAnalysis = persisted!.analysis as { winnerId: string | null };
    const responseAnalysis = analyzed.analysis as { winnerId: string | null };
    expect(storedAnalysis.winnerId).toBe(responseAnalysis.winnerId);
  });

  it('4. Failed analysis (incomplete) → document still has analysis: null', async () => {
    const { IncompleteScoresError } = await import('../../src/errors/domain.errors');

    const doc = await createDecision({
      title: 'Incomplete Decision',
      criteria: baseCriteria,
      options: baseOptions,
      scores: {}, // incomplete
    });

    expect(doc.analysis).toBeNull();

    await expect(analyzeDecision(doc._id.toString())).rejects.toThrow(IncompleteScoresError);

    // Verify document still has null analysis
    const persisted = await DecisionModel.findById(doc._id).exec();
    expect(persisted!.analysis).toBeNull();
  });

  it('5. Update clearing scores → analysis set to null in DB', async () => {
    const doc = await createDecision({
      title: 'Will clear scores',
      criteria: baseCriteria,
      options: baseOptions,
      scores: completeScores,
    });
    expect(doc.analysis).not.toBeNull();

    await updateDecision(doc._id.toString(), { scores: {} });

    const persisted = await DecisionModel.findById(doc._id).exec();
    expect(persisted!.analysis).toBeNull();
  });

  it('6. Update completing scores → analysis populated in DB', async () => {
    const doc = await createDecision({
      title: 'Will complete scores',
      criteria: baseCriteria,
      options: baseOptions,
      scores: {},
    });
    expect(doc.analysis).toBeNull();

    await updateDecision(doc._id.toString(), { scores: completeScores });

    const persisted = await DecisionModel.findById(doc._id).exec();
    expect(persisted!.analysis).not.toBeNull();
    const analysis = persisted!.analysis as { engineVersion: string };
    expect(analysis.engineVersion).toBe('1.0.0');
  });
});
