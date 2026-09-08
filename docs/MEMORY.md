# Project memory

Running record of what exists in this repo and why. One entry per feature branch merged
into `dev`. A fresh Claude Code session should be able to read this file plus `CLAUDE.md`
and know the state of the system without re-reading the codebase.

**Rule: append an entry here before opening any merge into `dev`.** Newest at the bottom.

## Format

```markdown
### YYYY-MM-DD - feat/branch-name

**What.** One or two sentences on what now exists that did not before.

**Why.** The reason, or a pointer to the decision log entry (D-0NN).

**Files.** The files added or meaningfully changed, with the reason for each.

**Now true.** What a future session needs to know about the system as a result. Contracts,
invariants, gotchas. This is the part that matters most.

**Open.** Anything left unfinished or deliberately deferred.
```

---

### YYYY-MM-DD - chore/bootstrap

**What.** Repository scaffolding: monorepo layout, Claude Code configuration, agents,
skills, docs, git hooks, and the seeded decision log.

**Why.** Set the working rules before writing code, so the decision log and the memory file
are byproducts of the work rather than something reconstructed at the end.

**Files.**

- `CLAUDE.md`: project context, git workflow, the ten non-negotiable design rules
- `.claude/settings.json`: commit attribution off, guard rails on git and npm commands
- `.claude/agents/`: spoof-adversary, schema-reviewer, test-fixture-writer
- `.claude/skills/`: decision-log, geo-fixtures
- `.githooks/commit-msg`: strips AI attribution trailers, enforced rather than requested
- `docs/DECISIONS.md`: D-001 through D-005, the pre-code stack and model decisions
- `docs/AI-NOTES.md`: empty template for recorded overrides
- `README.md`, `.env.example`, `.gitignore`, `docker-compose.yml`

**Now true.**

- Branches: `main` protected, `dev` integration, `feat/*` and `fix/*` from `dev`.
- Commit bodies must list changed files with a reason for each.
- `git config core.hooksPath .githooks` must be run once per clone or the attribution hook
  is inert.
- The verification engine at `apps/api/src/verification/` is pure by contract. No Mongoose,
  no I/O. This is load bearing for the test strategy.

**Open.** No application code yet. First slice is `feat/session-state-machine`.

---

### 2026-09-07 - feat/scaffold

**What.** The monorepo now builds, tests and boots. npm workspaces across `apps/api`,
`apps/web` and `packages/shared`; a health endpoint that reports real Mongo connectivity; and
demo authentication with real, tested authorization boundaries. The stack was modernised to
current majors and every pairing was verified against the registry before installing.

**Why.** D-006 (TypeScript pin), D-007 (ESM), D-008 (demo auth). `docs/REQUIREMENTS.md` holds
the full dependency list with a reason per package and the compatibility matrix.

**Files.**

- `package.json`, `tsconfig.base.json`, `tsconfig.json`: workspace root and TypeScript project
  references, so `tsc --build` walks the dependency graph instead of three disconnected configs
- `packages/shared/src/index.ts`: `Verdict`, `Signal`, `Presence`, `SessionState`, `Role`,
  `AuthUser`. Rule 1 encoded in the types — no boolean, `Signal.reason` non-optional
- `apps/api/src/main.ts`: global `ValidationPipe` with `forbidNonWhitelisted` so rule 2 is
  enforced from the first endpoint rather than retrofitted
- `apps/api/src/health/health.controller.ts`: liveness plus Mongo readyState, `@Public()`
- `apps/api/src/auth/*`: demo users, HMAC token service, deny-by-default `AuthGuard`,
  `RolesGuard`, `@Roles()` / `@Public()` / `@CurrentUser()`, and 12 boundary tests
- `apps/web/`: Vite + React 19 + MUI v9 shell wired to the existing `theme.ts`
- `jest.config.js`, `jest.resolver.cjs`: ESM Jest. The custom resolver exists because a blanket
  `.js` -> `.ts` `moduleNameMapper` also rewrites requests from inside `node_modules` and breaks
  packages shipping real `.js`/`.mjs`
- `docker-compose.yml`: `mongo:7` -> `mongo:8`, to match the 8.2.6 binary the test suite pulls
- `docs/REQUIREMENTS.md`, `docs/DECISIONS.md`, `README.md`, `CLAUDE.md`: stack versions, demo
  credentials, D-006 through D-008

**Now true.** The things a future session will otherwise rediscover the hard way:

1. **`apps/api` and `packages/shared` are ESM.** NestJS 12 ships no CommonJS entry point, so
   this was forced, not chosen. Every relative import needs an explicit `.js` extension.
2. **Named imports from CommonJS dependencies compile and then throw at runtime.**
   `import { Connection } from 'mongoose'` type-checks and dies with "does not provide an export
   named 'Connection'". Use `import type` for types, default-import-plus-property-access for
   runtime values. Mongoose and rxjs are both CJS. This cost a debugging cycle already.
3. **TypeScript is pinned at 6.0.3 and cannot go to 7** until `ts-jest` widens its peer range.
4. **Jest runs through `node --experimental-vm-modules node_modules/jest/bin/jest.js`**, invoked
   directly rather than via `NODE_OPTIONS`, so it works on PowerShell, cmd and sh alike.
5. **Auth is deny-by-default.** A new controller is protected unless it opts out with
   `@Public()`. Add `@Roles()` for role restrictions; the boundary tests will catch omissions.
6. **Demo credentials are `admin`, `business`, `user1`..`user10`, password `demo1234`.**
7. Verified working: `tsc --build` exit 0, `npm test` 17 passed, `nest build` and `vite build`
   exit 0, and the API boots against a real MongoDB returning
   `{"status":"ok","mongo":"up"}`.

**Open.**

- **Compose is unrunnable**: `apps/api/Dockerfile` and `apps/web/Dockerfile` do not exist, and
  the Docker daemon was not running on this machine, so nothing was verified against it.
- **Rule 9's transactional submit will fail locally.** The `mongo` container is standalone;
  Mongo requires a replica set for multi-document transactions. Fine on Atlas, broken in compose.
- **Node 24.14.1 is just below what two transitive dev packages want** (`@angular-devkit/*` via
  `@nestjs/schematics` want `^24.15.0`). Warnings only, but bump when convenient.
- Nest boot showed a ~17s gap before route resolution on Windows. Not diagnosed. Watch it during
  `feat/participant-flow`; if it affects `nest start --watch` the dev loop will hurt.
- `theme.ts` still carries placeholder brand values. Time-box the extraction to 20 minutes.

---

### 2026-09-07 - feat/session-state-machine

**What.** The pure session state machine, its transition allowlist, and the reaper timer
rules. No HTTP, no persistence, no scheduler yet.

**Why.** First of the two branches where being wrong is expensive and silent. It is also the
spec for two collections that `feat/data-model` will write, which is why it now comes before
that branch rather than after.

**Files.**

- `apps/api/src/session/state-machine.ts`: `transition`, `canTransition`, `allowedEvents`,
  `isTerminal`, `dueEvent`. One type-only import from `@msp/shared` and nothing else
- `apps/api/src/session/state-machine.spec.ts`: 93 tests, including the full state x event
  product enumerated rather than sampled

**Now true.**

1. **Seven legal transitions, and only seven.** `pending -> active` (start),
   `pending -> abandoned`, `active -> ended` (end), `active -> abandoned`,
   `active -> expired`, `ended -> submitted` (submit), `ended -> abandoned`.
