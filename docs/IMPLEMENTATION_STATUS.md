# Decision OS — Implementation Status

Last updated: 2026-11-16
Branch: `main` (fast-forwarded from `fix/batch4-replica-set-transactional-recovery`; `production-readiness-audit` was identical to the previous `main`)

This file records what has been **run and observed**, not what documents claim.
Historical phase reports in `docs/phases/` and the root `BATCH_*` / `FINAL_*`
reports describe earlier snapshots; treat their "complete" labels as claims.

## Verification gate (2026-11-16)

`npm run verify` (typecheck, lint, test, build across `apps/web`, `apps/api`,
`packages/decision-engine`) was run on this branch with real MongoDB:

| Item | Result |
| :--- | :--- |
| Typecheck | 0 errors (api, web, engine) |
| Lint (oxlint) | 0 errors; pre-existing React effect/memoization warnings remain |
| Engine tests | 98/98 passed (12 files) |
| API tests | 802/802 passed (67 files), real replica set + real standalone |
| Web tests | 284/284 passed (29 files) |
| Build | all workspaces built |

### Test database topology

The API suites need a real replica set **and** a real standalone server.
Several suites default to standalone on `127.0.0.1:27017` and a replica set on
`127.0.0.1:27018`. If `27017` is a replica-set member on your machine (as in
`docker-compose.yml`), point the suites elsewhere:

```bash
docker run -d --name dos-rs-test -p 127.0.0.1:27018:27018 mongo:8.0 mongod --replSet rs0 --bind_ip_all --port 27018
docker exec dos-rs-test mongosh --port 27018 --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27018'}]})"
docker run -d --name dos-standalone-test -p 127.0.0.1:27019:27017 mongo:8.0
export TEST_MONGODB_URI="mongodb://127.0.0.1:27018/decision_os_test?replicaSet=rs0&directConnection=true"
export TEST_REPLICA_SET_URI="mongodb://127.0.0.1:27018/decision_os_rs_test?replicaSet=rs0&directConnection=true"
export TEST_STANDALONE_MONGODB_HOST=127.0.0.1:27019
export TEST_STANDALONE_MONGODB_URI="mongodb://127.0.0.1:27019/decision_os_b02r6_live_test"
npm run verify
```

All test databases end in `_test`; the guard refuses anything else.

## Browser and live-API verification (2026-11-16)

Run against the dev servers (API `:3000`, web `:5173`) on a disposable replica
set, seeded with `npm run demo:reset`.

| Journey | Result |
| :--- | :--- |
| Sign in (quick-fill), session restore, sign out clears token | Pass |
| Deep link `/?decisionId=` signed in, and signed out → sign in → decision | Pass |
| Authoritative analysis (Alpha 82.0 vs Beta 78.0, lead +4.0) | Pass |
| Incomplete matrix → 422 `INCOMPLETE_SCORES` with coordinates | Pass (API) |
| Demo fill → per-cell provenance, 422 `SYNTHETIC_SCORE_BLOCKED`, forged provenance wipe ignored | Pass (API) |
| Replace 2 of 3 synthetic cells, save; replace last → authoritative result | Pass (browser) |
| Realtime stream connects once and stays connected ("Live Sync") | Pass |
| Invite → accept → contribute → stale adopt 409 → adopt → audit verify → revoke (25 checks) | Pass (API, 3 demo accounts) |
| Export Center JSON / CSV / HTML downloads | Pass (browser) |
| AI Analyst (mock provider) loads ranked advisory output | Pass |
| Header layout at 375–1440 px, signed in and out | Pass |

## Fixed on 2026-11-16

See `git log` for details; each fix has a regression test where testable.

- Demo seed: decision had no owner (invisible to everyone); cleanup could delete a real user's decision by title; seeded audit chain failed verification.
- Realtime: SSE responses lacked CORS headers (stream never connected); client reconnected on every event (429 storm); own saves reported as "concurrent updates"; JWTs from `?token=` were written to request logs.
- Security: any user could quarantine any decision via `reconcile-audit`; calibration profiles leaked forecasts from unreadable decisions; login/register had no dedicated rate limit; audit ledger could be rewritten via `save()`, `replaceOne`, `findOneAndReplace` or `bulkWrite`; production CORS implicitly trusted localhost.
- Synthetic-score guard bypasses: expert adoption, decision analytics and the recovery worker produced authoritative results with synthetic cells.
- Exports: always titled "authoritative"; no cell provenance; adopted/rejected contributions dropped; contributor/actor emails shown to viewers; negative margins turned into text in CSV.
- Web: deep links ignored; multi-cell synthetic replacement always hit 409; clipboard buttons reported success on failure; AI Analyst never sent its request; error banners lost server coordinates and 409 versions; hard-coded "75.0" synthetic labels; icon buttons without accessible names; header overflow on tablet/phone widths; export download lacked timeout/401 handling.

## Known gaps (not yet implemented)

| Area | Gap |
| :--- | :--- |
| F15 MDAR | Implemented formula is `0.35·Relevance + 0.25·Evidence + 0.25·Sensitivity + 0.15·Confidence − penalties`, not the specified `0.40·Impact + 0.25·Feasibility + 0.20·Evidence + 0.15·Alignment`; tie-break differs; Confidence comes from the LLM. Needs a product decision (spec conflict). |
| F16 Evidence | No evidence types (`user_assumption`, `expert_claim`, …) and no verification state; exports mark every item `unverified_citation`. |
| F14 AI | Only the winner name is checked against engine output (no number verification); disagreement explanations fall back to canned text without retry. With no API key the mock provider returns canned, decision-unrelated text. |
| F13 Calibration | Metrics are computed and shown for 1 ≤ N < 3 samples with only a warning. |
| F12 Deliberation | API supports cell/criterion/option anchors, UI always posts decision-level comments; comment list unbounded. |
| F17 Audit | `actorName` / `actorEmail` are not covered by the event hash; landing-page tamper demo is a UI animation, not an isolated ledger. |
| F08 RBAC | Legacy decisions without `ownerId` are readable by every authenticated user (migration needs approval); comment/evidence edit checks only `read`; Viewers can trigger paid AI calls; `/health/diagnostics` is public. |
| F09 | Concurrent duplicate invitations return 500 (E11000) instead of 409; invitation revoke/decline are not audited. |
| Operations | `/health` does not report DB status (`/health/ready` does); several list endpoints are unpaginated. |
| Topology | API startup requires a replica set (`assertReplicaSetSupported`), so the documented standalone mode cannot run the server. |
