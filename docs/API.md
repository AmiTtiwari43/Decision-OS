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






---

### 28. Request AI Analysis
`POST /api/decisions/:id/ai/analyze`

Executes structured, evidence-aware advisory AI analysis for a decision.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Collaborator (`viewer`, `contributor`, `editor`, `owner`).

#### Request Body
```json
{
  "capability": "all"
}
```

#### Response: `200 OK`
Returns `AiAnalystResponseDto`.

---

### 29. Apply Advisory Criterion Proposal
`POST /api/decisions/:id/ai/proposals/apply`

Explicitly applies an advisory AI criterion proposal to the decision. Requires human owner/editor authority.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Owner, Editor, or Admin (`403 Forbidden` for Viewers or Contributors).

#### Request Body
```json
{
  "type": "add_criterion",
  "criterion": {
    "id": "compliance",
    "name": "Regulatory Compliance",
    "weight": 20,
    "direction": "benefit"
  }
}
```

#### Response: `200 OK`
Returns the updated `DecisionDto`.


---

## Phase 10: Advanced Analytics Endpoints

### 30. Get Decision Analytics
`GET /api/decisions/:id/analytics`

Retrieves multi-dimensional analytics for a specific decision, combining authoritative MCDA engine outputs, criterion importance, option performance breakdown, analytical single-criterion tipping points, option-score sensitivity, minimal combined weight counterfactuals ($L_1$ optimization), seeded Gaussian Monte Carlo uncertainty simulation, empirical evidence coverage with missing-evidence indicators, and expert deliberation participation patterns.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Collaborator (`viewer`, `contributor`, `editor`, `owner`). Unrelated users receive `404 Not Found` (enumeration defense).

#### Query Parameters
- `includeMonteCarlo` (boolean, optional, default: `true`): Whether to include Monte Carlo robustness simulations.
- `iterations` (integer, optional, default: `1000`, min: `100`, max: `10000`): Simulation sample size.
- `seed` (integer, optional, default: `42`): Mulberry32 deterministic PRNG seed.
- `sigmaRelative` (number, optional, default: `0.15`, min: `0.01`, max: `0.50`): Relative standard deviation for Gaussian weight perturbations.