2. **`submitted`, `abandoned` and `expired` are terminal.** Nothing leaves them. This is what
   keeps rule 8 (append-only verification results) true — a verdict cannot be reopened by a
   later state change.
3. **`ended -> expired` deliberately does not exist.** The hard cap bounds how long we
   *track* someone; once ended we are not tracking, so an unsubmitted report is `abandon`.
   Having both would make two timers race for the same document.
4. **No self-transitions.** Double-tapping "end visit" on a flaky connection is a 409, not a
   silent no-op. Rule 5.
5. **`transition` never no-ops.** It returns `{ok:false, code:'ILLEGAL_TRANSITION', from,
   event, allowed, reason}`. The HTTP layer maps that to 409 and the body already carries
   both the current state and the events that *would* have been legal.
6. **The module is pure.** No `Date.now()`, no Mongoose, no Nest, no `process.env`, no
   randomness. `dueEvent` takes `now` as an argument, which is why the timer tests need no
   fake timers.
7. **`dueEvent` prefers `expire` over `abandon`** when both have fired, because "tracked for
   the maximum time" is a more accurate thing to tell a participant than "you went quiet".
   Pending sessions are measured from `createdAt`, not `lastSeenAt`.
8. **The reaper must still route its result through `transition`.** `dueEvent` only suggests;
   it does not authorise. A test asserts every event a timer can produce is legal in the
   state that produced it.

**Open.**

- The `sessionEvent` collection is **not** in this branch. It is a schema, so it belongs to
  `feat/data-model`, which now follows this branch. The shape it needs is
  `(sessionId, from, event, to, at)` — exactly what `TransitionResult` carries on success.
- No scheduler wiring. `@nestjs/schedule` is installed but nothing calls `dueEvent` yet, and
  the open question about whether an in-process cron survives a free-tier spin-down
  (`docs/REQUIREMENTS.md` §5) is still unanswered.

---

### 2026-09-07 - feat/verification-engine

**What.** The pure verification engine: nine signals, weighted scoring from a neutral base,
verdict banding, rollups, and 15 fixture traces. Plus the canonical haversine and presence
rule. The most important branch in the project.

**Why.** D-001 (score not boolean), D-009 (how signals combine, and why the weights are a
prior rather than a fit).

**Files.**

- `apps/api/src/geo/haversine.ts`: the ONE distance implementation, plus the presence rule
  and the 100 m accuracy cap
- `apps/api/src/verification/types.ts`: the evidence contract. Also the spec `feat/ping-ingest`
  must satisfy — every field is server-computed or explicitly labelled untrusted
- `apps/api/src/verification/rollups.ts`: dwell, coverage, min distance, median accuracy
- `apps/api/src/verification/signals.ts`: the nine signals and their weights
- `apps/api/src/verification/engine.ts`: base score, summation, banding
- `apps/api/test/fixtures/`: `trace-builder.ts` (seeded, deterministic) and `scenarios.ts`
  (15 named traces)
- `apps/api/tsconfig.spec.json`: editor/typecheck config for tests, so specs are covered
  without polluting the build output

**Now true.**

1. **Base score is 50, not 0.** Zero would make "no evidence" identical to "proven absent",
   which contradicts D-005. A visit we learned nothing about lands in `needs_review`.
2. **Positives are capped so a perfect honest trace scores 90, not 100.** The first cut let
   positives sum to +72 over the base, so everything clamped at 100 and the clamp silently ate
   every penalty — a 9.6 km teleport still auto-verified at 92. **In an additive model the
   ceiling is a weight.** Do not add a positive signal without re-checking the headroom.
3. **Signals must not restate one another.** `presenceDwell` and `coverage` now return null
   when `minDistanceM` is null, because `noUsableEvidence` has already said it. Check any new
   signal for this.
4. **Dwell intervals are capped** at one sampling window (3x the expected interval). Without
   that cap two typed coordinates five minutes apart bought 300 s of dwell from two observed
   instants and auto-verified at 78, outranking the honest visit it imitated. D-010.
5. **`sophisticatedSpoof` auto-verifies at 94, and that is pinned by a test on purpose.** A
   forgery that jitters coordinates, varies accuracy and fakes an approach is indistinguishable
   from an honest visit from a browser. D-001 says we do not claim to prove presence; this is
   what that costs. Making it fail would punish honest visits identically.
6. **Every signal is verdict-decisive.** A test removes each signal in turn and re-scores all
   15 fixtures; if a band never moves, that signal is decoration and the test fails by name.
   Three fixtures (`sparseButHonest`, `constantAccuracy`, `noApproachNoDeparture`) exist
   purely to give the weaker signals a margin where they decide something.
7. **Dwell is integrated over intervals between fixes, not counted per fix**, so a spoofer
   cannot buy dwell time by sampling faster.
8. **The engine is pure**: no Mongoose, no Nest, no `Date.now()`, no `process.env`, no
   randomness. All time arrives inside the evidence object.
9. **The geo-fixtures skill had a wrong reference distance** (said 9.6 km, actual 10.62 km).
   Corrected in the skill and recorded in `docs/AI-NOTES.md`.

**Open.**

- `spoof-adversary` has been run and its findings folded in; see D-010. Two are accepted
  rather than fixed: the decorative-signal gate is partly circular (fixtures were written to
  make weak signals decisive), and there is still no server-side network signal (IP region,
  ASN, mid-session ASN change) anywhere in the evidence contract. That last one is the
  strongest evidence a browser cannot forge, and the best candidate for the next slice.
- **Seven constraints are handed forward to `feat/ping-ingest` in D-010.** The critical one:
  `receivedAt` must be stamped per fix, never per batch. `batchFlushedHonestVisit` is that
  requirement written as a failing-if-you-get-it-wrong test.
- Thresholds and weights are a prior, not a fit. D-009 says what would make them principled.
- No persistence and no outbox yet; `evaluate()` is called by nothing. That is
  `feat/report-and-outbox`.

---

### 2026-09-07 - feat/data-model

**What.** Every Mongoose schema and index, the boot-time TTL reconciliation, and an
idempotent seed. Verified against a real MongoDB replica set in tests and against the live
Atlas M0 cluster.

**Why.** D-011 (no 2dsphere), plus the schema-level half of D-010's seven constraints.

**Files.**

- `apps/api/src/db/schemas/org-venue.schema.ts`: ClientOrg (the tenancy boundary), GeoPoint,
  Venue with a per-venue geofence
- `apps/api/src/db/schemas/task-session.schema.ts`: Task, Assignment, Session, SessionEventDoc
- `apps/api/src/db/schemas/ping.schema.ts`: the hot, sensitive collection. Idempotency index,
  evaluator read index, TTL index
- `apps/api/src/db/schemas/report-verification.schema.ts`: Report, OutboxEntry,
  VerificationResultDoc, ReviewAction
- `apps/api/src/db/indexes.ts`: `syncPingTtlIndex`, the collMod reconciliation
- `apps/api/src/db/db.module.ts`: model registration, runs the TTL sync on boot
- `apps/api/src/db/seed.ts`: idempotent, one org, two Kuwait venues, 10 assignments
- `apps/api/src/db/schemas.spec.ts`: 21 tests against a real replica set

**Now true.**

