import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ShowcaseSection } from '../components/ShowcaseSection.js';
import { DeliberationModal } from '../components/DeliberationModal.js';
import { apiClient } from '../api/index.js';
import type { DecisionDto } from '../api/index.js';

// Mock audioFx sound
vi.mock('../utils/audioFx.js', () => ({
  sound: {
    playTick: vi.fn(),
    playCelebrate: vi.fn(),
  },
}));

// Mock Auth hook
vi.mock('../hooks/useAuth.js', () => ({
  useAuth: () => ({
    user: { id: 'user-lead-1', name: 'Lead Architect', role: 'admin' },
    isAuthenticated: true,
  }),
}));

describe('Batch 03: Collaboration, AI Advisory & Cryptographic Audit Showcase Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ShowcaseSection Component', () => {
    it('renders Collaboration tab by default with stakeholder consensus metric', () => {
      const html = renderToString(React.createElement(ShowcaseSection));

      expect(html).toContain('Collaboration, AI Advisory &amp; Cryptographic Audit.');
      expect(html).toContain('Consensus Alignment');
      expect(html).toContain('88.4%');
      expect(html).toContain('Multi-Expert Collaboration');
      expect(html).toContain('Elena Rostova');
    });

    it('contains all three governance pillars in the navigation tabs', () => {
      const html = renderToString(React.createElement(ShowcaseSection));

      expect(html).toContain('Multi-Expert Collaboration');
      expect(html).toContain('AI Advisory Analyst');
      expect(html).toContain('Cryptographic Audit Chain');
    });
  });

  describe('DeliberationModal Component', () => {
    const mockDecision: DecisionDto = {
      _id: '507f1f77bcf86cd799439011',
      title: 'Cloud Provider Infrastructure',
      description: 'Evaluating enterprise migration',
      ownerId: 'user-lead-1',
      criteria: [],
      options: [],
      scores: {},
      analysis: null,
      calculationVersion: 1,
      isAudited: true,
      currentUserRole: 'owner',
      version: 2,
      createdAt: '2026-11-13T00:00:00.000Z',
      updatedAt: '2026-11-13T00:00:00.000Z',
    };

    it('renders empty when isOpen is false', () => {
      const html = renderToString(
        React.createElement(DeliberationModal, {
          isOpen: false,
          onClose: vi.fn(),
          decision: mockDecision,
        })
      );

      expect(html).toBe('');
    });

    it('renders modal header, filter controls, and empty state when opened', () => {
      const html = renderToString(
        React.createElement(DeliberationModal, {
          isOpen: true,
          onClose: vi.fn(),
          decision: mockDecision,
        })
      );

      expect(html).toContain('Stakeholder Deliberation &amp; Threaded Audit');
      expect(html).toContain('Cloud Provider Infrastructure');
      expect(html).toContain('Start a new deliberation thread or challenge a metric...');
    });
  });

  describe('apiClient Comment Methods Contract Suite', () => {
    it('formats query string correctly for getComments', async () => {
      const requestSpy = vi.spyOn(apiClient as any, 'request').mockResolvedValueOnce({ items: [] });

      await apiClient.getComments('dec-123', {
        targetType: 'decision',
        isResolved: false,
      });

      expect(requestSpy).toHaveBeenCalledWith(
        '/api/decisions/dec-123/comments?targetType=decision&isResolved=false',
        { method: 'GET' }
      );
    });

    it('invokes POST for createComment with JSON payload', async () => {
      const requestSpy = vi.spyOn(apiClient as any, 'request').mockResolvedValueOnce({ id: 'c-1' });

      await apiClient.createComment('dec-123', {
        content: 'Reviewing weights',
        targetType: 'decision',
      });

      expect(requestSpy).toHaveBeenCalledWith(
        '/api/decisions/dec-123/comments',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Reviewing weights', targetType: 'decision' }),
        })
      );
    });

    it('invokes PATCH for updateComment with content payload', async () => {
      const requestSpy = vi.spyOn(apiClient as any, 'request').mockResolvedValueOnce({ id: 'c-1' });

      await apiClient.updateComment('dec-123', 'c-1', {
        content: 'Updated reasoning',
      });

      expect(requestSpy).toHaveBeenCalledWith(
        '/api/decisions/dec-123/comments/c-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ content: 'Updated reasoning' }),
        })
      );
    });

    it('invokes DELETE for deleteComment', async () => {
      const requestSpy = vi.spyOn(apiClient as any, 'request').mockResolvedValueOnce({
        success: true,
        isDeleted: true,
        tombstoned: false,
      });

      await apiClient.deleteComment('dec-123', 'c-999');

      expect(requestSpy).toHaveBeenCalledWith(
        '/api/decisions/dec-123/comments/c-999',
        { method: 'DELETE' }
      );
    });

    it('invokes POST for resolveComment with isResolved boolean', async () => {
      const requestSpy = vi.spyOn(apiClient as any, 'request').mockResolvedValueOnce({
        id: 'c-1',
        isResolved: true,
      });

      await apiClient.resolveComment('dec-123', 'c-1', true);

      expect(requestSpy).toHaveBeenCalledWith(
        '/api/decisions/dec-123/comments/c-1/resolve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ isResolved: true }),
        })
      );
    });
  });
});