#### Response: `200 OK`
```json
{
  "decisionId": "6512bd...",
  "title": "Cloud Architecture Evaluation",
  "description": "AWS vs GCP comparison",
  "evaluatedAt": "2026-10-31T00:00:00.000Z",
  "outcome": "decisive",
  "isAuthoritative": true,
  "pointLead": 5.5,
  "winner": { "id": "gcp", "name": "Google Cloud Platform" },
  "runnerUp": { "id": "aws", "name": "Amazon Web Services" },
  "criteriaImportance": [
    {
      "id": "perf",
      "name": "Performance",
      "weight": 40,
      "isLocked": false,
      "direction": "benefit",
      "relativeShare": 40.0
    }
  ],
  "optionsPerformance": [
    {
      "id": "gcp",
      "name": "Google Cloud Platform",
      "rank": 1,
      "weightedScore": 78.5,
      "unroundedScore": 78.502,
      "contributions": [
        {
          "criterionId": "perf",
          "criterionName": "Performance",
          "rawScore": 80,
          "weightedPoints": 32.0,
          "percentageOfTotal": 40.8
        }
      ]
    }
  ],
  "sensitivityAnalysis": {
    "analyticalTippingPoints": [
      {
        "criterionId": "perf",
        "criterionName": "Performance",
        "currentWeight": 40,
        "tippingPointWeight": 52.3,
        "weightDeltaNeeded": 12.3,
        "direction": "increase",
        "feasibility": "low-threshold",
        "wouldFlipToOptionId": "aws",
        "wouldFlipToOptionName": "Amazon Web Services",
        "summary": "Shifting Performance to 52.3% flips winner to AWS."
      }
    ],
    "optionScoreSensitivity": [
      {
        "criterionId": "perf",
        "criterionName": "Performance",
        "weight": 40,
        "scoreDeltaNeeded": 13.8,
        "leaderThresholdScore": 66.2,
        "challengerThresholdScore": 83.8,
        "feasibility": "feasible",
        "summary": "Tie reached via score shift."
      }
    ],
    "multiParameterCounterfactual": {
      "isFeasible": true,
      "totalWeightShiftL1": 15.0,
      "netShiftAmount": 7.5,
      "shifts": [
        {
          "criterionId": "perf",
          "criterionName": "Performance",
          "currentWeight": 40,
          "counterfactualWeight": 47.5,
          "delta": 7.5
        }
      ],
      "targetOptionId": "aws",
      "targetOptionName": "Amazon Web Services",
      "summary": "Smallest counterfactual shift: 7.5% weight relocated inverts winner."
    }
  },
  "uncertaintyAnalysis": {
    "hasMonteCarlo": true,
    "iterations": 1000,
    "seed": 42,
    "sigmaRelative": 0.15,
    "distributionModel": "Gaussian Box-Muller on unlocked weights",
    "metricInterpretation": "win probability under the specified uncertainty model",
    "robustnessRating": "robust",
    "dominantOptionId": "gcp",
    "dominantWinProbability": 82.4,
    "optionResults": [
      {
        "optionId": "gcp",
        "optionName": "Google Cloud Platform",
        "winCount": 824,
        "winProbability": 82.4
      }
    ]
  },
  "evidenceCoverage": {
    "totalEvidenceCount": 3,
    "byTargetType": { "decision": 1, "option": 1, "criterion": 1, "contribution": 0 },
    "bySourceType": { "url": 2, "document": 1, "excerpt": 0 },
    "optionsCoverage": [
      {
        "optionId": "gcp",
        "optionName": "Google Cloud Platform",
        "evidenceCount": 1,
        "hasEvidence": true
      }
    ],
    "criteriaCoverage": [
      {
        "criterionId": "perf",
        "criterionName": "Performance",
        "evidenceCount": 1,
        "hasEvidence": true
      }
    ],
    "missingEvidenceTargets": {
      "options": [{ "id": "aws", "name": "Amazon Web Services" }],
      "criteria": [{ "id": "cost", "name": "Cost" }]
    },
    "methodologyDisclaimer": "Evidence coverage reflects the presence of documented citations and excerpts. Evidence quantity does NOT imply evidence credibility, accuracy, or quality."
  },
  "expertParticipation": {
    "totalContributions": 2,
    "submittedCount": 2,
    "draftCount": 0,
    "withdrawnCount": 0,
    "isRoundLocked": false,
    "roundLockedAt": null,
    "recommendationTally": [
      { "optionId": "gcp", "optionName": "Google Cloud Platform", "count": 2 }
    ],
    "scoreSpreadByCriterion": [
      {
        "criterionId": "perf",
        "criterionName": "Performance",
        "minScore": 75,
        "maxScore": 85,
        "averageScore": 80.0,
        "scoreRange": 10.0
      }
    ],
    "methodologyDisclaimer": "Participation metrics measure submitted expert perspectives. Expert signals are descriptive and do not constitute reputation, calibration, or truth scores."
  }
}
```

---

### 31. Get Workspace Portfolio Analytics
`GET /api/analytics/overview`

Retrieves portfolio-level aggregation metrics across all decisions owned by or shared with the authenticated user.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Authenticated User.

#### Query Parameters
- `startDate` (string, optional, ISO 8601): Filters decisions created on or after this date.
- `endDate` (string, optional, ISO 8601): Filters decisions created on or before this date.