1. **`PING_RETENTION_DAYS` is finally honest.** Mongo fixes `expireAfterSeconds` at index
   CREATION and re-declaring it in Mongoose silently no-ops, so the env var previously worked
   exactly once, on a database that had never seen a ping. `syncPingTtlIndex` reconciles it
   with `collMod` on every boot and logs loudly when a retention window moves. It refuses to
   start on a non-positive value rather than defaulting to keeping traces forever.
2. **Tests run against `MongoMemoryReplSet`, not a standalone.** Rule 9 needs transactions and
   Mongo refuses them outside a replica set. Both commit and rollback are asserted.
3. **Schema-level bounds, not just DTO bounds**: `venue.radiusM` is 25..500 (an unbounded
   radius auto-verifies the city, D-010), `accuracyM` has `min: 0.1` (a zero accuracy sails
   through the presence rule), lat/lng are range-checked.
4. **Uniqueness is enforced by the database**: `(sessionId, clientPingId)`, one session per
   assignment, one report per session, one assignment per (task, participant).
5. **Idempotent ping upsert must use `$setOnInsert`, not `$set`** — asserted by a test. With
   `$set` a client could resend a stored `clientPingId` with different coordinates and move a
   fix after the fact.
6. **No 2dsphere index** (D-011). Storage is proper GeoJSON `[lng, lat]`, so adding one later
   is a single line, but nothing queries it today.
7. **Two bugs the tests caught before deployment would have**: `collection.indexes()` throws
   NamespaceNotFound on a database where `pings` does not exist yet, which would have crashed
   the API on its first boot against a fresh Atlas cluster and after every
   `docker compose down -v`; and `@Prop({ index: true })` on `receivedAt` created a plain
   `receivedAt_1` index that collided with the named TTL index on the same key.
8. **The TTL index has exactly ONE owner** (D-012). It is created only by `syncPingTtlIndex`;
   `PingSchema` exports its name and nothing else. Declaring it in both places made the
   effective retention window depend on a race between autoIndex and the boot reconcile.
   Do not re-add an index declaration to the schema.
9. **Append-only is enforced, not documented.** `verificationResults` and `sessionEvents`
   throw on updateOne/deleteOne/etc. via a pre-hook.
10. **Verified live on Atlas M0**: seed runs twice with identical counts, the app creates every
   index on boot, and `collMod` successfully narrowed and widened the retention window -- the
   shared tier does not block it.

**Open.**

- `schema-reviewer` has been run and its findings folded in; see D-012. The redundant
  prefix indexes are gone.
- **The outbox has no lease.** A worker that dies mid-row leaves `status: processing`
  forever, so that visit is never verified and never retried -- silently. Rule 9 promises
  retry for a FAILED attempt, not a LOST one. Belongs to `feat/report-and-outbox`, and it
  needs a reclaim index on `{status, lastAttemptAt}` that does not exist yet.
- **Venue config is read live at evaluation time, not snapshotted onto the session.** An
  admin editing `radiusM` between a visit and its evaluation mixes two vintages of venue
  config into one verdict, which can make `proximity` contradict `presence` again in exactly
  the way D-010 item 5 fixed. The snapshot belongs on `Session`, one copy per visit.
- The console list still needs a per-row join for the verdict. Denormalising
  `latestVerdict`/`latestScore`/`latestResultId` onto `Session` when the evaluator writes
  would collapse it to one indexed query and does not violate rule 8 -- the result stays
  append-only, the session carries a pointer. That is also what the SSE payload wants.
- `autoIndex` is on by default, so index builds run on every boot. Fine at this size, wrong
  for a large collection; revisit before anything resembling production traffic.

---

### 2026-09-07 - feat/ping-ingest

**What.** The batch ping endpoint. Closes Batch 1: the spine is complete and the pieces
connect — a fix posted here produces exactly the evidence shape the verification engine
consumes.

**Why.** Every line of this branch traces to a constraint handed forward by D-010
(spoof-adversary) or D-012 (schema-reviewer). It is the first branch built against a written
attack list rather than a feature description.

**Files.**

- `apps/api/src/pings/dto/create-ping.dto.ts`: the whole of rule 2 in one place. Only four
  client-owned fields exist; anything else is a 400 naming the field
- `apps/api/src/pings/pings.service.ts`: ingest. Per-fix server clock, device-clock bounds,
  first-write-wins upsert, one atomic budget-and-state update
- `apps/api/src/pings/pings.controller.ts`: `POST /sessions/:sessionId/pings`, participant-only
- `apps/api/src/pings/pings.spec.ts`: 32 tests against a real replica set, one describe block
  per documented constraint

**Now true.**

1. **`receivedAt` is stamped per fix, inside the loop.** A batch-level stamp would collapse
   `coverageRatio`, zero `dwellSeconds`, and silently disable the engine's teleport check for
   the whole batch. A test asserts distinct, monotonic timestamps within one batch.
2. **Server computes `distanceM` and `presence`; the DTO REJECTS them.** Posting `distanceM`
   returns 400 `property distanceM should not exist` — it is not stripped and 201'd (rule 2).
3. **Idempotent, first-write-wins.** `$setOnInsert` on `(sessionId, clientPingId)`. A re-flush
   reports `accepted: 0, duplicates: n` and **cannot rewrite a stored fix's coordinates**.
4. **The budget is not burned by duplicates.** `$inc` uses `upsertedCount`, never batch length,
   or rule 4's safety guarantee becomes a slow leak.
5. **Budget, state re-check and `lastSeenAt` are ONE atomic conditional update.** A
   read-then-check would be a TOCTOU across two concurrent offline flushes — exactly the
   scenario rule 4 exists for.
6. **Fixes are accepted only while `active`**, returning 409 with the current state and the
   legal events. This closes the flush-after-end hole: the state machine allows
   `ended -> submit`, so without it a participant could end the visit then flush a forged queue.
7. **`accuracyM` must be positive and is never rounded.** Zero accuracy grants a free geofence;
   rounding trips the engine's `distinct === 1` spoof branch on honest Android traces.
8. **`capturedAt` is bounded to the session window ±6 h.** Out-of-window fixes are dropped and
   counted, not fatal — one bad clock reading must not reject nineteen good fixes.
9. **Authorization**: participants only, own session only. An admin posting fixes is 403 —
   there is no legitimate reason for an admin to author location evidence.
10. **Verified live on Atlas**: 3 accepted, re-flush 3 duplicates, 3 distinct `receivedAt`,
    accuracy stored as sent, client `distanceM` refused by name.

**Open.**

- Nothing calls `evaluate()` yet. Ingest produces the trace; the outbox and evaluator that
  turn it into a verdict are `feat/report-and-outbox`.
- The venue config is still read live rather than snapshotted onto the session (D-012), so a
  radius edit between visit and evaluation still mixes vintages.
- No rate limit beyond the per-session budget. A participant can post 20 fixes as fast as the
  network allows; the cap bounds total volume, not rate.

---

### 2026-09-07 - feat/report-and-outbox

**What.** The visit lifecycle over HTTP, transactional report submission, and the evaluator.
**The system produces verdicts for the first time** — until this branch nothing called
`evaluate()`. Also closes both D-012 open items.

**Why.** Rule 9 (decoupled submit and verification), rule 8 (append-only results), and the two
outstanding findings from the schema review.

**Files.**

- `apps/api/src/session/sessions.service.ts`: `apply()` — the single funnel every state change
  goes through, including the reaper's when it exists. Start takes the venue snapshot
