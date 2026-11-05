# DECISION OS — BATCH 4 REMEDIATION V3.3 CHANGELOG
**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit:** `32215c44cf126b8808199cb983532a4c6bd87049`  
**Previous Baseline:** V3.1 (`c4d656eeabb9e4e969735642377dca0e7df98639`)  
**Release Date:** 2026-11-05  
**Version:** V3.3  

---

## 1. Overview

Batch 4 Remediation V3.3 completes the targeted defect closure identified in the V3.2 independent source audit:
- Prevents false success counts when outbox delivery acknowledgements are rejected.
- Enforces lease validity and claim generation fencing on consumer failure transitions.
- Validates destination idempotency across failure windows with real MongoDB storage and failure injection.
- Replaces caller-supplied cleanup generations with atomic server-side increments and serializes same-worker concurrent drops.
- Eliminates empty-database safety bypasses with an independent durable coordination registry and proves post-drop crash recovery.

---

## 2. Breaking Changes & Contract Updates

### 2.1 Dispatcher Result & Outcome Accounting (`outbox.service.ts`)
- **Changed Type:** `DispatcherResult`
  ```typescript
  export type DispatchOutcome =
    | 'DELIVERED'
    | 'ACKNOWLEDGEMENT_LOST'
    | 'DESTINATION_FAILED'
    | 'CLAIM_LOST';

  export interface DispatchEventDetail {
    notificationId: string;
    outcome: DispatchOutcome;
    claimGeneration: number;
    error?: string;
  }

  export interface DispatcherResult {
    processed: number;
    succeeded: number;
    failed: number;
    acknowledgementLost: number;
    claimLost: number;
    events: DispatchEventDetail[];
  }
  ```
- **Behavior Change:**
  - `dispatchPending()` checks the boolean result of `markDelivered()`.
  - If `markDelivered()` returns `false` (e.g. lease expired, superseded by another worker), `succeeded` is **not** incremented. Instead, `acknowledgementLost` is incremented with `outcome: 'ACKNOWLEDGEMENT_LOST'`.
  - If claim validation fails prior to execution, `claimLost` is incremented with `outcome: 'CLAIM_LOST'`.
  - Strict batch balance invariant guaranteed: `processed === succeeded + failed + acknowledgementLost + claimLost === events.length`.

### 2.2 Consumer Failure Fencing (`outbox.service.ts`)
- **Changed Method Signature:**
  ```typescript
  // Previous (V3.2):
  failConsumerProcessing(consumerId: string, error: string): Promise<boolean>

  // Updated (V3.3):
  failConsumerProcessing(consumerId: string, error: string, workerId: string, claimGeneration: number): Promise<boolean>
  ```
- **Behavior Change:**
  - `workerId` and `claimGeneration` are required arguments.
  - The database update query strictly requires `{ consumerId, processingOwner: workerId, claimGeneration, status: 'CLAIMED', $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] } }`.
  - When the lease is expired or claim is superseded, the method returns `false` without modifying the document.

### 2.3 Retryable Error on Lost Consumer Claim (`outbox.service.ts`)
- **Changed Behavior in `processConsumerEvent`:**
  - If the delivery succeeds but `completeConsumerProcessing()` returns `false` (e.g., worker's lease expired during execution), the method returns:
    ```typescript
    {
      status: 'RETRYABLE_ERROR',
      deliverySemantics: adapter.supportsIdempotency ? 'idempotent_destination' : 'at_least_once_risk',
      error: 'Consumer completion rejected: claim expired or superseded by another worker'
    }
    ```
  - Added `computePayloadHash(payload: unknown): string` utility for deterministic SHA-256 payload hashing in idempotent adapters.
  - Added `payloadHash` and `destinationName` fields to `ConsumerEventContext`.

### 2.4 Server-Side Atomic Cleanup Generation & Coordination Registry (`guard.ts`)
- **Changed Method Signature:**
  ```typescript
  // Previous (V3.2):
  cleanupTestDatabase(databaseName: string, runId: string, workerId: string, cleanupGeneration?: number): Promise<void>

  // Updated (V3.3):
  cleanupTestDatabase(databaseName: string, runId: string, workerId: string): Promise<void>
  ```
- **Behavior Change:**
  - `cleanupGeneration` is no longer caller-controllable. It is incremented exclusively by MongoDB via `$inc: { cleanupGeneration: 1 }`.
  - Same-worker concurrent invocations are serialized by `{ dropInProgress: { $ne: true } }`. Concurrent drops fail closed with a cleanup lock violation.
  - Database lifecycle state across drops is maintained in an independent durable coordination registry (`decision_os_test_coordination_test.cleanup_registry`).
  - Empty databases (`collections.length === 0`) are checked against the coordination registry. Unowned empty databases throw `SafetyGuardViolationError` rather than bypassing safety checks.

---

## 3. Migration Guide for Engineers

### 3.1 Inspecting Dispatcher Outcomes
```typescript
// Previous (V3.2):
const result = await outboxService.dispatchPending(workerId, batchSize, dispatcher);
if (result.succeeded > 0) {
  // Could include items where destination succeeded but markDelivered failed
}

// Updated (V3.3):
const result = await outboxService.dispatchPending(workerId, batchSize, dispatcher);
console.log(`Delivered and acknowledged: ${result.succeeded}`);
console.log(`Destination executed, ack lost: ${result.acknowledgementLost}`);
console.log(`Lost before dispatch: ${result.claimLost}`);

for (const event of result.events) {
  if (event.outcome === 'ACKNOWLEDGEMENT_LOST') {
    logger.warn(`Destination received event ${event.notificationId}, but lease expired before DB ack`);
  }
}
```

### 3.2 Invoking `failConsumerProcessing`
```typescript
// Previous (V3.2):
await outboxService.failConsumerProcessing(consumerId, 'Network error');

// Updated (V3.3):
const acked = await outboxService.failConsumerProcessing(
  consumerId,
  'Network error',
  claimedWorkerId,
  claimGeneration
);
if (!acked) {
  logger.warn('Failed to mark consumer failed: lease was superseded or expired');
}
```

### 3.3 Building Idempotent Destination Adapters
```typescript
import { DestinationAdapter, computePayloadHash } from '../services/outbox.service.js';

const webhookAdapter: DestinationAdapter<{ status: number }, WebhookPayload> = {
  destinationName: 'StripePayment',
  supportsIdempotency: true,
  deliver: async (context) => {
    // context.idempotencyKey contains the stable idempotency key
    // context.payloadHash contains the SHA-256 hash of the payload
    return await sendWebhook({
      idempotencyKey: context.idempotencyKey,
      payloadHash: context.payloadHash,
      data: context.payload,
    });
  },
};
```

---

## 4. Verification & Testing

All changes have been validated across the entire Decision OS monorepo:
- **`apps/api`:** 43 test files, 555 tests passed (including all 188 Batch 4 tests, 28 V3.3 adversarial tests, and 5 V3.3 reproduction tests).
- **`packages/decision-engine`:** 11 test files, 85 tests passed (Canonical engine Golden G1–G10 100% pass, 0 diff).
- **`apps/web`:** 18 test files, 166 tests passed.
- **Monorepo Grand Total:** **806 tests passed, 0 failed, 0 skipped.**
- **TypeScript Diagnostics:** 0 errors (`npm run typecheck`).
- **Linter Diagnostics:** 0 warnings, 0 errors (`npm run lint:api`).
- **Turbo Build:** 3/3 packages built successfully (`npm run build`).