#### Response: `200 OK`
```json
{
  "generatedAt": "2026-10-31T00:00:00.000Z",
  "timeframe": {
    "startDate": "2026-10-01T00:00:00.000Z",
    "endDate": null
  },
  "decisionMetrics": {
    "totalDecisions": 4,
    "statusDistribution": {
      "decisive": 3,
      "tie": 1,
      "unscored": 0
    },
    "roundLockDistribution": {
      "locked": 1,
      "open": 3
    },
    "completionRate": 100.0,
    "averagePointLead": 6.2
  },
  "activityTrends": [
    {
      "period": "2026-10",
      "createdCount": 4
    }
  ],
  "criteriaAndOptionsMetrics": {
    "totalCriteriaDefined": 16,
    "averageCriteriaPerDecision": 4.0,
    "totalOptionsDefined": 10,
    "averageOptionsPerDecision": 2.5,
    "topCriteriaNames": [
      { "name": "Performance", "count": 3 }
    ]
  },
  "evidenceMetrics": {
    "totalEvidenceRecords": 8,
    "decisionsWithEvidenceCount": 3,
    "decisionEvidenceCoverageRate": 75.0,
    "sourceTypeBreakdown": {
      "url": 5,
      "document": 2,
      "excerpt": 1
    },
    "methodologyDisclaimer": "Evidence coverage rate measures decisions that possess documented supporting citations or excerpts. High coverage does not guarantee evidence credibility or accuracy."
  },
  "deliberationMetrics": {
    "totalContributions": 6,
    "submittedContributions": 5,
    "draftContributions": 1,
    "withdrawnContributions": 0,
    "decisionsWithContributionsCount": 3,
    "averageContributionsPerDecision": 1.5,
    "methodologyDisclaimer": "Deliberation metrics reflect stakeholder participation counts. Scores are unweighted by reputation in Phase 10."
  }
}
```


---

## Disagreement Intelligence Endpoints (Phase 11)

### 32. Get Decision Disagreements
`GET /api/decisions/:id/disagreements`

Retrieves structured disagreement intelligence for a decision, including score dispersion (Range, StdDev, Median, Confidence-Weighted Mean), decision-critical classification, scenario evaluations (Min, Median, Max), and human governance resolution state.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Any authorized collaborator (`owner`, `editor`, `contributor`, `viewer`). Unrelated users receive `404 Not Found` (enumeration defense).

#### Response: `200 OK`
```json
{
  "decisionId": "6512bd...",
  "hasSufficientData": true,
  "totalContributors": 2,
  "totalDisagreements": 2,
  "decisionCriticalCount": 1,
  "items": [
    {
      "id": "disag_score_crit_growth",
      "category": "score",
      "title": "Score Disagreement on 'Growth'",
      "criterionId": "crit_growth",
      "criterionName": "Growth",
      "isDecisionCritical": true,
      "scoreMetrics": {
        "criterionId": "crit_growth",
        "criterionName": "Growth",
        "weight": 50,
        "sampleCount": 2,
        "minScore": 60,
        "maxScore": 90,
        "scoreRange": 30,
        "meanScore": 75,
        "sampleStdDev": 21.2,
        "medianScore": 75,
        "confidenceWeightedMean": 76.5,
        "isDecisionCritical": true,
        "tippingDeltaThreshold": 10,
        "criticalReason": "Score range (30 pts) exceeds tipping threshold (10 pts)",
        "scenarioResults": {
          "minScenarioWinnerId": "opt_beta",
          "minScenarioWinnerFlips": true,
          "medianScenarioWinnerId": "opt_alpha",
          "medianScenarioWinnerFlips": false,
          "maxScenarioWinnerId": "opt_alpha",
          "maxScenarioWinnerFlips": false
        }
      },
      "description": "Experts differ by 30 points on criterion 'Growth'.",
      "numericalExplanation": "Spread of 30 pts (min: 60, max: 90, stdDev: 21.2) across 2 expert evaluations. Tipping threshold: 10 pts. Pessimistic scenario inverts winner.",
      "participants": [
        { "contributorId": "u1", "contributorName": "Alice", "value": 90, "confidence": 0.9 },
        { "contributorId": "u2", "contributorName": "Bob", "value": 60, "confidence": 0.8 }
      ],
      "suggestedClarificationQuestions": [
        "What empirical benchmarks or operational assumptions justify a score of 60 versus 90 on 'Growth'?"
      ],
      "resolution": {
        "status": "open"
      }
    }
  ],
  "criteriaMetrics": [],
  "priorityBreakdown": [
    { "optionId": "opt_alpha", "optionName": "Option Alpha", "recommendationCount": 1, "percentage": 50 },
    { "optionId": "opt_beta", "optionName": "Option Beta", "recommendationCount": 1, "percentage": 50 }
  ],
  "summary": "Detected 2 disagreements across 2 participants (1 decision-critical)."
}
```