- `apps/api/src/session/sessions.controller.ts`: `GET/POST /sessions/:id`, `/start`, `/end`
- `apps/api/src/reports/reports.service.ts`: the rule 9 transaction
- `apps/api/src/reports/reports.controller.ts`, `dto/create-report.dto.ts`
- `apps/api/src/verification/evaluator.service.ts`: outbox consumer with a lease, the ONLY
  bridge between the database and the pure engine
- `apps/api/src/db/schemas/task-session.schema.ts`: `VenueSnapshot`, `latestVerdict`/
  `latestScore`/`latestResultId`
- `apps/api/src/db/schemas/report-verification.schema.ts`: the `{status, lastAttemptAt}`
  reclaim index
- `apps/api/src/reports/visit-lifecycle.spec.ts`: 21 tests covering the whole loop

**Now true.**

1. **There is exactly one way to change session state**: `SessionsService.apply()`. It asks the
   pure state machine, applies the update with **the current state in the filter** (a
   compare-and-swap, so two concurrent requests cannot both win), and writes an append-only
   `sessionEvent`. Do not add a second path.
2. **The state transition happens FIRST inside the submit transaction.** With the report
   written first, a second submit hit the unique index on `reports.sessionId` and surfaced as
   a **500 duplicate-key error before the state machine was consulted** — rule 5 requires a
   409 carrying the current state. The unique index is now the last line of defence, not the
   first. Found by the tests.
3. **Submit is one transaction**: state change + event + report + outbox row, or none of it.
   Asserted both ways, including rollback. Needs a replica set.
4. **The evaluator leases outbox rows** (`LEASE_SECONDS = 120`). A worker that dies mid-row is
   reclaimed rather than leaving that visit unverified forever. Claim is atomic; two workers
   racing means one gets the row and the other finds nothing. Closes a D-012 finding.
5. **The evaluator reads the VENUE SNAPSHOT, never the live venue.** An admin widening
   `radiusM` after a visit no longer changes how that visit is judged. Closes the other D-012
   finding, and there is a test that edits the venue mid-visit and asserts the reason string
   still says 75 m.
6. **`latestVerdict`/`latestScore`/`latestResultId` are denormalised onto the session** by the
   evaluator. Rule 8 is intact — the result is still append-only, the session just points at
   the newest one. This is what the console list and the SSE payload will read.
7. **Backoff and a give-up point**: failed rows retry with exponential backoff to
   `MAX_ATTEMPTS = 5`, then land in `failed` rather than spinning the queue.
8. **Verified live on Atlas**: start → 8 pings → end → submit → drain → a stored verdict with
   signals and reasons, and `session.latestVerdict` matching the result document.

**Open.**

- **No reaper.** `dueEvent()` exists and `apply()` exists, but nothing calls them on a
  schedule, so `abandoned` and `expired` are unreachable in practice. Blocked on the D-003
  question the README raises: an in-process `@nestjs/schedule` cron does not run while a
  free-tier service is asleep, and `SESSION_ABANDON_AFTER_SECONDS` is 900 — exactly the idle
  window. Lazy-on-read reaping inside `SessionsService.view()` is the cheap deterministic
  answer and is not built yet.
- No SSE. The console cannot see any of this yet; that is `feat/business-console`.
- The evaluator is only driven by an explicit `drain()` call. Nothing invokes it on a timer or
  after submit, so today a verdict appears only when something asks. Wiring that up belongs
  with the SSE work, since they share the same trigger.

---

### 2026-09-07 - feat/business-console

**What.** The business console: a live visit feed over SSE, a detail view showing the evidence
trail, a review override, and the React app that renders them. Also wires the evaluator
trigger, so a verdict now appears on its own after a submit.

**Why.** D-004 (SSE), D-013 (fan-out and the fetch-based client), rule 6 (the console never
reads pings), rule 8 (an override is a separate document, never a mutation).

**Files.**

- `apps/api/src/console/visit-events.service.ts`: in-process pub/sub with a per-org replay
  buffer
- `apps/api/src/console/console.service.ts`: every console read. **Has no Ping model injected
  at all** -- rule 6 is enforced by construction, not by discipline
- `apps/api/src/console/console.controller.ts`: list, counts, detail, review, and the SSE
  stream with its heartbeat and buffering header
- `apps/api/src/verification/evaluator.runner.ts`: the trigger. A kick after submit plus a
  periodic sweep
- `apps/web/src/hooks/useVisitStream.ts`: fetch-based SSE client with explicit `Last-Event-ID`
- `apps/web/src/pages/Console.tsx`, `Login.tsx`, `api/client.ts`, `auth/AuthContext.tsx`,
  `components/VerdictChip.tsx`
- `apps/api/src/console/console.spec.ts`: 21 tests

**Now true.**

1. **A verdict appears without anyone asking for it.** `EvaluatorRunner.kick()` fires after
   submit (fire-and-forget, outside the transaction, so a slow evaluator cannot fail a submit)
   and a 15 s sweep catches anything the kick lost. Rule 9 promised the evaluator could retry
   and be re-run; a trigger that only fires on the happy path would not have delivered that.
2. **`EventSource` is not used, deliberately** (D-013). It cannot send an `Authorization`
   header, and the alternatives were a token in the query string or cookie auth for one
   endpoint. The client reads the stream with `fetch`.
3. **`Last-Event-ID` is honoured on both sides.** Events missed during a reconnect are
   replayed from a 50-per-org buffer before live events resume.
4. **`X-Accel-Buffering: no` and a 20 s heartbeat.** Neither is observable on localhost and
   both are required for the stream to survive a free-tier proxy.
5. **Tenancy is enforced on the stream as well as the queries.** The org comes from the token;
   there is no parameter for it, and a test asserts another org's event never reaches the
   subscriber.
6. **The review queue is a filter on the feed, not a separate surface.** Same data, same code
   path, a quarter of the work. This was the trim proposed in the session-zero plan.
7. **An override writes a `reviewAction` and never touches the verification result** (rule 8),
   pinned to the specific result so it is tied to an engine version. A stated reason is
   required -- that is also the labelled data D-009 needs.
8. **The UI never says "verified".** `auto_verified` renders as "Consistent with a genuine
   visit" in a confident neutral, not a green tick, because D-001 is that the system does not
   claim to prove presence and a green tick undoes that whatever the copy says.
9. **Verified live on Atlas**: console opens the stream, a participant completes a visit, and
   the event arrives on the stream with the verdict, score and venue -- with no request from
   the console. Detail shows 6 signals with reasons; the override returns 201.

**Open.**

- **Still no reaper**, and no admin surface for creating venues, tasks or assignments -- the
  seed is the only way data appears. That is the "Tasks tab" half of what the backlog called
  the combined console.
- The participant screen is still not built, so a participant signing in is shown a message
  saying so rather than a broken page.
- SSE fan-out is single-instance (D-013). A second replica would split the consoles.
- The web bundle is 495 kB, mostly MUI. Fine for a demo, worth a code-split before anything
  resembling production.

---

### 2026-09-08 - feat/participant-flow

**What.** The participant surface: consent, bounded location capture, an offline queue, end
and report. **The end-to-end slice is now complete** — a participant runs a visit on a phone
and the console sees it appear on its own.

**Why.** D-005 (bounded capture, not continuous tracking), D-014 (the two deviations this
branch forced).

