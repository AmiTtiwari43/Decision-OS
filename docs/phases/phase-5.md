# Phase 5 — Authentication, Users, Ownership & RBAC

## Precondition
Phase 4 Frontend/Backend Integration is complete and independently audited (commit `1cac238`), connecting the frontend UI to persistent MongoDB storage and authoritative server calculations. Monorepo verification gate `npm run verify` passing across all workspaces.

## Objective & Security Boundary
Implement secure authentication, persistent user identity, decision ownership, and server-enforced authorization across Decision OS.

The enforced security boundary is:
$$\text{Unauthenticated Request} \longrightarrow \text{Authentication} \longrightarrow \text{Authenticated Identity} \longrightarrow \text{Authorization} \longrightarrow \text{Domain Service} \longrightarrow \text{MongoDB}$$

Every protected operation establishes the user's identity and verifies ownership/permissions on the server. Security never relies on client-side routing, hidden UI controls, or client-supplied claims.

---

## Architectural & Security Decisions

### 1. User Identity & Password Security
- **Model**: `UserModel` (`apps/api/src/models/user.model.ts`) with stable ObjectId, case-insensitive normalized `email`, `passwordHash`, `name`, `role` (`'user' | 'admin'`), `isActive` boolean flag, and timestamps.
- **Hashing**: `bcryptjs` with salt rounds = 12. Plaintext passwords and hashes are never logged, serialized, or returned in API responses.
- **Enumeration Defense**: When login is attempted with a nonexistent email, `dummyVerifyPassword` executes against a valid bcrypt hash, preventing timing-based account enumeration. All authentication failures return the generic message `"Invalid email or password"` with HTTP 401.

### 2. Session & Token Management
- **Token Mechanism**: Standard signed JWT tokens via `@fastify/jwt` using HMAC-SHA256 and configured `JWT_SECRET` (minimum 16 characters in dev/test; 32+ in prod).
- **Identity Derivation**: User identity is derived strictly from the verified JWT payload (`sub`, `id`, `email`, `role`). Client-supplied `userId`, `ownerId`, or role claims in request bodies or query parameters are stripped defensively.
- **Token Invalidation & Expiration**: Expired, malformed, or tampered tokens return structured `401 Unauthorized`. On the client, any 401 response immediately clears the in-memory token.
- **In-Memory Credential Policy**: In adherence to strict browser security guidelines, authentication tokens are stored exclusively in-memory within the API client and React context. Authentication credentials are never persisted to `localStorage` or `sessionStorage`.

### 3. Decision Ownership & Enumeration-Resistant Access Control
- **Schema**: `DecisionSchema` has an indexed `ownerId` (`Schema.Types.ObjectId`, `ref: 'User'`). A compound index `{ ownerId: 1, createdAt: -1 }` optimizes scoped pagination.
- **Creation Scoping**: On `POST /api/decisions`, the server strips any incoming `ownerId` and sets `ownerId` to the authenticated `request.user.id`.
- **Cross-User Protection (404 Enumeration Defense)**: If User B attempts to `GET`, `PUT`, `DELETE`, or `POST /analyze` a decision owned by User A, the server throws `DecisionNotFoundError` returning **`404 Not Found`** (never `403 Forbidden`). An attacker cannot discover whether a decision ID exists.
- **Scoped Listings**: On `GET /api/decisions`, query results for standard users are strictly scoped to `{ ownerId: request.user.id }`.
- **Role-Based Access Control (RBAC)**: Users with `role: 'admin'` are permitted to inspect, update, and moderate decisions across any owner.
- **Legacy Decisions Safe Policy**: Decisions created prior to Phase 5 without an `ownerId` remain accessible in a read-only state for demonstration, but cannot be modified or claimed by regular users without administrator privileges.

---

## Endpoints Implemented

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | No | Creates new account with bcrypt hash, returns user DTO and JWT |
| `POST` | `/api/auth/login` | No | Authenticates credentials with constant-time check, returns user DTO and JWT |
| `POST` | `/api/auth/logout` | No | Clears active session confirmation |
| `GET` | `/api/auth/me` | Yes (`Bearer`) | Returns authenticated user profile |
| `POST` | `/api/decisions` | Yes (`Bearer`) | Creates decision, automatically assigning `ownerId = request.user.id` |
| `GET` | `/api/decisions` | Yes (`Bearer`) | Lists decisions scoped strictly to the authenticated user's ownership |
| `GET` | `/api/decisions/:id` | Yes (`Bearer`) | Retrieves decision if owned by caller or caller is admin (404 otherwise) |
| `PUT` | `/api/decisions/:id` | Yes (`Bearer`) | Updates decision if owned by caller or caller is admin (404 otherwise) |
| `DELETE`| `/api/decisions/:id` | Yes (`Bearer`) | Deletes decision if owned by caller or caller is admin (404 otherwise) |
| `POST` | `/api/decisions/:id/analyze` | Yes (`Bearer`) | Runs MCDA engine if owned by caller or caller is admin (404 otherwise) |