---

### 33. Update Disagreement Resolution
`PATCH /api/decisions/:id/disagreements/:disagreementId/resolution`

Updates the human governance resolution status and consensus rationale for a disagreement item.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Decision `owner` or `editor`. (Viewers and contributors receive `403 Forbidden`).

#### Request Body
```json
{
  "status": "resolved", // "open" | "acknowledged" | "resolved"
  "resolutionExplanation": "Consensus reached after reviewing benchmark data."
}
```

#### Response: `200 OK`
```json
{
  "status": "resolved",
  "explanation": "Consensus reached after reviewing benchmark data.",
  "resolvedByName": "Lead Architect",
  "resolvedAt": "2026-10-31T20:00:00.000Z"
}
```

---

### 34. Explain Disagreement with AI
`POST /api/decisions/:id/disagreements/:disagreementId/ai-explain`

Generates an advisory, neutral mediation synthesis and structured clarification questions.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Any authorized collaborator (`owner`, `editor`, `contributor`, `viewer`).

#### Response: `200 OK`
```json
{
  "disagreementId": "disag_score_crit_growth",
  "neutralSummary": "Participants hold differing expectations regarding scalability timeline...",
  "underlyingAssumptions": [
    "Assumes immediate enterprise adoption vs phased pilot rollout."
  ],
  "suggestedClarificationQuestions": [
    "What rollout timeline is realistically anticipated?"
  ],
  "disclaimer": "AI explanations are advisory synthesis tools designed for mediation. They do not alter authoritative MCDA evaluations or declare a participant correct."
}
```

---

## Expert Calibration Endpoints (Phase 12)

### 35. List Predictions
`GET /api/decisions/:id/predictions`

Lists expert predictions submitted for a decision, including prospective forecasts and verified outcomes.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Any authorized decision collaborator (`owner`, `editor`, `contributor`, `viewer`).

#### Query Parameters
- `contributorId` (optional): Filter predictions by specific expert user ID.
- `status` (optional): Filter by prediction status (`submitted`, `awaiting_outcome`, `outcome_recorded`, `verified`, `disputed`, `invalidated`).
- `domain` (optional): Filter by domain category (e.g. `engineering`, `finance`, `security`).

#### Response: `200 OK`
```json
{
  "items": [
    {
      "id": "67215c26b8b548b26e95d140",
      "decisionId": "67215c26b8b548b26e95d11f",
      "contributorId": "67215c26b8b548b26e95d11e",
      "contributorName": "Expert Alice",
      "predictionId": "pred_alpha_perf",
      "statement": "Option Alpha throughput will exceed 50k RPS in production load testing.",
      "probability": 0.85,
      "domain": "engineering",
      "targetDate": "2026-12-01T00:00:00.000Z",
      "evidenceReferences": ["https://benchmark.local/run-42"],
      "status": "verified",
      "submittedAt": "2026-10-31T20:00:00.000Z",
      "outcome": {
        "outcomeId": "outc_alpha_perf",
        "observedOutcome": 1,
        "verificationStatus": "verified",
        "verificationSource": "Production load test run report #841",
        "outcomeDate": "2026-11-20T14:00:00.000Z",
        "verifiedById": "67215c26b8b548b26e95d11a",
        "verifiedByName": "Decision Owner",
        "verifiedAt": "2026-11-20T16:00:00.000Z"
      },
      "createdAt": "2026-10-31T20:00:00.000Z",
      "updatedAt": "2026-11-20T16:00:00.000Z"
    }
  ]
}
```

---

### 36. Create Prospective Prediction
`POST /api/decisions/:id/predictions`

Submits a new prospective empirical prediction for a decision prior to the event outcome.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Decision `contributor`, `editor`, or `owner`.

#### Request Body
```json
{
  "statement": "Option Alpha throughput will exceed 50k RPS in production load testing.",
  "probability": 0.85,
  "domain": "engineering",
  "targetDate": "2026-12-01T00:00:00.000Z",
  "evidenceReferences": ["https://benchmark.local/run-42"]
}
```