**Files.**

- `apps/api/src/session/dto/consent.dto.ts` + service/controller additions: consent, and
  `GET /sessions/mine`
- `apps/web/src/participant/useVisitTracker.ts`: geolocation, visibility, wake lock, flushing
- `apps/web/src/participant/offlineQueue.ts` + `.spec.ts`: the buffer and 9 tests
- `apps/web/src/participant/Consent.tsx`, `VisitPage.tsx`
- `apps/api/src/pings/dto/create-ping.dto.ts`: the float fix
- `apps/api/src/db/schemas/org-venue.schema.ts`, `db/seed.ts`, `auth/demo-users.ts`: the org id
- `apps/web/tsconfig.spec.json`, `jest.config.js`

**Now true.**

1. **Consent gates location capture.** `start()` returns 409 `CONSENT_REQUIRED` without it.
   Consent is recorded on the ASSIGNMENT with a server clock and a version, and re-consenting
   keeps the first timestamp.
2. **Capture stops when the page is hidden, deliberately.** Not an optimisation — a
   backgrounded tab is throttled or suspended, so releasing the watch makes the gap explicit
   instead of recording stale fixes. `coverageRatio` is what scores it.
3. **Wake Lock is opportunistic and released on hide.** It stops a fix being lost
   mid-interaction; it is NOT an instruction to hold a lit phone in a shop, which would defeat
   the premise of a mystery visit. This is the clarification D-010 demanded of D-005.
4. **Sampling is throttled to 30 s in the client.** `watchPosition` fires on movement, not on a
   timer, so a walking participant would otherwise burn `MAX_PINGS_PER_SESSION`.
5. **The offline buffer is `localStorage`, not IndexedDB** (D-014). Deviation from the backlog,
   recorded rather than done quietly. `clientPingId` is generated once at capture time, which
   is the property that actually makes a retry safe.
6. **`ClientOrg._id` is a deterministic string** shared with the demo accounts.
7. **`accuracyM` has no `maxDecimalPlaces`.** It rejected honest fixes.

**Two bugs 353 passing tests could not see.** Both lived in seams between subsystems that were
each correct alone, and both would have broken the demo:

- `@IsNumber({ maxDecimalPlaces: 6 })` rejected honest fixes, because `8.6 + 2 * 1.4` is
  `11.399999999999999` and every fixture used tidy numbers.
- The seed's org ObjectId never matched the demo accounts' literal `'org-alfa-retail'`, so the
  tenancy filter matched nothing and **the console was empty for every seeded visit.**

Found by running the real flow from `db:seed` to the screen. Written up in `docs/AI-NOTES.md`,
because the lesson generalises: a green suite says the parts agree with my assumptions, not
that they agree with each other.

**Open.**

- **Still no reaper**, so `abandoned` and `expired` remain unreachable. Blocked on the D-003
  question about an in-process cron on a sleeping free tier.
- **No admin surface.** The seed is the only way venues, tasks and assignments appear.
- **Untested on a real phone.** Everything here was exercised over HTTP; the geolocation
  permission prompt, the wake lock and iOS Safari's suspension behaviour are unverified. This
  is the largest remaining unknown and needs an HTTPS deployment to check at all.
- Nothing is deployed, and `docker compose up` still cannot work: no Dockerfiles, and the
  `mongo` container is standalone so rule 9's transaction would fail against it.

---

### 2026-09-08 - chore/dockerize

**What.** Dockerfiles for the API and web app, a rewritten compose file, `.dockerignore`, and
an nginx config for the production web target.

**Why.** `docker compose up` is a stated deliverable (CLAUDE.md §7) and could not work at all:
both Dockerfiles were missing, and three separate things in the compose file would have failed.

**Files.**

- `apps/api/Dockerfile`: four stages — deps, build, development, production. Built from the
  REPOSITORY ROOT because npm workspaces hoists to the root and `@msp/api` links `@msp/shared`
- `apps/web/Dockerfile` + `apps/web/nginx.conf`: dev target runs Vite with `--host`, prod
  target serves the static build
- `docker-compose.yml`: rewritten
- `.dockerignore`: keeps host `node_modules`, `dist` and every `.env` out of the build context
- `README.md`: docker section rewritten to match

**Now true.**

1. **Mongo runs as a single-node REPLICA SET.** Rule 9 needs multi-document transactions and
   Mongo refuses them on a standalone, so `submit` would have failed locally while working
   against Atlas. The healthcheck self-initiates the set; clients must connect with
   `?replicaSet=rs0`, and from the HOST with `?directConnection=true` because the set
   advertises `mongo:27017`.
2. **MinIO is gone.** It served `feat/evidence-upload`, which is cut and unbuilt; nothing here
   speaks S3. Keeping it meant two `:latest` images, a bucket-init container, and a healthcheck
   using `curl` — which recent minio images no longer ship, so `service_healthy` would hang
   forever and look like a broken build rather than a missing binary.
3. **A `seed` one-shot runs on every `up`.** The seed is idempotent and re-clocks the demo
   sessions, so re-running compose is the supported way to reset a stale demo.
4. **Only `src` is bind-mounted, not whole app directories**, with anonymous volumes over
   `node_modules`. Mounting the app directory would shadow the image's installed dependencies.
5. **The web image bakes `VITE_API_BASE_URL` at BUILD time.** Vite inlines env into the bundle;
   changing the API URL means rebuilding the image, which matters for deployment.

**What was actually verified, and what was not.** Be precise about this rather than claiming a
green run:

- ✅ `docker compose config` valid; **all four image targets build** (api dev, api production,
  web dev, web production).
- ✅ `docker compose up -d` reached: **mongo healthy** — so the self-initiating replica-set
  healthcheck works — then `seed` started and `api` started.
- ❌ `web` failed to bind host port 5173, which was still held by a `npm run dev:web` left
  running from an earlier session. Not a compose fault.
- ❌ **The run was never completed.** While freeing that port I killed a process on :3000 that
  turned out to be Docker's own port proxy, which took down the Docker Linux engine. It did not
  recover, so seed completion, `/health` from inside compose, a transaction against the
  containerised replica set, and the web app serving are all **UNVERIFIED**.

**Open.**

- **Re-run `docker compose up --build` from a clean clone once Docker Desktop is restarted.**
  That is the one thing standing between this and a verified deliverable.
- No production compose file or deploy target. Nothing is deployed.
- Still no reaper, no admin surface, and the participant flow is untested on a real phone.

---

### 2026-09-08 - fix/seed-venue-location

**What.** The demo venues can be relocated with `SEED_VENUE_LAT` / `SEED_VENUE_LNG`.

**Why.** The seed defaults to real Kuwait coordinates because that is the client's market. But
a geofence is 75 m wide and **whoever is testing is usually not standing in it** — from Amman
the seeded venues are 1,188 km away, so every honest visit scores `proximity -25` and
`presenceDwell -20` and is rejected. The demo becomes untestable, and it looks like the engine
is broken when it is working perfectly.

Faking a location does not help and that is the point of the system: a DevTools override emits
identical consecutive coordinates, trips `jitterFingerprint` at −45, and is also rejected.

**Files.**

- `apps/api/src/db/seed.ts`: `resolveVenues()`, venue upsert changed to `$set` the location
- `.env.example`, `README.md`: documented, with the reason
- `apps/api/src/db/review-findings.spec.ts`: 3 tests

