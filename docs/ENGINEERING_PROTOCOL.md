# Engineering Protocol

## Verify gate sequencing

### Before Phase 1
The current repository does not yet possess the root `npm run verify` script. It is verified using currently available commands:
  - `npm test`
  - `npm run lint`
  - `npm run build`
Note: The known pre-existing lint warning in `src/components/MonteCarloTester.tsx` may remain unless explicitly addressed. Do not claim `npm run verify` was executed before it exists.

### During Phase 1
Phase 1 must establish the repository-level verification gate:
  `npm run verify`
with the required checks defined by the Phase 1 specification:
  1. typecheck (`tsc --noEmit`)
  2. lint
  3. unit + integration tests
  4. production build
Exit code must be 0 across all workspaces. If a workspace has no lint/test yet, add a minimal real one; do not stub.

### After the verify gate exists (Phase 1+)
Every relevant Phase 1+ checkpoint and commit must execute and pass `npm run verify` (exit code 0).

## Branching and tags
- Start of phase: `git switch -c phase-N-<slug>` from the latest main (or the previous
  phase's merged state). Confirm clean working tree first.
- End of phase (after user approval only): the USER merges. The agent only creates the tag
  `phase-N-complete` on the final verified commit when told to.

## Commit cadence
Commit whenever one logical unit is complete and the verification gate is green. Typical units:
  1. plan document
  2. test scaffolding / failing tests (allowed red ONLY as `test:` commit with note)
  3. each module or endpoint with its tests
  4. each refactor (separate from behavior changes)
  5. documentation updates
  6. final report file
Rules: ≤ ~400 changed lines per commit where practical; never mix refactor and feature;
never commit generated artifacts, node_modules, .env, build output.

## Commit message format (Conventional Commits)
  type(scope): imperative summary (≤ 72 chars)

  Why: one or two lines of reason
  Verified: verification gate green (or the exact command run)

Types: feat, fix, test, refactor, docs, chore, build, ci, wip.
Examples:
  feat(engine): add weight normalization with validation
  test(api): cover analyze rejecting client-supplied winner
  chore(repo): add verify script and .githooks pre-commit

## Hooks (no new dependency)
`.githooks/pre-commit` runs typecheck + lint on the repo. Enable with
`git config core.hooksPath .githooks`. Full verification gate runs before commits.

## Safety
- Run `git status`, `git branch --show-current`, `git log --oneline -10` before touching anything.
- Unknown uncommitted changes → STOP and report. Do not stash, reset or overwrite.
- Secrets: `.env` is gitignored; `.env.example` lists variables with no real values.
  Before each commit, check `git diff --cached` for keys, tokens, connection strings.

## Evidence rule for reports
For every acceptance criterion: the exact command, and the last ~15 lines of real output
(or the specific test names that passed). "Looks correct" is not evidence.

## Adversarial review (mandatory before the report)
After implementation, re-read your own diff (`git diff main...HEAD`) as a hostile reviewer:
  - What input would break this? (empty, huge, negative, NaN, duplicate IDs, unicode)
  - What happens on failure paths (DB down, bad JSON, timeout)?
  - Any duplicated math, leaked secret, missing authorization check, silent catch?
  - Any claim in the docs the code does not actually satisfy?
Fix findings, add tests for them, re-run verification gate. List what you found in the report.
