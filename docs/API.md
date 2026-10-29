# Decision OS — API Specification (Phase 3)

## Base URL
All decision routes are mounted under the `/api` prefix.

## Centralized Error Response Format
All errors adhere to the standardized Decision OS error format:
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Detailed error message",
  "requestId": "req-trace-uuid-1234"
}
```

Standard Status Codes:
- `200 OK`: Request succeeded.
- `201 Created`: Resource successfully created and evaluated.
- `204 No Content`: Resource successfully deleted.
- `400 Bad Request`: Malformed payload, invalid types, or invalid MongoDB ObjectId format.
- `404 Not Found`: Decision resource does not exist.
- `422 Unprocessable Entity`: Semantic validation failure (e.g., missing scores when invoking `/analyze`).
- `500 Internal Server Error`: Server failure.

---

## Server Authority & Tamper-Resistance Policy
1. **Client Calculation Discard**: The API completely ignores and discards any client-supplied authoritative fields in request bodies:
   - `winner` / `winnerId`
   - `rank` / `ranking`
   - `finalScore` / `weightedScore`
   - `analysis`
   - `engineVersion`
2. **Server Authoritative Execution**: All Multi-Criteria Decision Analysis (MCDA) math is executed exclusively on the server using `packages/decision-engine`.
3. **Stale Analysis Policy**: When criteria, weights, options, or scores are modified via `PUT /api/decisions/:id`:
   - If the resulting state has complete scores for all option-criterion pairs, the server re-runs `evaluateDecision()` and updates `analysis`.
   - If the resulting state is incomplete, `analysis` is cleared (`null`), preventing stale calculation results from being consumed as truth.

---

## Endpoints

### 1. Create Decision
`POST /api/decisions`

Creates a new Decision document, validates complete scores, calculates authoritative MCDA results via `packages/decision-engine`, and persists the record.

#### Request Body
```json
{
  "title": "Cloud Provider Migration Matrix",
  "description": "Evaluating AWS vs GCP for ML pipelines",
  "criteria": [
    {
      "id": "perf",
      "name": "Performance",
      "shortName": "Perf",
      "weight": 50,
      "direction": "benefit",
      "isLocked": false
    },
    {
      "id": "cost",
      "name": "Cost Efficiency",
      "weight": 50,
      "direction": "benefit",
      "isLocked": false
    }
  ],
  "options": [
    {
      "id": "aws",
      "name": "Amazon Web Services",
      "tagline": "Mature ecosystem",
      "color": "#ff9900"
    },
    {
      "id": "gcp",
      "name": "Google Cloud Platform",
      "tagline": "Strong AI tooling",
      "color": "#4285f4"
    }
  ],
  "scores": {
    "aws": {
      "perf": 90,
      "cost": 65
    },
    "gcp": {
      "perf": 85,
      "cost": 80
    }
  }
}
```

#### Response: `201 Created`
Returns the created Decision document with server-generated `_id`, `analysis` snapshot, `calculationVersion`, `createdAt`, and `updatedAt`.

---

### 2. List Decisions
`GET /api/decisions`

Lists decisions with bounded pagination and chronological sorting (`createdAt: -1`).

#### Query Parameters
- `page` (integer, optional, default: `1`, minimum: `1`)
- `limit` (integer, optional, default: `20`, minimum: `1`, maximum: `100`)
- `search` (string, optional, case-insensitive title search)

#### Response: `200 OK`
```json
{
  "items": [
    {
      "_id": "6ae31498c09401aedf991863",
      "title": "Cloud Provider Migration Matrix",
      "description": "Evaluating AWS vs GCP for ML pipelines",
      "criteria": [...],
      "options": [...],
      "scores": {...},
      "analysis": {...},
      "calculationVersion": 1,
      "createdAt": "2026-10-29T15:00:00.000Z",
      "updatedAt": "2026-10-29T15:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

---

### 3. Retrieve Decision
`GET /api/decisions/:id`

Retrieves a persisted decision by its MongoDB ObjectId.

#### Parameters
- `id` (string, required): 24-character hex MongoDB ObjectId.

#### Response: `200 OK`
Returns the complete Decision document.

#### Error Responses
- `400 Bad Request`: If `:id` is not a valid 24-character hexadecimal ObjectId.
- `404 Not Found`: If no decision exists with the specified `:id`.

---

### 4. Update Decision
`PUT /api/decisions/:id`

Updates an existing decision's metadata, criteria, options, or scores.

#### Parameters
- `id` (string, required): MongoDB ObjectId.

#### Request Body
Partial or complete update of `title`, `description`, `criteria`, `options`, or `scores`.

#### Response: `200 OK`
Returns the updated Decision document. If updated inputs are complete, contains recalculated `analysis`. If incomplete, `analysis` is `null`.

#### Error Responses
- `400 Bad Request`: Invalid ObjectId, invalid field types, negative weights, scores out of $[0, 100]$, or duplicate IDs.
- `404 Not Found`: Decision not found.

---

### 5. Delete Decision
`DELETE /api/decisions/:id`

Deletes a decision document by its ObjectId.

#### Response: `204 No Content`
Empty response body upon successful deletion.

#### Error Responses
- `400 Bad Request`: Invalid ObjectId format.
- `404 Not Found`: Decision not found.

---

### 6. Analyze Decision
`POST /api/decisions/:id/analyze`

Triggers authoritative server-side MCDA calculation for an existing decision using `packages/decision-engine`.

#### Parameters
- `id` (string, required): MongoDB ObjectId.

#### Response: `200 OK`
Returns the updated Decision document with the persisted `analysis` snapshot containing:
- `engineVersion`: `"1.0.0"`
- `evaluatedAt`: ISO timestamp
- `isTie`: boolean
- `decisionOutcome`: `"decisive" | "tie"`
- `winnerId`: string ID or `null` if tie
- `tiedWinnerIds`: string array
- `pointLead`: number
- `evaluations`: Option ranking with dual-precision weighted scores and criteria contributions
- `normalizedWeights`: Hare-Niemeyer normalized weights summing to 100.0%
- `totalWeight`: sum of weights
- `sensitivity`: analytical tipping points per criterion

#### Error Responses
- `400 Bad Request`: Invalid ObjectId format.
- `404 Not Found`: Decision not found.
- `422 Unprocessable Entity`: Incomplete decision matrix (e.g. missing scores for certain option-criterion pairs, or missing criteria/options). The error message lists the missing coordinates.

---

## Phase 6 — Sharing & Invitations API

### 7. Create Invitation
`POST /api/decisions/:id/invitations`

Creates a single-use invitation with a 256-bit cryptographically secure token. Only the decision owner or administrator can create invitations.

#### Authentication
Required (`Bearer <JWT>`)

#### Request Body
```json
{
  "email": "colleague@example.com",
  "role": "editor" // "editor" | "viewer"
}
```

#### Response: `201 Created`
```json
{
  "invitation": {
    "id": "67215c26b8b548b26e95d120",
    "decisionId": "67215c26b8b548b26e95d11f",
    "email": "colleague@example.com",
    "role": "editor",
    "status": "pending",
    "expiresAt": "2026-11-05T12:00:00.000Z",
    "createdAt": "2026-10-29T12:00:00.000Z"
  },
  "token": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "invitationLink": "/invite?token=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

*Note: The raw token is returned strictly to the creator at creation time and is never stored in plaintext (stored as SHA-256 hash).*

---

### 8. List Invitations
`GET /api/decisions/:id/invitations`

Lists all invitations associated with the decision. Only the decision owner or administrator can view invitations.

#### Authentication
Required (`Bearer <JWT>`)

#### Response: `200 OK`
```json
{
  "items": [
    {
      "id": "67215c26b8b548b26e95d120",
      "decisionId": "67215c26b8b548b26e95d11f",
      "email": "colleague@example.com",
      "role": "editor",
      "status": "pending",
      "expiresAt": "2026-11-05T12:00:00.000Z",
      "createdAt": "2026-10-29T12:00:00.000Z"
    }
  ]
}
```

---

### 9. Revoke Invitation
`DELETE /api/decisions/:id/invitations/:invitationId`

Revokes a pending invitation. Once revoked, the invitation can no longer be accepted. Only the decision owner or administrator can revoke invitations.

#### Authentication
Required (`Bearer <JWT>`)

#### Response: `200 OK`
```json
{
  "message": "Invitation revoked successfully",
  "invitation": {
    "id": "67215c26b8b548b26e95d120",
    "status": "revoked"
  }
}
```

---

### 10. List Access Grants
`GET /api/decisions/:id/access`

Lists the decision owner and all active collaborators with explicit access grants.

#### Authentication
Required (`Bearer <JWT>`)

#### Response: `200 OK`
```json
{
  "owner": {
    "id": "67215c26b8b548b26e95d11e",
    "name": "Owner Name",
    "email": "owner@example.com"
  },
  "collaborators": [
    {
      "id": "67215c26b8b548b26e95d121",
      "user": {
        "id": "67215c26b8b548b26e95d11d",
        "name": "Collaborator Name",
        "email": "colleague@example.com"
      },
      "role": "editor",
      "createdAt": "2026-10-29T12:00:00.000Z"
    }
  ]
}
```

---

### 11. Update Collaborator Access Role
`PUT /api/decisions/:id/access/:grantId`

Updates an existing collaborator's role between `'editor'` and `'viewer'`. Only the decision owner or administrator can modify collaborator roles.

#### Authentication
Required (`Bearer <JWT>`)

#### Request Body
```json
{
  "role": "viewer" // "editor" | "viewer"
}
```

#### Response: `200 OK`
Returns the updated `DecisionAccessGrant` document.

---

### 12. Revoke Collaborator Access
`DELETE /api/decisions/:id/access/:grantId`

Immediately deletes the access grant, revoking the collaborator's access to the decision. Subsequent requests by the revoked user receive `404 Not Found`.

#### Authentication
Required (`Bearer <JWT>`)

#### Response: `204 No Content`

---

### 13. Accept Invitation
`POST /api/invitations/accept`

Redeems an invitation using a raw cryptographic token. Enforces single-use redemption and verifies that the authenticated user's email matches the intended recipient email.

#### Authentication
Required (`Bearer <JWT>`)

#### Request Body
```json
{
  "token": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

#### Response: `200 OK`
```json
{
  "message": "Invitation accepted successfully",
  "decisionId": "67215c26b8b548b26e95d11f",
  "role": "editor"
}
```

#### Error Responses
- `400 Bad Request`: Token missing or owner attempting to accept own invitation.
- `403 Forbidden`: Authenticated user email does not match invitation recipient email.
- `404 Not Found`: Invalid or nonexistent token.
- `409 Conflict`: Invitation has already been accepted (single-use redemption enforced).
- `410 Gone`: Invitation has expired or has been revoked by the owner.

---

### 14. Get Invitation Details
`GET /api/invitations/details?token=<token>`

Retrieves public summary details of an invitation (decision title, inviter name, role) prior to acceptance.

#### Authentication
Optional

#### Response: `200 OK`
```json
{
  "email": "colleague@example.com",
  "role": "editor",
  "status": "pending",
  "expiresAt": "2026-11-05T12:00:00.000Z",
  "decisionTitle": "Cloud Provider Migration Matrix",
  "inviterName": "Owner Name"
}
```

---

### 15. List Pending Invitations for User
`GET /api/invitations/pending`

Lists active pending invitations issued to the authenticated user's email address.

#### Authentication
Required (`Bearer <JWT>`)

#### Response: `200 OK`
Returns array of pending invitation objects with decision title and inviter info.

---

## Phase 7 — Expert Contributions API

### 16. List Decision Contributions
`GET /api/decisions/:id/contributions`

Lists all submitted and withdrawn contributions for a decision. If the requester has a draft contribution, their draft is also returned.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Owner, Editor, Contributor, Viewer

#### Response: `200 OK`
```json
{
  "items": [
    {
      "id": "67215c26b8b548b26e95d130",
      "decisionId": "67215c26b8b548b26e95d11f",
      "contributorId": {
        "id": "67215c26b8b548b26e95d110",
        "name": "Expert Name",
        "email": "expert@example.com"
      },
      "recommendation": {
        "preferredOptionId": "aws",
        "rationale": "Superior managed service availability"
      },
      "criterionScores": {
        "cost": 75,
        "perf": 95
      },
      "criterionReasoning": {
        "cost": "Higher base cost offset by reserved pricing"
      },
      "confidence": 0.9,
      "status": "submitted",
      "revision": 1,
      "history": [],
      "submittedAt": "2026-10-29T12:00:00.000Z"
    }
  ]
}
```

---

### 17. Get My Contribution
`GET /api/decisions/:id/contributions/mine`

Retrieves the authenticated user's contribution for this decision (draft, submitted, or withdrawn).

#### Authentication
Required (`Bearer <JWT>`)

#### Response: `200 OK`
Returns `{ "item": DecisionContributionDto | null }`.

---

### 18. Save Contribution Draft
`POST /api/decisions/:id/contributions`

Saves or updates a draft contribution for the current user. Validates option and criterion IDs against the decision.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Contributor, Editor, Owner (Viewers receive `403 Forbidden`)

#### Request Body
```json
{
  "preferredOptionId": "aws",
  "rationale": "Detailed trade-off rationale",
  "criterionScores": {
    "cost": 80,
    "perf": 90
  },
  "criterionReasoning": {
    "cost": "Cost estimate",
    "perf": "Performance assessment"
  },
  "confidence": 0.85,
  "prediction": {
    "statement": "Option A will achieve KPI within 6 months",
    "probability": 0.75
  }
}
```

#### Response: `200 OK`
Returns the saved `DecisionContributionDto`.

---

### 19. Submit Contribution
`POST /api/decisions/:id/contributions/submit`

Transitions the user's contribution to `'submitted'`. If already submitted, archives the previous state in `history` and increments `revision`.

#### Authentication
Required (`Bearer <JWT>`)

#### Response: `200 OK`
Returns the submitted `DecisionContributionDto` with updated revision.

---

### 20. Withdraw Contribution
`POST /api/decisions/:id/contributions/withdraw`

Transitions the user's contribution to `'withdrawn'`.

#### Authentication
Required (`Bearer <JWT>`)

#### Response: `200 OK`
Returns the withdrawn `DecisionContributionDto`.

---

### 21. Lock / Unlock Contribution Round
`POST /api/decisions/:id/contributions/lock`  
`POST /api/decisions/:id/contributions/unlock`

Locks or unlocks the contribution round. When locked, contributors cannot create, edit, submit, or withdraw contributions.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Owner or Admin only (`403 Forbidden` for non-owners)

#### Response: `200 OK`
Returns the updated `DecisionDto` with `isContributionRoundLocked`.

---

### 22. Adopt Expert Scores
`POST /api/decisions/:id/contributions/:contributionId/adopt`

Explicitly adopts an expert's criterion scores into the decision's core score matrix and re-runs deterministic MCDA analysis.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Owner or Admin only

#### Response: `200 OK`
Returns the updated `DecisionDto` with authoritative MCDA analysis.

---

## Evidence and Provenance Endpoints (Phase 8)

### 23. List Evidence
`GET /api/decisions/:id/evidence`

Lists evidence records associated with a decision. Optional query parameters `targetType` (`decision`, `option`, `criterion`, `contribution`) and `targetId` can filter results.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Decision collaborator (`owner`, `editor`, `viewer`, `contributor`). Non-collaborators receive `404 Not Found`.

#### Response: `200 OK`
```json
{
  "items": [
    {
      "id": "67216a90b8b548b26e95d130",
      "decisionId": "67215c26b8b548b26e95d11f",
      "targetType": "option",
      "targetId": "aws",
      "createdById": "67215c26b8b548b26e95d11e",
      "type": "url",
      "title": "AWS Compute Optimizer Whitepaper",
      "sourceUrl": "https://aws.amazon.com/whitepapers/compute-optimizer",
      "documentReference": null,
      "sourceExcerpt": "EC2 Graviton instances provide up to 40% better price performance.",
      "userSummary": "Substantiates the 85 performance score assigned to AWS.",
      "publicationDate": "2026-01-15T00:00:00.000Z",
      "provenance": {
        "createdByName": "Expert Contributor",
        "createdByEmail": "expert@example.com",
        "capturedVia": "web_link"
      },
      "createdAt": "2026-10-30T00:00:00.000Z",
      "updatedAt": "2026-10-30T00:00:00.000Z"
    }
  ]
}
```

---

### 24. Create Evidence
`POST /api/decisions/:id/evidence`

Creates a new evidence record attached to the decision, an option, a criterion, or a contribution.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Contributor, Editor, or Owner (`403 Forbidden` for Viewers).

#### Request Body
```json
{
  "targetType": "option", // "decision" | "option" | "criterion" | "contribution"
  "targetId": "aws",
  "type": "url", // "url" | "document" | "excerpt"
  "title": "AWS Compute Optimizer Whitepaper",
  "sourceUrl": "https://aws.amazon.com/whitepapers/compute-optimizer",
  "documentReference": "AWS Tech Docs Vol. 4",
  "sourceExcerpt": "EC2 Graviton instances provide up to 40% better price performance.",
  "userSummary": "Substantiates the 85 performance score assigned to AWS.",
  "publicationDate": "2026-01-15T00:00:00.000Z"
}
```

#### Response: `201 Created`
Returns the created `DecisionEvidenceDto`.

---

### 25. Get Evidence Record
`GET /api/decisions/:id/evidence/:evidenceId`

Retrieves a single evidence record.

#### Authentication
Required (`Bearer <JWT>`)

#### Response: `200 OK`
Returns `DecisionEvidenceDto`.

---

### 26. Update Evidence Record
`PATCH /api/decisions/:id/evidence/:evidenceId`

Updates permitted metadata on an existing evidence record (title, summary, excerpt, source). Creator, Owner, or Admin only.

#### Authentication
Required (`Bearer <JWT>`)

#### Request Body
```json
{
  "title": "Updated Title",
  "sourceExcerpt": "Updated verbatim excerpt",
  "userSummary": "Updated user interpretation",
  "sourceUrl": "https://example.com/updated",
  "documentReference": "Updated citation ref",
  "publicationDate": "2026-02-01T00:00:00.000Z"
}
```

#### Response: `200 OK`
Returns the updated `DecisionEvidenceDto`.

---

### 27. Delete Evidence Record
`DELETE /api/decisions/:id/evidence/:evidenceId`

Deletes an evidence record. Creator, Owner, or Admin only.

#### Authentication
Required (`Bearer <JWT>`)

#### Response: `204 No Content`




