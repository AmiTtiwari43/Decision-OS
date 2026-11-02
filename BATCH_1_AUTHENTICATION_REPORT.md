# Decision OS — Batch 1: Authentication and Session Restoration Report

**Status**: Verified & Passing  
**Timestamp**: 2026-11-02  
**Target Workspaces**: `@decision-os/web`, `@decision-os/api`

---

## 1. Authentication Architecture Discovered

A comprehensive inspection of the backend authentication codebase (`apps/api/src/routes/auth.ts`, `apps/api/src/plugins/auth.ts`, `apps/api/src/app.ts`, `apps/api/src/services/auth.service.ts`) revealed:

1. **Authentication Protocol**:
   - The backend utilizes **Fastify JWT** (`@fastify/jwt`) with symmetric HMAC SHA-256 signing via `JWT_SECRET`.
   - Token validity is 7 days (`expiresIn: '7d'`).
   - The payload contains `{ sub: user.id, id: user.id, email: user.email, role: user.role }`.
2. **Transport & Credentials**:
   - Protected routes enforce authentication via `preHandler: [app.authenticate]`, which parses and verifies the HTTP header:
     ```http
     Authorization: Bearer <token>
     ```
   - Missing, malformed, or expired tokens result in a standard RFC-compliant error:
     ```json
     {
       "statusCode": 401,
       "error": "Unauthorized",
       "message": "Authentication required: missing or invalid Authorization header",
       "requestId": "req-..."
     }
     ```
3. **Cookie Configuration**:
   - The backend has **no cookie support**; `@fastify/cookie` is neither installed nor registered.
   - The backend issues no `Set-Cookie` headers on register, login, or logout.
   - CORS is configured to allow `origin: http://localhost:5173` without `credentials: true`.
4. **Refresh Tokens**:
   - There is no refresh-token endpoint in the backend architecture. Tokens remain valid for 7 days unless invalidated by key rotation or client logout.

---

## 2. Session Strategy Selected & Justification

### Selected Strategy: Safe Client-Side Storage with On-Mount Verification (`localStorage`)

- **Why Not HttpOnly Cookies?**
  The backend contracts and test suites strictly require Bearer token authorization in the HTTP `Authorization` header. Introducing HttpOnly cookies on the backend would violate the contractual requirement: *"Do not silently change backend authentication contracts."*
- **Persistence Mechanism**:
  - The JWT token is saved in browser `localStorage` under the key `decision_os_token`.
  - When the user returns or reloads the browser, `AuthProvider` reads `decision_os_token`, attaches it to `DecisionApiClient`, and calls `GET /api/auth/me`.
  - If the token is valid, the user's profile (`UserDto`) is loaded, restoring the authenticated session seamlessly.
  - If the token has expired, been tampered with, or rejected by the server (401), the token is purged from `localStorage`, `DecisionApiClient.setToken(null)` is invoked, and state resets to unauthenticated.
- **Initialization Gate (`isInitializing`)**:
  - An `isInitializing` boolean flag prevents any brief flash of unauthenticated or authenticated content before session validation completes. While initializing, a minimal loading screen with the Decision OS brand logo is rendered.
- **Automatic 401 Interceptor**:
  - `DecisionApiClient` exposes an `onUnauthorized` hook. Whenever any API request anywhere in the application receives a 401 response, `localStorage` is cleared and the React auth state is reset.

---

## 3. Files Created and Modified

1. **`apps/web/src/api/client.ts`**:
   - Added `setOnUnauthorized(callback?: () => void)` method.
   - Added automatic trigger of `onUnauthorized` callback upon receiving HTTP 401 Unauthorized status.
2. **`apps/web/src/context/authContextDef.ts`**:
   - Added `isInitializing: boolean` to `AuthContextValue` interface.
3. **`apps/web/src/context/AuthContext.tsx`**:
   - Added safe browser `localStorage` utilities with sandboxing/SSR fallbacks (`getStoredToken`, `setStoredToken`).
   - Added `isInitializing` state to prevent UI flashes.
   - Implemented `useEffect` hook for on-mount session restoration using `apiClient.getCurrentUser()`.
   - Bound `apiClient.setOnUnauthorized()` listener to invalidate storage and state when sessions expire.
   - Updated `login()`, `register()`, and `logout()` to synchronize tokens with `localStorage`.
4. **`apps/web/src/components/Navbar.tsx`**:
   - Added `activeView` (`'app' | 'marketing'`) and `onSelectView` props.
   - Added authenticated view switcher (`App Hub` vs `Product Tour`).
5. **`apps/web/src/App.tsx`**:
   - Integrated `useAuth` hook into `AppContent`.
   - Added session initialization loader screen.
   - Added authenticated session hub state displaying verified user details, role badge, session status, and workspace actions.
   - Preserved full public marketing site for unauthenticated visitors and for authenticated users who toggle to `Product Tour`.
6. **`apps/web/src/tests/authIntegration.test.ts`**:
   - Added integration tests for `onUnauthorized` callback execution.
   - Added tests for valid session restoration flow.
   - Added tests for expired/rejected token cleanup flow.
7. **`apps/api/tests/batch1_workflow.test.ts`**:
   - Created an end-to-end integration test suite verifying 10 real authentication workflows against the running Fastify server and MongoDB database.

---

## 4. Security Considerations

