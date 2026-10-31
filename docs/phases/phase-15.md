# Phase 15: Performance and Scale Specification

## 1. Overview & Objective

Phase 15 delivers measurable performance improvements, resource optimization, reliability controls, and scalability hardening for Decision OS without rebuilding the application, compromising mathematical integrity, or introducing unnecessary external infrastructure (such as Redis clusters, microservices, or external message brokers).

---

## 2. Measurable Targets & Optimization Plan

### Area 1: Canonical MCDA Engine Performance
- **Problem**: `runMonteCarloSimulation` creates ~10,000 throwaway objects per 1,000-iteration simulation (criteria maps, normalization targets, scores arrays, filter arrays), inducing heavy garbage collection pressure.
- **Optimization**:
  - Pre-index static criteria metadata (locked set, index lookups, base weights).
  - Use pre-allocated numerical arrays for intermediate perturbations, scores, and winner identification.
  - Preserve 100% exact numerical determinism: identical Mulberry32 sequence, identical Box-Muller Gaussian transformation, identical Hare-Niemeyer Largest Remainder logic and tie-breaking.
- **Expected Gain**: >3x higher simulation throughput, <1.0 ms/run for 1,000 iterations, near-zero GC allocations.

### Area 2: MongoDB & Database Optimization
- **Problem**:
  - Missing compound index on `DecisionContributionModel` (`{ decisionId: 1, createdAt: -1 }`) degrades date-bounded workspace aggregations.
  - Read-heavy queries load full Mongoose documents with change-tracking overhead instead of lightweight plain objects.
  - Missing explicit connection pool bounds (`maxPoolSize`, `minPoolSize`, `maxIdleTimeMS`).
- **Optimization**:
  - Add `{ decisionId: 1, createdAt: -1 }` index to `DecisionContributionModel`.
  - Apply `.lean()` across all read-only repository listings (`decisionRepository.list`, `auditRepository.listByDecisionId`, `evidenceRepository.listByDecisionId`, etc.).
  - Configure robust MongoDB connection pool parameters (`minPoolSize: 5`, `maxPoolSize: 50`, `maxIdleTimeMS: 30000`, `serverSelectionTimeoutMS: 5000`).

### Area 3: Backend Performance, Resiliency & Caching
- **Problem**:
  - Large JSON payloads (such as 50-item decision lists and complete audit event histories) are transmitted uncompressed over HTTP.
  - Identical authoritative MCDA evaluations are recalculated on every request even when decision version and inputs have not changed.
  - Fastify lacks body limits, compression, and fine-grained operational diagnostics.
- **Optimization**:
  - Register `@fastify/compress` (Brotli + Gzip) with standard 1KB threshold.
  - Implement an in-memory LRU evaluation cache keyed by `decisionId:version:inputHash` to return cached authoritative MCDA evaluations instantly for unmodified decisions.
  - Add request body limits (`bodyLimit: 1048576` = 1MB) and configure graceful shutdown handlers.
  - Enhance `/health/ready` and add `/health/diagnostics` providing process memory, uptime, event-loop lag, and real-time collaboration metrics.

### Area 4: Frontend Code Splitting & Bundle Optimization
- **Problem**:
  - Vite outputs a single 726 kB monolithic JavaScript bundle (`index-DwUsJuB2.js`) because all 10 modal dialogs are statically imported in `App.tsx` and `InteractiveModal.tsx`.
- **Optimization**:
  - Use `React.lazy()` and `Suspense` for secondary on-demand modals (`AuditExportModal`, `AiAnalystModal`, `AnalyticsModal`, `ExpertCalibrationModal`, `DisagreementsModal`, `ShareModal`, `ContributionsModal`, `EvidenceModal`, `WorkspaceAnalyticsModal`, `AcceptInvitationModal`).
  - Configure Vite `manualChunks` in `vite.config.ts` to split third-party dependencies (`vendor-react`, `vendor-motion`, `vendor-icons`, `decision-engine`).
- **Expected Gain**: Initial JavaScript bundle reduced from 726 kB to <250 kB, eliminating the Vite >500 kB chunk warning and accelerating initial page load.

### Area 5: Real-Time Collaboration Scalability
- **Optimization**:
  - Add active connection metrics (`getActiveSubscribersCount()`, `getBroadcastMetrics()`).
  - Graceful connection termination on server shutdown, signaling `sync_required` or graceful disconnect to all SSE clients before closing sockets.
  - Protect against unbounded event buffer memory growth.

