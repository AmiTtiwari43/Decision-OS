import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DecisionApiClient } from '../api/client.js';
import type {
  InvitationDto,
  CreateInvitationResponseDto,
  DecisionAccessListDto,
  AccessGrantCollaboratorDto,
} from '../api/types.js';

describe('Decision OS — Frontend Sharing & Invitation Integration Tests', () => {
  const originalFetch = globalThis.fetch;
  let client: DecisionApiClient;

  const decisionId = '654321654321654321654321';

  beforeEach(() => {
    client = new DecisionApiClient({ baseUrl: 'http://localhost:3000' });
    client.setToken('valid-jwt-token-alpha');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('1. creates an invitation and returns secure token and metadata', async () => {
    const mockCreatedResponse: CreateInvitationResponseDto = {
      invitation: {
        id: 'inv-12345',
        decisionId,
        email: 'colleague@example.com',
        role: 'editor',
        status: 'pending',
        expiresAt: '2026-11-05T12:00:00.000Z',
        createdAt: '2026-10-29T12:00:00.000Z',
        updatedAt: '2026-10-29T12:00:00.000Z',
      },
      token: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      invitationLink: '/invite?token=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockCreatedResponse,
    });
    globalThis.fetch = fetchMock;

    const res = await client.createInvitation(decisionId, {
      email: 'colleague@example.com',
      role: 'editor',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/invitations`);
    expect(options.method).toBe('POST');
    expect(options.headers.get('Authorization')).toBe('Bearer valid-jwt-token-alpha');
    expect(JSON.parse(options.body)).toEqual({
      email: 'colleague@example.com',
      role: 'editor',
    });

    expect(res.invitation.role).toBe('editor');
    expect(res.token).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('2. lists active invitations for a decision', async () => {
    const mockInvitations: InvitationDto[] = [
      {
        id: 'inv-1',
        decisionId,
        email: 'collaborator@example.com',
        role: 'viewer',
        status: 'pending',
        expiresAt: '2026-11-05T12:00:00.000Z',
        createdAt: '2026-10-29T12:00:00.000Z',
        updatedAt: '2026-10-29T12:00:00.000Z',
      },
    ];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ items: mockInvitations }),
    });
    globalThis.fetch = fetchMock;

    const res = await client.listInvitations(decisionId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/invitations`);
    expect(options.method).toBe('GET');
    expect(res.items.length).toBe(1);
    expect(res.items[0].email).toBe('collaborator@example.com');
  });

  it('3. revokes a pending invitation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ message: 'Invitation revoked successfully' }),
    });
    globalThis.fetch = fetchMock;

    await client.revokeInvitation(decisionId, 'inv-123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/invitations/inv-123`);
    expect(options.method).toBe('DELETE');
  });

  it('4. lists active access grants and collaborators', async () => {
    const mockAccessList: DecisionAccessListDto = {
      owner: {
        id: 'owner-1',
        name: 'Decision Owner',
        email: 'owner@example.com',
      },
      collaborators: [
        {
          id: 'grant-1',
          user: {
            id: 'collab-1',
            name: 'Collaborator One',
            email: 'collab1@example.com',
          },
          role: 'editor',
          createdAt: '2026-10-29T12:00:00.000Z',
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockAccessList,
    });
    globalThis.fetch = fetchMock;

    const res = await client.listAccessGrants(decisionId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/access`);
    expect(options.method).toBe('GET');
    expect(res.owner?.email).toBe('owner@example.com');
    expect(res.collaborators.length).toBe(1);
    expect(res.collaborators[0].role).toBe('editor');
  });

  it('5. updates collaborator access role', async () => {
    const mockUpdatedGrant: AccessGrantCollaboratorDto = {
      id: 'grant-1',
      user: {
        id: 'collab-1',
        name: 'Collaborator One',
        email: 'collab1@example.com',
      },
      role: 'viewer',
      createdAt: '2026-10-29T12:00:00.000Z',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockUpdatedGrant,
    });
    globalThis.fetch = fetchMock;

    const res = await client.updateAccessGrant(decisionId, 'grant-1', { role: 'viewer' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/access/grant-1`);
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ role: 'viewer' });
    expect(res.role).toBe('viewer');
  });

  it('6. revokes collaborator access grant', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers(),
    });
    globalThis.fetch = fetchMock;

    await client.revokeAccess(decisionId, 'grant-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/access/grant-1`);
    expect(options.method).toBe('DELETE');
  });

  it('7. accepts invitation with token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        message: 'Invitation accepted successfully',
        decisionId,
        role: 'editor',
      }),
    });
    globalThis.fetch = fetchMock;

    const res = await client.acceptInvitation({ token: 'test-token-hex' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/invitations/accept');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ token: 'test-token-hex' });
    expect(res.decisionId).toBe(decisionId);
    expect(res.role).toBe('editor');
  });
});