**Now true.**

1. **Venue NAMES are stable across relocation, and that is load-bearing.** The upsert is keyed
   on `(clientOrgId, name)`. The first version renamed the venue when relocating, which created
   a SECOND venue instead of moving the first — four venues, with assignments still pointing at
   the original coordinates. Silently. The address carries the location instead.
2. **The location upsert uses `$set`, not `$setOnInsert`.** Otherwise re-seeding with new
   coordinates does nothing and the demo keeps rejecting every visit for an invisible reason.
3. **The environment is read when `seed()` RUNS, not when the module loads.** Module-scope
   `process.env` requires the caller to set variables before the import — a rule nothing
   enforces, and it silently did nothing the first time it was tried.
4. The indoor venue sits ~440 m from the outdoor one: walkable from one spot, geofences do not
   overlap. A test asserts both properties.

**Open.** This is a seed-time workaround for a missing admin surface. The real answer is
`POST /venues` and a form, so a venue can be created wherever it actually is.

---

### 2026-09-08 - fix/seed-preserves-completed-sessions

**What.** `chore/dockerize` is now **verified** — the compose stack was run to completion for
the first time, end to end, and the one bug that run surfaced is fixed: re-seeding no longer
resets sessions that have already started.

**Why.** D-015. The compose run itself was the outstanding item from the `chore/dockerize`
entry: all four images built last session but the run was never finished.

**Files.**

- `apps/api/src/db/seed.ts`: session upsert replaced with read-then-branch — create if
  missing, re-clock only if `startedAt` is null, otherwise leave alone; new log line reporting
  created/revived/preserved
- `apps/api/src/db/review-findings.spec.ts`: 3 tests — a submitted session survives a re-seed
  with its clocks and verdict, no second session is created for that assignment, and an
  `abandoned` session that HAD started is not revived
- `README.md`: the reset semantics were wrong, `down -v` is now named as the only full reset
- `docs/DECISIONS.md`: D-015

**Now true.**

1. **The compose stack is verified, not just built.** From `down -v`: mongo self-initiates the
   replica set and goes healthy on the first probe; `seed` exits 0; `GET /health` answers
   `{"status":"ok","mongo":"up"}` from the host and the api container reports `healthy`; the
   web app serves on 5173.
2. **The transaction works against the containerised single-node replica set.** A real report
   submitted (`queuedForVerification: true`), the evaluator ran, and the verdict came back
   `auto_verified` score 79. This is the thing Atlas was silently covering for.
3. **SSE was verified with a second live visit.** A console stream opened with the business
   token received `event: visit` carrying `auto_verified` score 76, interleaved with 20 s
   heartbeats, with no request from the console. `id:` is present, so the replay buffer of
   D-013 has something to replay against.
4. **`docker compose up` is no longer a demo reset. `docker compose down -v` is.** Restarting
   the stack now preserves completed visits, their reports and their verdicts.
5. **The seed says what it did**: `created=N revived=N preserved=N`. `preserved > 0` is why a
   participant may have nothing to open — not a broken seed.
6. **A participant who has submitted their one session sees an empty `/sessions/mine`.** Ten
   assignments is ten demo visits; after that `down -v` is the way to get more. Accepted cost
   of D-015, and a candidate to fix properly when the admin surface lands.
7. `/console/visits` returns a **bare array**, not `{ items: [] }`, and `/auth/login` returns
   `{ token, user }`, not `accessToken`. Cost me a false alarm; writing it down so it does not
   cost the next session one.

**The bug, because the shape of it matters.** The D-012 fix made the seed `$set`
`state: 'pending'` and both clocks on every run so the reaper could not strand demo sessions.
It was aimed at sessions that never started but was written to apply to all of them. A
`down` + `up` on a preserved volume therefore turned SUBMITTED sessions back into `pending`
while they still carried `startedAt`, `endedAt` and `pingCount: 9` — a combination the state
machine cannot produce — with reports, session events, outbox rows and verification results
still pointing at them. The console showed 2 visits before the restart and 0 after.

The disappearance was not the worst part. A resurrected session can be `start`ed again, and
the evaluator builds evidence from every ping for a `sessionId`, so the next verdict would
have been computed over a merged trace from two different visits and appended under the same
`engineVersion` (rule 8) with nothing to distinguish them.

**Same lesson as D-014, one layer out.** All 356 tests passed against this, and the
`re-seeding revives sessions the reaper abandoned` test passed *specifically because* it set
`state: 'abandoned'` without a `startedAt` — it asserted the D-012 behaviour on exactly the
input where the behaviour is correct. Nothing was wrong with that test. The bug lived between
the seed and the state machine, and only appeared when the documented start command was run
twice with data in between. Found by restarting the stack, which nobody had done.

**Open.**

- Nothing is deployed. HTTPS, and therefore the participant flow on a real phone, is still the
  largest unknown: the geolocation prompt, Wake Lock and iOS Safari suspension are unverified.
- Still no reaper. `dueEvent()` and `apply()` are tested but nothing calls them, so `abandoned`
  and `expired` are unreachable. Note that D-015's guard is written against `startedAt`, not a
  state list, so it stays correct whichever way the reaper is built.
- Still no admin surface; the seed remains the only way data enters the system.
- The api `development` image bakes `packages/shared/dist` but bind-mounts `packages/shared/src`
  over the source, so a change to shared is invisible in the container until a rebuild. Latent,
  did not bite this run.

---

### 2026-09-08 - chore/deploy

**What.** Everything needed to deploy, and the two silent blockers that would have stopped it.
A Render blueprint for both services, `PORT` support, and multi-origin CORS. **The deployment
itself is not done** — the URLs in the README are still TODO.

**Why.** D-016. Deployment is not cosmetic: `navigator.geolocation` and the Screen Wake Lock
API are both refused on an insecure origin, so the participant flow cannot run on a phone at
all until this is on HTTPS. That is still the largest unknown in the project.

**Files.**

- `apps/api/src/main.ts`: read `PORT` before `API_PORT`; CORS takes a comma-separated list
- `render.yaml`: new, both services, secrets as `sync: false`
- `README.md`: a Deploying section with the real steps, and the seeding step rewritten to
  place venues where the tester actually stands
- `.env.example`: `PORT` is the platform's, `API_PORT` is local only; `WEB_PUBLIC_URL` is a list
- `docs/DECISIONS.md`: D-016

**Now true.**

1. **`PORT` wins over `API_PORT`.** Every container platform injects `PORT` and ignores what
   the app would rather bind. This is the failure mode worth remembering: the app boots fine,
   binds 3000, and the platform's health check times out against a port nothing is on — so it
   presents as a hung deploy, not an error.
2. **CORS is a list**, comma-separated and trimmed. There is never exactly one origin: the
   deployed web app, plus localhost when developing against the deployed API.
3. **The web app is a STATIC SITE on Render, and that is load-bearing, not stylistic.** Render
   grants 750 instance-hours per month per workspace and a 31-day month is 744 — the allowance
   covers exactly ONE permanently-awake service. Static sites consume none of it, so the whole
   allowance goes to the API and the web app is always instant.
4. **The API is kept awake by an external cron on `/health`**, every 10 minutes. It must not
   point at `/robots.txt`: Render answers that itself while a service is asleep, so the ping
   never reaches the app and never wakes it. This is a dependency living outside the repo.
