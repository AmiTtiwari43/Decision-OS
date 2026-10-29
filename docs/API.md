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

