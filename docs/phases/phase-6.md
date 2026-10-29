# Phase 6 — Sharing and Invitations

## Precondition
Phase 5 Authentication, User Identity, Decision Ownership & RBAC is complete, verified, and audited (`npm run verify` passing with 203 tests). The private decision security boundary is strictly enforced.

## Objective & Permission Boundary
Extend Decision OS to support secure, server-enforced collaborative decision sharing and invitation workflows.

The enforced permission boundary is:
$$\text{Authenticated User} \longrightarrow \text{Decision Ownership / Grant Check} \longrightarrow \text{Action Authorization Policy} \longrightarrow \text{Operation Execution}$$

Decisions remain private by default. Access to a shared decision requires an explicit, active `DecisionAccessGrant` created through a cryptographically validated, single-use invitation lifecycle.

---

## 1. Permission Model

Three explicit roles are supported:

| Role | Enforced Capabilities | Prohibited Capabilities |
| :--- | :--- | :--- |
| **Owner** | Full control over decision inputs, MCDA analysis, deletion, invitation management, and collaborator access grants. | Cannot be demoted or replaced through share operations. |
| **Editor** | Can read decision inputs and analysis results; can modify criteria, options, weights, and scores; can run MCDA analysis. | Cannot delete decision; cannot manage sharing, invitations, or access grants; cannot alter decision ownership. |
| **Viewer** | Can view decision inputs, options, criteria, scores, and authoritative analysis results. | Read-only. Cannot modify criteria, options, weights, or scores; cannot run MCDA analysis; cannot delete decision; cannot share. |
| **None** (Unrelated) | No access. Receives **404 Not Found** on all decision endpoints to prevent ID enumeration. | All access blocked. |

> **Note on Administrators (`role: 'admin'`)**: As established in Phase 5, system administrators retain global oversight to inspect and manage decisions and sharing settings across any owner.

### Action Authorization Matrix

| Action | Owner | Editor | Viewer | Unrelated User |
| :--- | :---: | :---: | :---: | :---: |
| `read` (GET /decisions/:id) | Allow (200) | Allow (200) | Allow (200) | Deny (404 Not Found) |
| `edit` (PUT /decisions/:id) | Allow (200) | Allow (200) | Deny (403 Forbidden) | Deny (404 Not Found) |
| `analyze` (POST /decisions/:id/analyze) | Allow (200) | Allow (200) | Deny (403 Forbidden) | Deny (404 Not Found) |
| `delete` (DELETE /decisions/:id) | Allow (204) | Deny (403 Forbidden) | Deny (403 Forbidden) | Deny (404 Not Found) |
| `share` (POST/DELETE invitations & access) | Allow (200/201) | Deny (403 Forbidden) | Deny (403 Forbidden) | Deny (404 Not Found) |

---

## 2. Invitation Lifecycle & Security

### Workflow
1. **Creation**: The decision owner selects a decision, enters recipient's normalized email address, and specifies a role (`'editor'` or `'viewer'`).
2. **Cryptographic Token**: The server generates a 32-byte cryptographically secure random token (`crypto.randomBytes(32).toString('hex')`).
3. **Secure Hash Persistence**: The server stores only the SHA-256 hash (`tokenHash`) in MongoDB. The raw token is returned strictly to the inviter at creation time.
4. **Single-Use Redemption**: The recipient submits `{ token }` while authenticated.
5. **Recipient Verification**: The authenticated user's normalized email must match the invitation's intended recipient email. Mismatches are rejected with HTTP 403.
6. **Atomic Acceptance**: An atomic MongoDB update (`findOneAndUpdate({ _id, status: 'pending' }, { $set: { status: 'accepted' } })`) transitions the status, preventing race conditions and double-spending.
7. **Access Grant Creation**: A `DecisionAccessGrant` record is persisted.
8. **Expiration & Revocation**:
   - Invitations expire automatically after 7 days (`expiresAt`).
   - Owners can revoke pending invitations at any time. Revoked invitations cannot be accepted.