- **XSS Mitigation**: React JSX escapes all strings by default. User input is never injected raw into the DOM.
- **CSRF Defense**: Because authentication is mediated exclusively via explicit `Authorization: Bearer <token>` headers, cross-site form submissions cannot spoof authenticated requests.
- **Server Authority**: The client never trusts local roles or user IDs. The server verifies the cryptographic signature of the token against `JWT_SECRET` on every request.
- **Protected Route Defense**: All decision, analytics, collaboration, evidence, and export routes enforce `app.authenticate` preHandlers on the server. Tampered tokens return 401.

---

## 5. Actual Tests Executed & Results

### 1. Backend Workflow Integration Test (`apps/api/tests/batch1_workflow.test.ts`)
Executed against live Fastify instance and test MongoDB:
- **Workflow 1: New user registration** — PASS (201 Created, password hashed, JWT issued).
- **Workflow 2: Login with valid credentials** — PASS (200 OK, valid JWT returned).
- **Workflow 3: Login with invalid credentials** — PASS (401 Unauthorized, generic error).
- **Workflow 4: Session restoration** — PASS (GET `/api/auth/me` with bearer token recovers user).
- **Workflow 5: Unauthenticated access to protected route** — PASS (401 Unauthorized on `/api/decisions`).
- **Workflow 6: Tampered / expired JWT** — PASS (401 Unauthorized).
- **Workflow 7: Logout** — PASS (200 OK).
- **Workflow 8: Refresh after logout** — PASS (No token attached, 401 Unauthorized).
- **Workflow 9: Blocked access across protected routes** — PASS (Blocked on `/api/decisions`, `/api/analytics/overview`, `/api/invitations/pending`).
- **Workflow 10: CORS preflight** — PASS (204 No Content, headers verified).

### 2. Frontend Auth Integration Test (`apps/web/src/tests/authIntegration.test.ts`)
- `8 passed (8 tests)` in 65ms:
  1. `setToken` and `getToken` in-memory.
  2. Registration saves token and returns `AuthResponseDto`.
  3. Login saves token and includes `Authorization: Bearer <token>` in requests.
  4. Logout clears token and calls `/api/auth/logout`.
  5. Automatic token purge on 401.
  6. Invocation of `onUnauthorized` callback on 401.
  7. Session restoration with valid token via `/api/auth/me`.
  8. Session cleanup when token is rejected or expired.

### 3. Frontend Web Test Suite (`apps/web`)
- `15 test files passed (109 tests)` in 4.82s.
- `lint:web` passed (14 pre-existing warnings in modals, 0 errors).
- `build:web` (`tsc -b && vite build`) passed with 0 errors.

---

## 6. Remaining Issues & Next Steps

Batch 1 authentication and session restoration is fully functional and verified.

The application now maintains user sessions across browser reloads, properly directs authenticated users to the application workspace hub, and provides a clear toggle back to the marketing site.

---

## 7. Post-Audit Remediation Addendum (November 2, 2026)

Following an independent security audit which assigned verdict **C (FAIL)** due to two blocking defects, the following remediations were implemented and independently verified:

### 1. Fix F-01: Session Preservation During Transient Failures
- **Problem**: In `apps/web/src/context/AuthContext.tsx`, `initSession()` caught all errors unconditionally and purged the token from `localStorage`, destroying sessions during offline reloads or backend restarts.
- **Solution**:
  - Isolated storage utilities in `apps/web/src/context/authStorage.ts` (`getStoredToken`, `setStoredToken`, `TOKEN_KEY`).
  - Updated `AuthContext.tsx` to strictly check `err instanceof ApiClientError && err.statusCode === 401`. Only true 401s purge the stored token.
  - On network failures (`statusCode === 0`), timeouts, or 5xx server errors, the token is safely preserved in `localStorage`, `user` is kept `null` to avoid premature access, and a `sessionError` message is populated.
  - Implemented `retrySession()` in `AuthContextValue` and added a recoverable connection banner in `apps/web/src/App.tsx` allowing single-click reconnection.
  - Added race-condition guards (`sessionGenRef` and `inFlightInitRef`) preventing duplicate requests and stale response overwrites.
- **Verification**: 7 new integration tests added in `authIntegration.test.ts` (15 total, 100% pass).

### 2. Fix F-02: Production JWT_SECRET Enforcement
- **Problem**: `apps/api/src/config/env.ts` defaulted `JWT_SECRET` to a known development fallback key even in `NODE_ENV === 'production'`.
- **Solution**:
  - Refactored `envSchema` with Zod `.transform()` and `.superRefine()`.
  - Development/test environments continue to use the convenient fallback when omitted.
  - Production environments strictly require an explicit, non-empty `JWT_SECRET` (>= 16 characters) and explicitly reject the known development fallback.
  - Startup errors fail fast with non-sensitive messages; the raw secret is never logged.
- **Verification**: 7 new tests added to `apps/api/tests/env.test.ts` (13 total, 100% pass).

### 3. Verification & Monorepo Status
- Independent Lifecycle Audit (`scripts/independent_audit_lifecycle.ts`): **15/15 PASS**.
- Frontend Integration Tests (`npm run test:web`): **15 files, 116 tests PASS**.
- Backend Tests (`npm run test:api`): **24 files, 321 tests PASS**.
- Monorepo Typecheck (`npm run typecheck`): **0 errors**.
- Monorepo Linter (`npm run lint`): **0 errors**.
- Production Build (`npm run build`): **PASS**.

**Remediation Verdict**: Both blocking findings F-01 and F-02 are resolved and verified. Ready to proceed with **Batch 2: Authenticated Dashboard & Decision Hub**.


