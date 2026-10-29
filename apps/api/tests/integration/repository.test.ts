import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  connectToDatabase,
  disconnectFromDatabase,
} from '../../src/db/connection';
import { assertTestDatabase } from '../../src/db/guard';
import { decisionRepository } from '../../src/repositories/decision.repository';
import { DecisionModel } from '../../src/models/decision.model';

const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os_test';

describe('Decision Repository MongoDB Integration', () => {
  // Test DB guard MUST verify test database URI
  assertTestDatabase(TEST_MONGODB_URI);

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
  });

  afterAll(async () => {
    // Clean up test collection and disconnect
    await DecisionModel.deleteMany({});
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    // Isolate each test by clearing the test collection
    await DecisionModel.deleteMany({});
  });

  it('creates a real Decision document and retrieves it via findById', async () => {
    const input = {
      title: 'Senior Staff Engineer Offer Evaluation',
      description: 'Comparing Stripe vs Figma vs Datadog',
      criteria: [
        { id: 'growth', name: 'Career Growth', weight: 35, direction: 'benefit' as const },
        { id: 'comp', name: 'Compensation', weight: 35, direction: 'benefit' as const },
        { id: 'wlb', name: 'Work-Life Balance', weight: 30, direction: 'benefit' as const },
      ],
      options: [
        { id: 'stripe', name: 'Stripe', color: '#6366f1' },
        { id: 'figma', name: 'Figma', color: '#ec4899' },
      ],
      scores: {
        stripe: { growth: 90, comp: 95, wlb: 70 },
        figma: { growth: 85, comp: 80, wlb: 85 },
      },
    };

    const created = await decisionRepository.create(input);
    expect(created).toBeDefined();
    expect(created._id).toBeDefined();
    expect(created.title).toBe(input.title);
    expect(created.criteria).toHaveLength(3);
    expect(created.options).toHaveLength(2);
    expect(created.scores).toEqual(input.scores);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    // Retrieve from database
    const found = await decisionRepository.findById(created._id.toString());
    expect(found).not.toBeNull();
    expect(found!.title).toBe(input.title);
    expect(found!.criteria[0].name).toBe('Career Growth');
    expect(found!.scores['stripe']['comp']).toBe(95);
  });

  it('handles invalid ObjectId and non-existent IDs gracefully', async () => {
    const invalidIdResult = await decisionRepository.findById('invalid-not-an-id');
    expect(invalidIdResult).toBeNull();

    const nonExistentResult = await decisionRepository.findById('507f1f77bcf86cd799439011');
    expect(nonExistentResult).toBeNull();
  });

  it('updates an existing Decision and maintains timestamp integrity', async () => {
    const created = await decisionRepository.create({
      title: 'Original Title',
      description: 'Draft note',
      criteria: [{ id: 'c1', name: 'Speed', weight: 50, direction: 'benefit' as const }],
      options: [{ id: 'opt1', name: 'Vite' }],
      scores: { opt1: { c1: 90 } },
    });

    const originalCreatedAt = created.createdAt.getTime();
    const originalUpdatedAt = created.updatedAt.getTime();

    // Small delay to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 20));

    const updated = await decisionRepository.update(created._id.toString(), {
      title: 'Revised Architecture Decision',
      description: 'Updated after review',
    });

    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('Revised Architecture Decision');
    expect(updated!.description).toBe('Updated after review');
    expect(updated!.createdAt.getTime()).toBe(originalCreatedAt);
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt);

    // Verify persisted state in MongoDB
    const persisted = await decisionRepository.findById(created._id.toString());
    expect(persisted!.title).toBe('Revised Architecture Decision');
    expect(persisted!.createdAt.getTime()).toBe(originalCreatedAt);
  });

  it('deletes an existing Decision document and verifies removal', async () => {
    const created = await decisionRepository.create({
      title: 'Decision to be deleted',
    });

    const deleted = await decisionRepository.delete(created._id.toString());
    expect(deleted).toBe(true);

    const check = await decisionRepository.findById(created._id.toString());
    expect(check).toBeNull();

    // Deleting again returns false
    const deleteAgain = await decisionRepository.delete(created._id.toString());
    expect(deleteAgain).toBe(false);

    // Deleting with invalid ID returns false
    const deleteInvalid = await decisionRepository.delete('invalid-id');
    expect(deleteInvalid).toBe(false);
  });

  it('lists decisions with bounded pagination and chronological sorting', async () => {
    // Create 3 documents sequentially
    await decisionRepository.create({ title: 'Decision Alpha' });
    await new Promise(r => setTimeout(r, 10));
    await decisionRepository.create({ title: 'Decision Beta' });
    await new Promise(r => setTimeout(r, 10));
    await decisionRepository.create({ title: 'Decision Gamma' });

    // Page 1 with limit 2
    const page1 = await decisionRepository.list(undefined, { page: 1, limit: 2 });
    expect(page1.total).toBe(3);
    expect(page1.items).toHaveLength(2);
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(2);
    expect(page1.totalPages).toBe(2);
    // Ordered by createdAt: -1 (newest first: Gamma then Beta)
    expect(page1.items[0].title).toBe('Decision Gamma');
    expect(page1.items[1].title).toBe('Decision Beta');

    // Page 2
    const page2 = await decisionRepository.list(undefined, { page: 2, limit: 2 });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].title).toBe('Decision Alpha');
  });

  it('supports search filtering in decision listing', async () => {
    await decisionRepository.create({ title: 'Frontend Architecture Review' });
    await decisionRepository.create({ title: 'Database Selection Matrix' });
    await decisionRepository.create({ title: 'Frontend State Management' });

    const searchResult = await decisionRepository.list({ search: 'Frontend' });
    expect(searchResult.total).toBe(2);
    expect(searchResult.items.map(d => d.title)).toContain('Frontend Architecture Review');
    expect(searchResult.items.map(d => d.title)).toContain('Frontend State Management');
  });
});