---

## Frontend Integration (`apps/web`)

1. **API Client (`DecisionApiClient`)**:
   - Manages in-memory token state via `setToken(token)` and `getToken()`.
   - Injects `Authorization: Bearer <token>` on all requests when token is present.
   - Clears in-memory token on any `401 Unauthorized` response.
   - Implements `register`, `login`, `logout`, and `getCurrentUser`.

2. **Context & State Management (`AuthContext`, `useAuth`)**:
   - `AuthProvider` wraps application root.
   - Exposes reactive `user`, `isAuthenticated`, `isLoading`, `error`, `login`, `register`, `logout`.
   - Manages modal visibility with `openAuthModal` and `closeAuthModal`.

3. **Authentication Modal (`AuthModal.tsx`)**:
   - Accessible, theme-consistent dialog (slate/surface/signal visual identity).
   - Mode switcher between "Sign In" and "Create Account".
   - Client-side validation for email formatting, non-empty fields, and 8+ character password length.
   - Real-time error handling with accessible alerts.

4. **Navbar Controls (`Navbar.tsx`)**:
   - Unauthenticated state: Renders sleek "Sign In" button opening modal.
   - Authenticated state: Renders User Pill with user initial avatar, truncated name, `ADMIN` badge (if applicable), and one-click "Sign out" button.

5. **Decision Persistence UX (`InteractiveModal.tsx`)**:
   - Unauthenticated users can explore preview calculations in the interactive sandbox.
   - Clicking "Save to Server" or opening "Saved Records" prompts unauthenticated users with the Auth Modal.

---

## Adversarial Review Matrix

| # | Adversarial Attack Scenario | Expected Outcome | Verified Mechanism |
| :- | :--- | :--- | :--- |
| **1** | Attacker accesses private decision ID without token | 401 Unauthorized | Fastify `app.authenticate` hook checks Authorization header |
| **2** | User B attempts to GET User A's private decision | 404 Not Found | `assertCanAccessDecision` verifies owner equality; returns 404 to avoid enumeration |
| **3** | User B attempts to PUT/modify User A's decision | 404 Not Found | `assertCanMutateDecision` verifies owner equality; returns 404 |
| **4** | User B attempts to DELETE User A's decision | 404 Not Found | `assertCanMutateDecision` verifies owner equality; returns 404 |
| **5** | User B attempts to re-analyze User A's decision | 404 Not Found | `assertCanMutateDecision` verifies owner equality; returns 404 |
| **6** | Client injects spoofed `ownerId` in `POST /api/decisions` | Spoofed ID stripped | `stripServerFields` removes `ownerId`; server assigns `request.user.id` |
| **7** | Client injects `ownerId` in `PUT /api/decisions/:id` | Ownership change rejected | `stripServerFields` removes `ownerId`; repository preserves original owner |
| **8** | Attacker attempts to list all decisions via `GET /api/decisions` | Scoped to caller | `listDecisions` forces `effectiveFilter.ownerId = requester.id` |
| **9** | Attacker submits tampered JWT signature | 401 Unauthorized | `@fastify/jwt` verify fails; caught and returned as 401 |
| **10**| Attacker submits expired JWT token | 401 Unauthorized | `@fastify/jwt` rejects expired token with 401 |
| **11**| Attacker probes nonexistent email via login timing | Constant-time failure | `dummyVerifyPassword` runs bcrypt compare against dummy hash |
| **12**| Attacker registers duplicate email (different casing) | 409 Conflict | Email is normalized (`toLowerCase().trim()`); duplicate rejected |
| **13**| Client attempts to mutate unowned legacy decision | 404 Not Found | `assertCanMutateDecision` blocks mutations on unowned records unless admin |
| **14**| Administrator views/manages decision from any owner | 200 OK / 204 No Content| RBAC rule explicitly permits `role: 'admin'` override |

---

## Verification & Status

Verification gate `npm run verify` passed cleanly with code 0:
- **Typecheck**: 0 errors across `@decision-os/api`, `@decision-os/web`, `@decision-os/decision-engine`.
- **Lint**: 0 errors across all workspaces (only 1 pre-existing MonteCarloTester purity warning in web).
- **Test Suite**: 25 test files, 203 passed (104 API, 52 Web, 47 Decision Engine).
- **Build**: 0 errors across all workspaces.

**Phase 5 is complete, fully tested, and ready for audit.**
