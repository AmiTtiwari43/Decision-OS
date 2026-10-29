# Phase 7 — Expert Contributions

## Precondition
Phase 6 Sharing and Invitations is complete, verified, and audited (`npm run verify` passing with 231 tests). The private decision security boundary, role-based access control, and canonical MCDA decision engine are strictly enforced.

## Objective & Security Boundary
Extend Decision OS to support structured, attributable expert contributions.
Authorized experts can provide recommendations, per-criterion scores, rationale, confidence ratings, and predictions.

The enforced security boundary is:
$$\text{Authenticated Contributor} \longrightarrow \text{Decision Authorization Policy} \longrightarrow \text{Round Lock Check} \longrightarrow \text{Contribution Validation} \longrightarrow \text{Dedicated Persistence}$$

Contributions are strictly separated from the decision owner's authoritative MCDA inputs. Expert scores never silently overwrite decision scores or alter canonical engine calculations unless the owner explicitly takes an adoption action.

---

## 1. Permission Model & Role Hierarchy

Four collaborative roles are recognized:

| Role | Read Decision | Edit Core Inputs / MCDA | Share / Invite / Revoke | Submit Contribution | Lock / Unlock Round | Adopt Expert Scores |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Owner** | Yes | Yes | Yes | Yes | Yes | Yes |
| **Editor** | Yes | Yes | No (`403`) | Yes | No (`403`) | No (`403`) |
| **Contributor** | Yes | No (`403`) | No (`403`) | Yes | No (`403`) | No (`403`) |
| **Viewer** | Yes | No (`403`) | No (`403`) | No (`403`) | No (`403`) | No (`403`) |
| **Unrelated User**| No (`404`) | No (`404`) | No (`404`) | No (`404`) | No (`404`) | No (`404`) |
| **Admin** | Yes | Yes | Yes | Yes | Yes | Yes |

### Core Invariants
1. **Least-Privilege Contributor Capability:** Users invited with role `'contributor'` have read access to the decision and write access strictly to their own contribution. They cannot modify decision criteria, options, weights, or scores.
2. **Viewer Restriction:** Viewers are strictly read-only and cannot submit contributions (`ForbiddenError` -> `403 Forbidden`).
3. **Round Lock Authority:** Only the decision owner (or admin) can lock or unlock the contribution round. When locked, contributors cannot create, revise, or submit contributions.
4. **Author Isolation:** A contributor can only edit or withdraw their own contribution. Cross-user modification attempts return `403 Forbidden`.
5. **Separation from MCDA Engine:** Expert contributions reside in the `decision_contributions` collection. Authoritative decision scores and MCDA results remain unchanged.

---

## 2. Contribution Lifecycle

```
[Save Draft] ─────────────► [Submit] ─────────────► [Withdraw]
     ▲                         │                         │
     │                         ▼                         ▼
  (Re-edit) ◄─────── [Revise Submission]           (Re-activate)
```

1. **Draft:** Contributor drafts their recommendation, scores, and rationale. Visible only to the author and the decision owner.
2. **Submitted:** Contribution is finalized. Revision count is incremented, and a historical snapshot of previous scores is archived in `history`. Visible to all decision collaborators.
3. **Withdrawn:** Contributor retracts their submission.
4. **Round Locked:** When the owner locks the round, no further edits, submissions, or withdrawals are permitted.

---

## 3. Data Model & MongoDB Schemas

### `DecisionContribution` (`decision_contributions` collection)
- `_id`: `ObjectId`
- `decisionId`: `ObjectId` (ref: `Decision`, required, indexed)
- `contributorId`: `ObjectId` (ref: `User`, required, indexed; derived strictly from authenticated session)
- `recommendation`:
  - `preferredOptionId`: `String` (required; must match an existing option in `decision.options`)
  - `rationale`: `String` (overall reasoning)
- `criterionScores`: `Map` / Record of `criterionId -> score` (number constrained to $[0, 100]$)
- `criterionReasoning`: `Map` / Record of `criterionId -> reasoning` (string)
- `confidence`: `Number` in $[0.0, 1.0]$ (scale representing contributor confidence)
- `prediction`: (optional)
  - `statement`: `String`
  - `targetDate`: `Date`
  - `probability`: `Number` in $[0.0, 1.0]$
- `evidenceReferences`: Array of `String` IDs (references for future evidence subsystem)
- `status`: `'draft' | 'submitted' | 'withdrawn'` (default: `'draft'`)
- `revision`: `Number` (integer $\ge 1$, default: $1$)
- `history`: Array of historical revision snapshots
- `submittedAt`: `Date | null`
- `withdrawnAt`: `Date | null`
- `createdAt`, `updatedAt`: Timestamps

**Indexes:**
- Compound Unique Index: `{ decisionId: 1, contributorId: 1 }` (Enforces 1 contribution document per user per decision)
- Query Index: `{ decisionId: 1, status: 1 }` (Listing decision contributions)
- Contributor Query Index: `{ contributorId: 1, createdAt: -1 }`

---

## 4. API Endpoints

| Method | Endpoint | Auth | Required Role | Description |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/api/decisions/:id/contributions` | Yes | Collaborator / Owner | List contributions for decision |
| `GET` | `/api/decisions/:id/contributions/mine` | Yes | Contributor / Editor / Owner | Get current user's contribution |
| `POST`| `/api/decisions/:id/contributions` | Yes | Contributor / Editor / Owner | Save draft contribution |
| `POST`| `/api/decisions/:id/contributions/submit` | Yes | Contributor / Editor / Owner | Submit contribution & archive revision |
| `POST`| `/api/decisions/:id/contributions/withdraw` | Yes | Contributor / Editor / Owner | Withdraw submitted contribution |
| `POST`| `/api/decisions/:id/contributions/lock` | Yes | Owner / Admin | Lock contribution round |
| `POST`| `/api/decisions/:id/contributions/unlock` | Yes | Owner / Admin | Unlock contribution round |
| `POST`| `/api/decisions/:id/contributions/:contributionId/adopt` | Yes | Owner / Admin | Explicitly adopt expert scores into decision |

