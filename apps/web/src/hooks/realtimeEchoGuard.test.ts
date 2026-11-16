import { describe, it, expect } from 'vitest';
import { isOwnOrStaleUpdate } from './useRealtimeCollaboration';

describe('isOwnOrStaleUpdate (realtime echo suppression)', () => {
  it('ignores events at or below the version this client already holds', () => {
    expect(isOwnOrStaleUpdate({ version: 5, actorId: 'other' }, { knownVersion: 5 })).toBe(true);
    expect(isOwnOrStaleUpdate({ version: 4, actorId: 'other' }, { knownVersion: 5 })).toBe(true);
  });

  it("ignores echoes of the current user's own in-flight save", () => {
    expect(
      isOwnOrStaleUpdate({ version: 7, actorId: 'me' }, { knownVersion: 5, isSaving: true, currentUserId: 'me' })
    ).toBe(true);
  });

  it("surfaces another participant's newer change, even while saving", () => {
    expect(
      isOwnOrStaleUpdate({ version: 7, actorId: 'colleague' }, { knownVersion: 5, isSaving: true, currentUserId: 'me' })
    ).toBe(false);
  });

  it('surfaces a newer change by the same user when no save is in flight (e.g. another tab)', () => {
    expect(
      isOwnOrStaleUpdate({ version: 7, actorId: 'me' }, { knownVersion: 5, isSaving: false, currentUserId: 'me' })
    ).toBe(false);
  });

  it('treats events as new when the client holds no version yet', () => {
    expect(isOwnOrStaleUpdate({ version: 1, actorId: 'other' }, {})).toBe(false);
  });
});