5. **The reaper is decided** (D-016, recorded there because the hosting is what settles it):
   **lazy-on-read, not an in-process cron.** On a tier that sleeps — or stays up only while a
   third-party pinger keeps hitting it — a cron stops silently on a missed ping, an exhausted
   allowance or a redeploy, and `SESSION_ABANDON_AFTER_SECONDS` is 900, the same order as the
   idle window. Still unbuilt; this only settles which one to build.
6. **Atlas must allow `0.0.0.0/0`.** Free Render services have no static outbound IP.
7. **Seeding happens from a workstation**, because Render's free plan has no one-off jobs.
8. **The deployed demo is seeded at the tester's own coordinates, not Kuwait** (user's call).
   `user1`-`user5` get the outdoor venue at the anchor, `user6`-`user10` the indoor one ~440 m
   north-east. Clearing `SEED_VENUE_LAT`/`LNG` and re-seeding moves them back for submission;
   they move rather than duplicate because the upsert is keyed on the venue name.

**Verified rather than assumed.** `PORT` precedence checked in a container; a two-origin
`WEB_PUBLIC_URL` with whitespace around the comma allows both and refuses a third; the static
build command from `render.yaml` runs clean and `VITE_API_BASE_URL` was grepped back out of
the built bundle to confirm Vite actually inlined it. 359 tests pass.

**Open.**

- **Nothing is deployed yet.** The blueprint has never been run, so Render's Docker build from
  the repository root, SSE through Render's proxy, and the free instance's 512 MB / 0.1 CPU
  under a Nest boot are all unverified. Fill in the README URLs once they are up.
- The participant flow on a real phone is still untested — the reason all of this exists.
- No admin surface; the seed remains the only way data enters the system.
- The reaper is decided but unbuilt, so `abandoned` and `expired` stay unreachable.

---

### 2026-09-08 - docs/deploy-tracks-main

**What.** The Render blueprint tracks `main`, not `dev`, and the docs say so.

**Why.** Asked for directly. The first blueprint attempt failed with *"Blueprint file
render.yaml not found on main branch"* — Render defaults to the repository's default branch,
which is `main`, and `main` was still at `36cd2d7` with none of this work on it. The choice
was to point Render at `dev` or to promote `dev` to `main`. Promoting won: what is live should
be a reviewed merge, not whatever was pushed to the integration branch last.

**Files.**

- `README.md`: the blueprint step now says to leave Branch on `main`, and names the
  consequence — a merge into `main` redeploys, a push to `dev` does not
- `CLAUDE.md`: §2 records that `main` is the deployed branch

**Now true.**

1. **`main` is the deploy target.** `dev` is still the integration branch and every feature
   still merges there first. The rule that `main` only receives merges from `dev` after being
   asked explicitly is unchanged — it just costs more to get wrong now, because a merge into
   `main` redeploys the live demo.
2. **`main` was promoted from `36cd2d7` to the tip of `dev`**, 28 commits, on explicit
   approval. That is the entire project to date: batches 1 and 2, the verified compose stack,
   the seed fix (D-015) and the deploy prep (D-016).

**Open.** Unchanged from the `chore/deploy` entry — nothing is deployed and verified yet. The
blueprint has still never completed a build, so Render's Docker build from the repository
root, SSE through its proxy, and a Nest boot inside 512 MB / 0.1 CPU remain unverified, and
the participant flow has still never run on a phone.

---

### 2026-09-08 - chore/allow-main-promotion

**What.** `git checkout main` and `git push origin main` moved from `deny` to `ask` in
`.claude/settings.json`. `git push --force` stays denied.

**Why.** The deny rules were written when `main` was a release marker nobody touched. Now that
Render tracks `main` (D-016), promoting `dev` to `main` is a routine repeated step, and a hard
deny meant every deploy needed the commands run by hand outside the session.

**Files.**

- `.claude/settings.json`: two rules moved from `deny` to `ask`

**Now true.**

1. **`main` still prompts on every touch** — moved to `ask`, not `allow`. Nothing about `main`
   became silent; the rule in CLAUDE.md that it only receives merges from `dev` after being
   asked explicitly is unchanged and is the actual control. This only removes the need to run
   the commands outside the session.
2. **`git push --force` remains DENIED**, on `main` and everywhere else. That is the rule worth
   keeping hard: it is the one that destroys history rather than merely publishing it.
3. A malformed `settings.json` silently disables every setting in the file, **including
   `attribution.commits: false`** — which is what keeps AI attribution out of the commits. The
   file is parsed and checked after any edit for that reason, not just eyeballed.

**Open.** Nothing new. Still nothing deployed and verified.

---

### 2026-09-08 - fix/render-blueprint-schema

**What.** Removed `dockerTarget: production` from `render.yaml`. There is no such field in
Render's blueprint schema and it was rejecting the whole blueprint.

**Why.** Two blueprint attempts failed. Render's message — "A Blueprint file was found, but
there was an issue" — does not name the offending key, so it reads as a malformed file rather
than one wrong line. Write-up in `docs/AI-NOTES.md`.

**Files.**

- `render.yaml`: `dockerTarget` removed; header now carries the schema URL and the one-command
  validation, because the dashboard error names nothing
- `apps/api/Dockerfile`: the `production` stage is marked MUST STAY LAST
- `docs/AI-NOTES.md`: entry

**Now true.**

1. **`render.yaml` validates clean against `https://render.com/schema/render.yaml.json`.**
   Checked with `pyyaml` + `jsonschema`, both already present on this machine. Validate before
   committing any change to this file — it is the one file in the repo that no local test can
   exercise.
2. **Render has NO way to select a Docker build stage.** It builds the FINAL stage of the
   Dockerfile. `production` must therefore stay last in `apps/api/Dockerfile`; a stage appended
   after it becomes the deployed API silently, with a green build and a green deploy. The
   Dockerfile says so at that stage.
3. **The rest of the blueprint was right and is now confirmed against the schema**, rather than
   against my memory of the docs: `plan: free` is a valid `serverPlan`, `region: frankfurt` is
   a valid region, a static site is `type: web` + `runtime: static`, and `routes` entries take
   `type`/`source`/`destination`. Static sites accept neither `region` nor `plan` — this file
   sets neither.

**Open.** Unchanged. Nothing is deployed and verified: the Docker build from the repository
root, SSE through Render's proxy, and a Nest boot inside 512 MB / 0.1 CPU are all still
untested, as is the participant flow on a phone.

### 2026-09-08 - fix/signal-copy-article

**What.** `accuracyRealism` rendered "consistent with a indoor venue". Now "an".

**Why.** Found in the console output of the first real phone visit, not by a test. Signal
reasons are the product — rule 1 says a verdict is a score plus reasons a human can act on —
so this is shipped user-facing copy on the surface a client is meant to trust, not a comment.

**Files.**

- `apps/api/src/verification/signals.ts`: the `+2` accuracyRealism branch interpolates
  `indoor ? 'indoor' : 'outdoor'` after an article. Both branches begin with a vowel, so the
  article is unconditionally "an" and needs no ternary of its own.

**Now true.**

1. **No test covers signal prose, deliberately.** The testing policy tests where a bug is
   silent and expensive; a wrong article is visible and cheap, and asserting on reason strings
   would freeze copy that should stay editable. This one was caught the only way it could be —
   by reading the console the way a client would. Grep for `a ${` before adding a branch that
   interpolates a word after an article; that sweep is now clean across `signals.ts`.