#### Response: `201 Created`
Returns the created prediction record.

---

### 37. Record & Verify Outcome
`POST /api/decisions/:id/predictions/:predictionId/outcome`

Records an empirical observed outcome for a prediction with verification credentials and source.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Decision `owner` or `editor`. (Standard contributors and viewers receive `403 Forbidden`).

#### Request Body
```json
{
  "observedOutcome": 1,
  "outcomeDate": "2026-11-20T14:00:00.000Z",
  "verificationSource": "Production load test run report #841",
  "verificationStatus": "verified"
}
```

#### Response: `200 OK`
Returns the updated prediction record with verified outcome details.

---

### 38. Dispute Outcome
`PATCH /api/decisions/:id/predictions/:predictionId/dispute`

Disputes a recorded outcome, providing a governance rationale. Immediately excludes the forecast from calibration scoring.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Any authorized decision collaborator (`owner`, `editor`, `contributor`, `viewer`).

#### Request Body
```json
{
  "disputeReason": "Load test was run on non-production staging cluster with different CPU specs."
}
```

#### Response: `200 OK`
Returns the updated prediction record with status set to `disputed`.

---

### 39. Get Decision & Expert Calibration
`GET /api/decisions/:id/calibration`

Calculates deterministic calibration statistics (Brier score, calibration bins, ECE) for participants in this decision, strictly separating calibration, domain, experience, evidence quality, and social popularity signals.

#### Authentication
Required (`Bearer <JWT>`)

#### Permission
Any authorized decision collaborator (`owner`, `editor`, `contributor`, `viewer`).

#### Response: `200 OK`
```json
{
  "decisionId": "67215c26b8b548b26e95d11f",
  "methodologyVersion": "1.0.0",
  "calculatedAt": "2026-10-31T22:00:00.000Z",
  "totalPredictions": 10,
  "verifiedCount": 8,
  "awaitingOutcomeCount": 1,
  "disputedCount": 1,
  "overallBrierScore": 0.082,
  "climatologyBrierSkillScore": 0.65,
  "expectedCalibrationError": 0.075,
  "hasSufficientSample": true,
  "minimumSampleThreshold": 3,
  "calibrationBins": [
    {
      "binIndex": 0,
      "range": "[0.0, 0.2)",
      "count": 2,
      "meanPredictedProbability": 0.15,
      "observedFrequency": 0.0,
      "calibrationError": 0.15
    },
    {
      "binIndex": 4,
      "range": "[0.8, 1.0]",
      "count": 6,
      "meanPredictedProbability": 0.88,
      "observedFrequency": 0.83,
      "calibrationError": 0.05
    }
  ],
  "expertProfiles": [
    {
      "contributorId": "67215c26b8b548b26e95d11e",
      "contributorName": "Expert Alice",
      "calibration": {
        "hasSufficientSample": true,
        "eligibleCount": 5,
        "brierScore": 0.064,
        "expectedCalibrationError": 0.052,
        "climatologyBss": 0.72
      },
      "domainBreakdown": [
        { "domain": "engineering", "count": 4, "brierScore": 0.05 }
      ],
      "experience": {
        "totalContributions": 3,
        "totalPredictions": 6,
        "verifiedPredictions": 5,
        "awaitingOutcome": 1
      },
      "evidenceQuality": {
        "citationsProvided": 8,
        "verifiedReferences": 5
      },
      "recency": {
        "lastPredictionAt": "2026-10-31T20:00:00.000Z",
        "lastOutcomeAt": "2026-11-20T14:00:00.000Z"
      },
      "popularity": {
        "label": "Social consensus signal (display-only, not an accuracy or calibration metric)",
        "preferredOptionAgreementRate": 0.67
      }
    }
  ],
  "formulaDocumentation": {
    "brierScore": "BS = (1/N) * sum((p_i - o_i)^2)",
    "ece": "ECE = sum((N_b / N) * |p_bar_b - o_bar_b|)",
    "bss": "BSS = 1 - (BS / BS_ref)"
  }
}
```
