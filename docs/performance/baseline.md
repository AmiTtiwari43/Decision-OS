# Decision OS — Phase 15: Performance Baseline Report

## 1. Test Environment & Methodology

- **Operating System / Environment**: Windows 11 (win32 x64)
- **Node.js Runtime**: v22.13.1
- **Database Engine**: MongoDB 7.0 / 8.0 on localhost (`127.0.0.1:27017`)
- **Fastify Web Framework**: v5.2.1
- **React Frontend**: React 19.2.8 + Vite 8.2.1
- **Deterministic Dataset**:
  - Sample Multi-Criteria Model: 5 criteria (`crit-cost`, `crit-speed`, `crit-quality`, `crit-risk`, `crit-ux`) with locked weights (`crit-quality` = 20%).
  - Options: 4 alternative architectures (`opt-cloud-native`, `opt-monolith`, `opt-serverless`, `opt-cots`).
  - Database: 50 persistent test decisions with complete score matrices and evaluations.
  - Audit: 50 sequentially chained cryptographic SHA-256 events.
  - Real-Time Collaboration: 50 concurrent SSE subscribers.
- **Harness**: `scripts/benchmark.ts` using `node:perf_hooks` with precise sub-millisecond nanosecond counters.

---

## 2. Canonical MCDA Engine Baseline

Profiling authoritative calculation engine routines (`packages/decision-engine`):

| Operation | Iterations / Workload | Total Duration | Throughput / Latency |
| :--- | :--- | :--- | :--- |
| **Weight Normalization (Hare-Niemeyer)** | 10,000 runs | 41.75 ms | **239,536 ops/sec** (0.004 ms/op) |
| **Full Authoritative Evaluation** | 3,000 runs | 69.73 ms | **43,022 ops/sec** (0.023 ms/op) |
| **Monte Carlo Simulation (1,000 iterations)** | 200 simulations (200,000 total iterations) | 688.11 ms | **291 runs/sec** (**3.44 ms/run**) |
| **Monte Carlo Simulation (5,000 iterations)** | 50 simulations (250,000 total iterations) | 716.11 ms | **14.32 ms/run** |
| **Counterfactual Weight Shifts** | 500 runs | 8.95 ms | **55,838 ops/sec** (0.018 ms/op) |

### Key Bottleneck in Engine:
In `runMonteCarloSimulation`:
Every single one of the 1,000 iterations allocates:
- 1 array map creating shallow copies of criterion objects (`{ ...c, weight, isLocked }`).
- 1 call to `normalizeWeights` which creates Sets, filters, target objects, and sort arrays.
- 1 array allocation for option score calculations.
- Filter allocations for tie-breaking winners.
Allocating ~10,000 objects per simulation causes substantial garbage collection pressure under sustained workloads.

---

## 3. Database & MongoDB Baseline

Profiling MongoDB queries on test database collection (`50` decisions, `50` audit events):

| Query / Operation | Sample Count | p50 Latency | p95 Latency | p99 Latency | Average Latency |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Decision Read (Mongoose doc)** | 300 queries | 1.74 ms | 2.93 ms | 4.23 ms | 1.89 ms |
| **Decision Read (Lean document)** | 300 queries | 1.59 ms | 2.22 ms | 4.66 ms | 1.67 ms |
| **Paginated List (`ownerId`, sort `createdAt`)** | 150 queries | 4.48 ms | 7.44 ms | 16.57 ms | 4.93 ms |
| **Workspace Analytics Aggregation** | 100 pipelines | 3.87 ms | 8.02 ms | 11.49 ms | 4.44 ms |
| **Audit Chain 50 Events Verification** | 50 checks | 6.71 ms | 10.33 ms | 11.54 ms | 7.00 ms |

### Key Bottlenecks in Database:
1. `decision.repository.ts`, `audit.repository.ts`, `evidence.repository.ts`, `contribution.repository.ts` instantiate full Mongoose documents for read queries, incurring prototype inheritance and change-tracking proxy overhead.
2. Missing compound index `{ decisionId: 1, createdAt: -1 }` on `DecisionContributionModel` used during date-bounded workspace aggregations.
3. MongoDB connection pool settings default to Mongoose defaults without explicit `maxPoolSize` / `minPoolSize` tuning or idle socket reaping.

---

## 4. Backend Fastify API Response Latency Baseline

Profiling Fastify API endpoints:

| Endpoint | Sample Count | p50 Latency | p95 Latency | p99 Latency | Average Latency |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET /health` (Liveness) | 300 requests | 0.16 ms | 0.61 ms | 2.17 ms | 0.70 ms |
| `GET /health/ready` (DB ping readiness) | 300 requests | 1.28 ms | 2.24 ms | 7.63 ms | 1.51 ms |
| `GET /api/decisions` (List 20 decisions) | 150 requests | 8.25 ms | 21.85 ms | 55.74 ms | 10.10 ms |
| `GET /api/decisions/:id` (Fetch single) | 200 requests | 2.48 ms | 3.88 ms | 8.71 ms | 2.79 ms |
| `GET /api/decisions/:id/analysis` | 150 requests | 0.19 ms | 0.59 ms | 1.54 ms | 0.25 ms |
| `POST /presence` (SSE Heartbeat) | 150 requests | 2.65 ms | 4.63 ms | 7.44 ms | 2.91 ms |

### Key Bottlenecks in API:
1. Wire payload compression is absent (`@fastify/compress` not registered), sending raw JSON for large decision models and audit histories.
2. In-memory caching for immutable authoritative decision calculations is not present; repeated evaluation of the same decision version recalculates sensitivity and explainability.
3. Health and readiness endpoints do not report process memory, uptime, event-loop lag, or real-time connection telemetry.
4. Request payload body limits and rate limiting are not configured on Fastify.

---

## 5. Real-Time Collaboration Baseline

| Metric | Measured Baseline |
| :--- | :--- |
| **Concurrent Active Subscribers Tested** | 50 clients |
| **Broadcast Delivery Latency** | **0.456 ms** across all 50 clients |
| **Heartbeat / Presence Overhead** | 2.65 ms p50 |
| **Cleanup on Disconnect** | Verified (sets deleted when 0 subscribers remain) |

---

## 6. Frontend Bundle Baseline

Vite production build output (`apps/web`):

| Asset | Size (Uncompressed) | Size (Gzip) | Note |
| :--- | :--- | :--- | :--- |
| `dist/index.html` | 1.50 kB | 0.72 kB | Initial HTML |
| `dist/assets/index-Bbt73QLZ.css` | 92.97 kB | 13.94 kB | Tailwind CSS |
| `dist/assets/index-DwUsJuB2.js` | **726.20 kB** | **186.62 kB** | **Single monolithic chunk (>500 kB Vite warning)** |
| **Total Initial Bundle** | **820.67 kB** | **201.28 kB** | Eagerly bundles all 10 modal components |

### Key Bottlenecks in Frontend:
1. All 10 complex modals (`AuditExportModal`, `AiAnalystModal`, `AnalyticsModal`, `ExpertCalibrationModal`, `DisagreementsModal`, `ShareModal`, `ContributionsModal`, `EvidenceModal`, `WorkspaceAnalyticsModal`, `AcceptInvitationModal`) are statically imported in `App.tsx` and `InteractiveModal.tsx`.
2. Lack of dynamic `import()` and code-splitting causes unnecessary parsing and compilation of audit, calibration, and AI charting logic on initial page view.
3. Rollup manualChunks are not configured for large vendor libraries (`framer-motion`, `lucide-react`, `react-dom`).