2. Copy only. No signal, weight or threshold moved, so no spoof-adversary run was required and
   none was done. 359 tests pass, unchanged.

**Open.** Nothing. Standalone fix.

### 2026-09-08 - docs/readme-urls-and-phone-run

**What.** The README's two outstanding TODOs are filled — the deployed URLs and the
architecture diagram — and the "never run on a phone" paragraph is replaced with what the
first real handset run actually established.

**Why.** README is a graded deliverable (CLAUDE.md §8) and was carrying three TODO markers
plus, after the phone run and the verified compose stack, two statements that were simply
false.

**Files.**

- `README.md`: deployed URLs table filled with the live hosts, plus the cold-start warning —
  a sleeping free instance is indistinguishable from a broken deploy, so `/health` first.
  Architecture section replaced with two ASCII diagrams (data flow, session state machine) and
  a paragraph on the outbox seam. Removed the "Key structural points" bullets, all three of
  which the new diagrams now state with more detail twenty lines above. Removed
  "`docker compose up` is not verified end to end", untrue since `fix/seed-preserves-completed-sessions`.
  Replaced the phone paragraph. Added the capture watchdog to "Not built".
- `docs/MEMORY.md`: this entry.

**Now true.**

1. **The participant flow has run on a phone. Capture is the weak half, not the engine.**
   50 minutes, 6 fixes. The first 102 s are correct — four fixes at 30/32/33 s, which is
   `SAMPLE_MS` holding against a `watchPosition` firing continuously in a moving car, with
   accuracy converging 36→6→5→4.5 m. The remaining 48 minutes produced two isolated fixes.
2. **The engine was verified against real-world evidence for the first time and was right.**
   `rejected` at score 0. `coverageRatio` 9.4% is arithmetically exact: 9+30+32+32+90+90+0 =
   283 s over 3011 s, with a 323 s and a 2584 s gap each truncated to the 3×interval cap. It
   refused to credit 43 unobserved minutes. `minDistanceM` 7083 m matches the real route.
   `jitterFingerprint` scored **+2** on honest driving GPS rather than crying spoof.
3. **The offline queue has still never run.** Every fix carried 1-2 s of skew, so nothing was
   ever buffered. The 43-minute hole is a capture gap, not a network gap. Do not read this run
   as evidence the queue works — it was not exercised.
4. **`receivedAt` is what the rollups integrate over, so an offline flush costs coverage** by
   design. Ingest stamps per fix (D-010), which keeps intervals non-zero and keeps the teleport
   check alive, but a flushed batch still arrives milliseconds apart and buys almost no
   coverage credit. `batchFlushedHonestVisit` pins this: it asserts only "not rejected", not
   "not penalised". Known and accepted, worth re-reading before anyone tunes coverage.
5. **The diagrams are ASCII, not Mermaid**, so they survive being read in an editor or a diff
   rather than only on GitHub. Not decision-logged: presentation, not architecture.

**Open.**

- **Whether capture resumes a cadence after a resume is unresolved.** Two isolated fixes look
  like "re-attached, delivered one cached position, went quiet", but a screen that was on for
  twenty seconds twice is indistinguishable in the trace. A deliberate lock/unlock test settles
  it in five minutes and needs no code: lock 2 min, unlock, hold visible 3 min, end.
- **No capture watchdog.** A silently stuck `watchPosition` is indistinguishable from an honest
  dark screen. This is the seam this run exposed: the honest-gap design makes the capture
  layer's own failure invisible. Undecided, so not in DECISIONS yet.
- Unchanged: no admin surface, no reaper, no Arabic pass.

### 2026-09-08 - feat/admin-surface

**What.** Venues, tasks and assignments can be created from the app. `POST /venues`, `/tasks`,
`/assignments` plus `GET /venues`, `/tasks`, `/participants`, and a Tasks tab in the console
that drives them. The seed is no longer the only way work enters the system.

**Why.** D-017 and D-018. This was the largest remaining functional gap: the data model, the
tenancy boundary and the `admin` role all existed and nothing could reach them.

**Files.**

- `apps/api/src/admin/admin.controller.ts`: no controller prefix — the paths are `/venues`,
  `/tasks`, `/assignments`, because these are the resources, not an admin view of them. The
  ROLE restricts them, not the URL.
- `apps/api/src/admin/admin.service.ts`: authoring plus the tenancy resolution. `createAssignment`
  writes the assignment and its pending session in one `withTransaction`.
- `apps/api/src/admin/dto/*.ts`: only `CreateVenueDto` carries `clientOrgId`; task and assignment
  derive it from the parent.
- `apps/api/src/admin/admin.spec.ts`: 23 tests, one per authorization boundary plus the
  round-trip and transaction guarantees.
- `apps/api/src/app.module.ts`: registers `AdminModule`.
- `apps/web/src/pages/TasksTab.tsx`: the three forms, in dependency order.
- `apps/web/src/pages/Console.tsx`: Tabs — Visits and Tasks. `apps/web/src/api/client.ts`: calls.
- `README.md`: an Authoring section, Features updated, "no admin UI" replaced with what is
  actually missing now. `docs/DECISIONS.md`: D-017, D-018.

**Now true.**

1. **A business user can author, not just read.** Their org comes from the token; naming a
   different one is a 403. An admin has `clientOrgId: null` so `POST /venues` requires it and
   checks it exists. Tasks and assignments have no org field — the parent is the authority, so
   a task cannot disagree with its venue about which tenant it belongs to (D-017).
2. **Creating an assignment creates its pending session, transactionally** (D-018). This is the
   invariant to preserve: `/sessions/mine` reads sessions, so an assignment without one is
   invisible to the participant. Authoring therefore needs a replica set, exactly like report
   submission already does.
3. **`MUI v9 Stack` does not take `alignItems` as a prop.** It goes in `sx`. The build catches
   it; worth knowing before writing the next form.
4. **`npx jest` fails on the specs with "Cannot find name 'expect'".** Use `npm test` — the
   script passes `--experimental-vm-modules`, and without it ts-jest resolves types differently.
   That is a tooling trap, not a broken test.
5. **The venue form takes one "lat, lng" field, not two boxes.** It is what Google Maps puts on
   the clipboard, so the common case is a paste with nothing to transpose — the axis swap the
   GeoPoint validator exists to catch is best prevented by not asking twice.

**Verified rather than assumed.** Ran the whole chain against the compose stack over real HTTP:
created a venue, a task and an assignment as `business`, then signed in as `user9` and confirmed
the new visit appeared in `/sessions/mine` as `pending` with the venue at 31.957, 35.9137 — not
transposed. In the running app a participant gets 403 on `POST /venues`, no token gets 401, and
`radiusM: 5000` gets 400. Test data was deleted from the local volume afterwards. 382 tests pass.

**Open.**

- **No edit and no delete.** A venue's geofence cannot be corrected, a task cannot be
  deactivated, an assignment cannot be moved. Editing `radiusM` specifically needs a decision
  first: started sessions pin a `venueSnapshot`, so an edit is safe for visits that have not
  begun and ambiguous for the ones that have.
- Not exercised against the LIVE deployment, because Render tracks `main` and this is on a
  branch. That check is still owed.
- Unchanged: no reaper, no Arabic pass, and the two open capture questions from the phone run.
