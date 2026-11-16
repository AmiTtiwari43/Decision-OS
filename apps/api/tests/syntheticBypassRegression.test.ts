import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection';
import { assertTestDatabase, getTestDatabaseUri } from '../src/db/guard';
import { DecisionModel } from '../src/models/decision.model';
import { UserModel } from '../src/models/user.model';
import { DecisionAccessGrantModel } from '../src/models/decisionAccess.model';
import { DecisionContributionModel } from '../src/models/contribution.model';
import { createDecision } from '../src/services/decision.service';

const TEST_MONGODB_URI = getTestDatabaseUri(undefined, { runId: 'synthetic_bypass' });
assertTestDatabase(TEST_MONGODB_URI);

/**
 * F05 regression: synthetic demo values must never produce an authoritative
 * result. Before this fix, expert adoption and decision analytics both ran the
 * engine and reported authoritative output while synthetic cells remained.
 */
describe('Synthetic score authoritative-analysis bypasses', () => {
  let app: FastifyInstance;
  let ownerId: string;
  let ownerToken: string;
  let expertId: string;
  let expertToken: string;
  let decisionId: string;

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await Promise.all([
      UserModel.deleteMany({}),
      DecisionModel.deleteMany({}),
      DecisionAccessGrantModel.deleteMany({}),
      DecisionContributionModel.deleteMany({}),
    ]);
    const owner = await UserModel.create({ email: 'syn-owner@example.com', passwordHash: 'x', name: 'Owner', role: 'user' });
    const expert = await UserModel.create({ email: 'syn-expert@example.com', passwordHash: 'x', name: 'Expert', role: 'user' });
    ownerId = owner._id.toString();
    expertId = expert._id.toString();
    ownerToken = app.jwt.sign({ sub: ownerId, id: ownerId, email: owner.email, name: owner.name, role: 'user' });
    expertToken = app.jwt.sign({ sub: expertId, id: expertId, email: expert.email, name: expert.name, role: 'user' });

    // Option 'a' fully scored; option 'b' entirely missing -> demo-filled below.
    const doc = await createDecision(
      {
        title: 'Synthetic bypass decision',
        criteria: [
          { id: 'c1', name: 'Speed', weight: 50, direction: 'benefit', isLocked: false },
          { id: 'c2', name: 'Cost', weight: 50, direction: 'benefit', isLocked: false },
        ],
        options: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        scores: { a: { c1: 70, c2: 60 } },
      },
      { id: ownerId, email: owner.email, name: owner.name, role: 'user' }
    );
    decisionId = doc._id.toString();
    await DecisionAccessGrantModel.create({ decisionId: doc._id, userId: expertId, role: 'contributor', grantedBy: ownerId });

    const fill = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decisionId}/populate-synthetic-demo`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { defaultValue: 50 },
    });
    expect(fill.statusCode).toBe(200);
  });

  async function submitAndAdopt(criterionScores: Record<string, number>, selectedCriterionIds?: string[]) {
    const save = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decisionId}/contributions`,
      headers: { authorization: `Bearer ${expertToken}` },
      payload: { preferredOptionId: 'b', criterionScores },
    });
    expect(save.statusCode).toBeLessThan(300);
    const contributionId = save.json().id;
    const submit = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decisionId}/contributions/submit`,
      headers: { authorization: `Bearer ${expertToken}` },
    });
    expect(submit.statusCode).toBeLessThan(300);

    const current = await DecisionModel.findById(decisionId).lean();
    return app.inject({
      method: 'POST',
      url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { confirmation: true, expectedVersion: current!.version, ...(selectedCriterionIds ? { selectedCriterionIds } : {}) },
    });
  }

  it('partial adoption clears only adopted synthetic cells and does not produce an authoritative analysis', async () => {
    const res = await submitAndAdopt({ c1: 90, c2: 80 }, ['c1']);
    expect(res.statusCode).toBe(200);

    const after = await DecisionModel.findById(decisionId).lean();
    expect(after?.scores?.b?.c1).toBe(90);
    expect(after?.scoreProvenance?.b?.c1).toBeUndefined();
    expect(after?.scoreProvenance?.b?.c2?.isSynthetic).toBe(true);
    expect(after?.analysis ?? null).toBeNull();
  });

  it('adoption that replaces every synthetic cell yields an authoritative analysis', async () => {
    const res = await submitAndAdopt({ c1: 90, c2: 80 });
    expect(res.statusCode).toBe(200);

    const after = await DecisionModel.findById(decisionId).lean();
    expect(after?.scoreProvenance?.b ?? {}).toEqual({});
    expect(after?.analysis?.winnerId).toBe('b');
  });

  it('decision analytics is not authoritative and names no winner while synthetic cells remain', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decisionId}/analytics`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isAuthoritative).toBe(false);
    expect(body.winner).toBeNull();
  });
});
