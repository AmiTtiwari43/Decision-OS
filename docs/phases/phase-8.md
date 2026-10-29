# Decision OS — Phase 8 Specification: Evidence and Provenance

## 1. Overview & Objective

Phase 8 introduces a structured **Evidence and Provenance** subsystem for Decision OS.
The objective is to allow decision makers, editors, and contributors to ground decisions, options, criteria, and expert contributions with traceable, attributed source materials.

### Core Invariants
1. **Separation from Assertions & MCDA Results:** Evidence records substantiate claims and reasoning; they are NOT votes, scores, or authoritative weights. Adding, modifying, or removing evidence has **zero mathematical effect** on decision criteria, weights, scores, ranking, or MCDA calculations.
2. **Explicit Provenance Distinction:** The system strictly distinguishes between:
   - The original source citation / URL.
   - The verbatim excerpt from that source.
   - The user's subjective interpretation / relevance summary.
   No automatic or implicit "verified" or "fact-checked" badge is ever rendered.
3. **URL Scheme Safety & SSRF Immunity:** Source URLs must strictly use `http://` or `https://`. Dangerous schemes (`javascript:`, `data:`, `file:`, `blob:`, etc.) are rejected at validation time. The server does NOT perform arbitrary external fetches of URLs, preventing Server-Side Request Forgery (SSRF).
4. **Target Scoping:** Every evidence record is linked to a parent decision and an attachment target:
   - `decision`: attached at the decision root.
   - `option`: attached to a specific option (`targetId === option.id`).
   - `criterion`: attached to a specific criterion (`targetId === criterion.id`).
   - `contribution`: attached to a specific expert contribution (`targetId === contribution._id.toString()`).
   Cross-decision referencing is strictly rejected with `400 Bad Request`.
5. **Authorization & Privacy:** Evidence visibility inherits the parent decision's authorization boundary:
   - Read: Collaborators (`owner`, `editor`, `viewer`, `contributor`). Unrelated users receive `404 Not Found`.
   - Create: `owner`, `editor`, or `contributor`. (Viewers receive `403 Forbidden`).
   - Modify / Delete: The evidence author (`createdById`), the decision `owner`, or an `admin`.
6. **Cascading Lifecycle:** When a decision is deleted, all associated evidence documents are deleted automatically.

---

## 2. Evidence Data Model (`decision_evidence` collection)

```typescript
export type EvidenceTargetType = 'decision' | 'option' | 'criterion' | 'contribution';
export type EvidenceType = 'url' | 'document' | 'excerpt';
export type EvidenceCapturedVia = 'manual_entry' | 'web_link' | 'document_citation';

export interface IDecisionEvidence {
  _id: Types.ObjectId;
  decisionId: Types.ObjectId;
  targetType: EvidenceTargetType;
  targetId: string;
  createdById: Types.ObjectId;
  type: EvidenceType;
  title: string;
  sourceUrl?: string | null;
  documentReference?: string | null;
  sourceExcerpt?: string | null;
  userSummary?: string | null;
  publicationDate?: Date | null;
  provenance: {
    createdByName: string;
    createdByEmail: string;
    capturedVia: EvidenceCapturedVia;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

### Database Constraints & Indexes
- Compound Target Index: `{ decisionId: 1, targetType: 1, targetId: 1 }`
- Query Index: `{ decisionId: 1, createdAt: -1 }`
- Creator Index: `{ createdById: 1 }`

---

## 3. API Endpoints

All evidence routes require authentication (`Bearer <token>`) and reside under `/api/decisions/:id/evidence`.

| Method | Endpoint | Auth | Required Role | Description |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/api/decisions/:id/evidence` | Yes | Collaborator / Owner | List evidence for decision (optional `targetType`, `targetId` filters) |
| `POST` | `/api/decisions/:id/evidence` | Yes | Contributor / Editor / Owner | Create an evidence record |
| `GET` | `/api/decisions/:id/evidence/:evidenceId` | Yes | Collaborator / Owner | Retrieve specific evidence record |
| `PATCH`| `/api/decisions/:id/evidence/:evidenceId` | Yes | Creator / Owner / Admin | Update permitted metadata (title, summary, excerpt, source) |
| `DELETE`| `/api/decisions/:id/evidence/:evidenceId` | Yes | Creator / Owner / Admin | Delete an evidence record |

