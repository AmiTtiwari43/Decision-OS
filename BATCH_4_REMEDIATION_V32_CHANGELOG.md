# DECISION OS — BATCH 4 REMEDIATION V3.2 CHANGELOG
**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit:** `c4d656eeabb9e4e969735642377dca0e7df98639`  
**Previous Baseline:** V3.1  
**Release Date:** 2026-11-05  
**Version:** V3.2

---

## 1. Overview

Batch 4 Remediation V3.2 closes the remaining transactional recovery, outbox acknowledgement, and test database isolation gaps identified during the V3.1 review.

---

## 2. Breaking Changes & Contract Updates

### 2.1 Transaction Failure Abort Contract (`operationJournal.repository.ts`)
- **Changed Methods:**
  - `renewOperationLease(operationId, decisionId, workerId, durationMs, session)`
  - `claimJournalOperation(operationId, decisionId, workerId, durationMs, existingSession)`
  - `transitionJournalState(operationId, fromState, toState, workerId, fencingToken, session)`
- **Behavior Change:** When callers supply an active `ClientSession`, any failure (document not found, fencing token mismatch, quarantined decision) now automatically calls `session.abortTransaction()` before throwing `ConcurrencyFencingError`.
- **Caller Impact:** Callers that catch `ConcurrencyFencingError` will find their transaction in an aborted state (`TRANSACTION_ABORTED`). Calling `session.commitTransaction()` on an aborted session will throw `MongoTransactionError: Transaction has been aborted`. Callers should check `session.inTransaction()` before invoking `session.abortTransaction()` in `finally` blocks.

### 2.2 Mandatory Worker & Generation Fencing on Outbox Acks (`outbox.repository.ts`)
- **Changed Signatures:**
  - `markDelivered(notificationId: string, workerId: string, claimGeneration: number): Promise<boolean>`
  - `markFailed(notificationId: string, error: string, workerId: string, claimGeneration: number): Promise<boolean>`
- **Behavior Change:** `workerId` and `claimGeneration` are now required parameters (at both compile-time and runtime). Omitting them or passing empty strings/non-numbers throws an error.
- **Query Filter:** The database update query strictly filters by `{ notificationId, dispatchOwner: workerId, claimGeneration, status: 'CLAIMED', $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] } }`. Stale workers match 0 documents and return `false`.

### 2.3 Elimination of Default Worker in Consumer Deduplication (`outbox.service.ts`)
- **Changed Method:**
  - `deduplicateConsumerEvent(...)`
- **Behavior Change:** Omission of `workerId` no longer falls back to `'default-worker'`. An explicit, non-empty `workerId` is strictly required.

### 2.4 Destination Adapter & Delivery Semantics Framework (`outbox.service.ts`)
- **New Types:**
  - `ConsumerEventContext<TPayload>`
  - `DestinationAdapter<TResult, TPayload>`
- **Behavior Change:** `processConsumerEvent` accepts either a `DestinationAdapter` or callback. If `adapter.supportsIdempotency === true`, delivery semantics are resolved as `'idempotent_destination'`. Otherwise, semantics are resolved as `'at_least_once_risk'`.

### 2.5 Test Database Lifecycle States & Re-Entry Elimination (`guard.ts`)
- **New Types:**
  - `TestDatabaseLifecycleState = 'OWNED' | 'CLEANUP_LOCKED' | 'CLEANED'`
- **Behavior Change:** `claimTestDatabaseOwnership` blocks re-entry into any database where `cleanupInProgress === true` or lifecycle state is `CLEANUP_LOCKED` or `CLEANED`, even if requested by the same `runId` and `workerId`.

---

## 3. Migration Guide for Engineers

### 3.1 Updating Outbox Callers
```typescript
// Legacy / V3.1 Call:
await outboxRepository.markDelivered(notificationId);

// V3.2 Call:
await outboxRepository.markDelivered(notificationId, workerId, claimGeneration);
```

### 3.2 Updating Transaction Session Error Handlers
```typescript
// Legacy / V3.1 Pattern:
try {
  await renewOperationLease(opId, decisionId, workerId, 30000, session);
} finally {
  await session.abortTransaction(); // Could throw if already aborted
}

// V3.2 Recommended Pattern:
try {
  await renewOperationLease(opId, decisionId, workerId, 30000, session);
} finally {
  if (session.inTransaction()) {
    await session.abortTransaction();
  }
}
```

### 3.3 Implementing Destination Adapters
```typescript
const webhookAdapter: DestinationAdapter<{ status: number }, WebhookPayload> = {
  destinationName: 'StripePaymentWebhook',
  supportsIdempotency: true, // Destination supports Stripe-Idempotency-Key
  deliver: async (context) => {
    return await sendWebhook({
      url: 'https://api.stripe.com/v1/...',
      idempotencyKey: context.idempotencyKey,
      data: context.payload,
    });
  },
};

const result = await outboxService.processConsumerEvent(
  consumerId,
  notificationId,
  workerId,
  webhookAdapter
);
// result.deliverySemantics === 'idempotent_destination'
```

---

## 4. Verification & Testing

All changes have been validated against the full Decision OS monorepo test suite:
- Total API & Concurrency Tests Passed: 148
- Web Frontend Tests Passed: 166
- Decision Engine Golden Tests Passed: 10 (G1–G10 byte-for-byte intact)
- TypeScript Diagnostics: 0 errors
- Linter Diagnostics: 0 warnings, 0 errors
- Turbo Build: 3/3 packages built successfully