### Delivery Limitation
Email delivery infrastructure (SMTP / SendGrid) is not configured in this environment. The server generates secure tokens and returns the redeemable link to the inviter. Raw invitation secrets are never written to logs or exposed in listing endpoints.

---

## 3. Data Model & MongoDB Schemas

### `DecisionAccessGrant` (`decision_access_grants` collection)
- `decisionId`: `ObjectId` (ref: `Decision`, required)
- `userId`: `ObjectId` (ref: `User`, required)
- `role`: `'editor' | 'viewer'` (required)
- `grantedBy`: `ObjectId` (ref: `User`, required)
- `createdAt`, `updatedAt`: Timestamps

**Indexes**:
- Compound Unique: `{ decisionId: 1, userId: 1 }` (Enforces no duplicate grants per decision-user pair)
- Lookup Index: `{ userId: 1, createdAt: -1 }` (Scoped listing of shared decisions)
- Management Index: `{ decisionId: 1, createdAt: -1 }` (Listing decision collaborators)

### `DecisionInvitation` (`decision_invitations` collection)
- `decisionId`: `ObjectId` (ref: `Decision`, required)
- `inviterId`: `ObjectId` (ref: `User`, required)
- `email`: `String` (required, lowercase, trim)
- `role`: `'editor' | 'viewer'` (required)
- `tokenHash`: `String` (required, unique SHA-256 hash)
- `status`: `'pending' | 'accepted' | 'revoked' | 'expired'` (default: `'pending'`)
- `expiresAt`: `Date` (default: 7 days from creation)
- `acceptedAt`: `Date` (nullable)
- `acceptedBy`: `ObjectId` (ref: `User`, nullable)
- `revokedAt`: `Date` (nullable)
- `revokedBy`: `ObjectId` (ref: `User`, nullable)
- `createdAt`, `updatedAt`: Timestamps

**Indexes**:
- Unique Token Hash: `{ tokenHash: 1 }` (unique: true)
- Partial Unique Active Invitation: `{ decisionId: 1, email: 1 }` with `{ unique: true, partialFilterExpression: { status: 'pending' } }`
- Query Index: `{ decisionId: 1, status: 1 }`
- Recipient Query Index: `{ email: 1, status: 1 }`

---

## 4. Endpoints Implemented

| Method | Endpoint | Auth | Role Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/decisions/:id/invitations` | Yes | Owner / Admin | Creates single-use invitation with secure token |
| `GET` | `/api/decisions/:id/invitations` | Yes | Owner / Admin | Lists invitations (tokens redacted) |
| `DELETE`| `/api/decisions/:id/invitations/:invId`| Yes | Owner / Admin | Revokes pending invitation |
| `GET` | `/api/decisions/:id/access` | Yes | Owner/Editor/Viewer | Lists owner and active collaborators |
| `PUT` | `/api/decisions/:id/access/:grantId` | Yes | Owner / Admin | Updates collaborator role (editor <-> viewer) |
| `DELETE`| `/api/decisions/:id/access/:grantId` | Yes | Owner / Admin | Revokes collaborator access grant |
| `POST` | `/api/invitations/accept` | Yes | Authenticated Recipient | Single-use redemption of invitation token |
| `GET` | `/api/invitations/details` | Optional | Any | Retrieves public summary of invitation (title, inviter) |
| `GET` | `/api/invitations/pending` | Yes | Authenticated User | Lists pending invitations for caller's email |

---

## 5. Frontend Integration (`apps/web`)

1. **API Client (`DecisionApiClient`)**:
   - Implemented `createInvitation`, `listInvitations`, `revokeInvitation`, `listAccessGrants`, `updateAccessGrant`, `revokeAccess`, `acceptInvitation`, `getInvitationDetails`, `getPendingInvitations`.
2. **Decision Model Hook (`useDecisionModel`)**:
   - Stores and exposes `currentUserRole: 'owner' | 'editor' | 'viewer'`.
   - Populated from backend `currentUserRole` on `loadDecision`.
3. **Sharing Management Modal (`ShareModal.tsx`)**:
   - Dedicated modal accessible from owned decisions.
   - Tabs: "Invite", "Active Collaborators", "Pending Invites".
   - Generates and copies invitation links/tokens with development delivery notice.
   - Allows owner to change collaborator roles and revoke access in real-time.
4. **Accept Invitation Modal (`AcceptInvitationModal.tsx`)**:
   - Automatically opens on `?inviteToken=<token>` or `?token=<token>`.
   - Validates recipient identity, prompts sign-in if unauthenticated, and opens shared workspace upon acceptance.
5. **Viewer Mode Controls (`InteractiveModal.tsx`)**:
   - Shows "Viewer Mode (Read-Only)" banner.
   - Disables sliders, scoring inputs, and save buttons when viewer role is active.

---

## 6. Adversarial Review Matrix

| # | Adversarial Attack Scenario | Expected Outcome | Verified Mechanism | Result |
| :- | :--- | :--- | :--- | :---: |
| **1** | User A tries to share User B's private decision | 404 Not Found | `authorizeDecisionAction` checks owner equality; throws `DecisionNotFoundError` | **PASS** |
| **2** | Viewer submits an update (PUT) request | 403 Forbidden | `authorizeDecisionAction` checks role; throws `ForbiddenError` | **PASS** |
| **3** | Editor attempts to grant themselves owner privileges | 403 Forbidden | Grant endpoint rejects unknown/owner roles; PUT strips `ownerId` | **PASS** |
| **4** | Unrelated user attempts to redeem invitation | 403 Forbidden | `acceptInvitation` verifies `requester.email === invitation.email` | **PASS** |
| **5** | Expired invitation is accepted | 410 Gone | `acceptInvitation` checks `now > expiresAt`; updates status to `expired` | **PASS** |
| **6** | Revoked invitation is accepted | 410 Gone | `acceptInvitation` rejects non-pending status | **PASS** |
| **7** | Invitation is redeemed twice | 409 Conflict | Atomic status transition fails on subsequent calls | **PASS** |
| **8** | Two concurrent requests attempt to redeem the same token | Exactly 1 succeeds, 1 gets 409 | Atomic `findOneAndUpdate({ _id, status: 'pending' })` race-free winner | **PASS** |
| **9** | Recipient attempts to forge permission level in acceptance body | Enforces stored role | `acceptInvitation` reads role strictly from invitation DB record | **PASS** |
| **10**| Client attempts to enumerate private decisions | 404 Not Found | Unshared decision IDs return 404, never leaking existence | **PASS** |
| **11**| Revoked collaborator uses access immediately after revocation | 404 Not Found | Immediate deletion of `DecisionAccessGrant`; next request returns 404 | **PASS** |
| **12**| Forged access-grant ID submitted | 404 Not Found | `updateAccessGrant` checks existence and decision binding | **PASS** |
| **13**| Invitation tokens appear in logs or responses | Secrets protected | Plaintext tokens never stored; SHA-256 tokenHash used; list routes redact | **PASS** |
| **14**| Database failure occurs during invitation acceptance | No corrupted state | Try-catch rolls back acceptance status if grant creation fails | **PASS** |
| **15**| Invitation record exists without grant after failed operation | Rollback compensation | `rollbackAcceptance` restores `pending` status on downstream failure | **PASS** |

---

## 7. Verification & Scope Confirmation

- `npm run verify` runs typecheck, lint, test, and build across all 3 workspaces.
- **Scope Confirmation**:
  - Phase 6 Sharing and Invitations implemented only.
  - Phase 7 (Expert Contributions, revisions, lock round, expert score separation) NOT started.
  - Phase 8 (Evidence and Provenance) NOT started.
  - Phase 9 (AI Analyst) NOT started.
