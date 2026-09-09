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

### 2026-09-08 - feat/lazy-reaper

**What.** `abandoned` and `expired` are reachable. Sessions are reaped lazily when a participant
reads their visits or the console reads its feed, and a reaped participant is told which timer
fired and why.

**Why.** D-016 decided the mechanism; D-019 decides the trigger surfaces and the UX. `dueEvent()`
and `apply()` had been written and tested since the state machine landed with nothing calling
them.

**Files.**

- `apps/api/src/session/reaper.service.ts`: new. `reapForParticipant` and `reapForOrg`, both
  bounded at 100 sessions per sweep.
- `apps/api/src/session/sessions.controller.ts`: `/sessions/mine` sweeps first, awaited.
- `apps/api/src/console/console.controller.ts`: `/console/visits` and `/visits/counts` sweep the
  org first. `console.module.ts` imports `SessionsModule` to reach the reaper.
- `apps/api/src/session/sessions.service.ts`: `SessionView.terminalReason`, and `mine()` now also
  returns sessions reaped in the last 24 h.
- `apps/api/src/session/reaper.spec.ts`: 15 tests. `apps/web`: the terminal-state alert shows
  the reason. `docs/DECISIONS.md`: D-019. `README.md`: features, env table, what is missing.

**Now true.**

1. **The candidate query is deliberately wider than the rule.** It selects anything plausibly
   due and lets `dueEvent()` decide per document. Do not "optimise" the timer logic into the
   Mongo filter — that would be a second copy of the rule, free to disagree with the pure
   function that is actually tested.
2. **The reaper must never break the read it hangs off.** Every failure inside `sweep()` is
   swallowed and logged. A stale row is a smaller problem than a broken page, and that
   asymmetry is the only reason this is safe in a read path.
3. **`endedAt` is NOT set when reaping.** The participant did not end the visit; writing a time
   would assert something that never happened. `lastSeenAt` moves, because `apply()` moves it.
4. **The console read now performs writes.** It does not break rule 6 — the write is to
   `sessions`, which the console already reads, and the ping collection is untouched.
5. **`sessionEvents` refuses `deleteMany` at the model level.** A test that clears collections
   between cases cannot clear that one; scope assertions by `sessionId` instead. Rule 8 is
   enforced by a pre-hook, not by convention, and it caught this suite.
6. **`visit-lifecycle.spec` wires the REAL reaper, on purpose.** It is the only suite that walks
   a whole visit through `/sessions/mine`, so it is the only place that proves a sweep does not
   reap a session that is legitimately in progress. `console.spec` stubs it, because that suite
   is about what the console reads.
7. **Mongoose 9 does not export `FilterQuery` as a named type** under this module resolution.
   Use `Record<string, unknown>`, which is what `console.service.ts` already does.

**Verified rather than assumed.** 397 tests pass, 15 of them new: both timers, expiry preferred
over abandonment, `ended` never expiring, terminal sessions untouched, org and participant scope
boundaries, the append-only event written with `actor: 'system:reaper'`, `endedAt` left null,
and idempotency across two sweeps.

**Open.**

- **Not yet exercised against the live deployment**, and not yet merged.
- A session nobody reads stays `active` for ever. Correct for a demo, wrong for anything that
  pays people — that needs a real scheduler on a tier that does not sleep.
- The 24-hour terminal window on `/sessions/mine` is a step towards a history screen this is
  deliberately not. If it grows, it needs its own endpoint.
- Unchanged: no edit or delete on the admin surface, no Arabic pass, and the two open capture
  questions from the phone run.

### 2026-09-08 - fix/venue-coordinate-precision

**What.** `POST /venues` refuses a coordinate too coarse for the geofence it defines, and the
venue form says so before you submit and recognises a pasted Google Maps share link.

**Why.** D-020. A real visit was rejected while the participant was standing in the right shop.

**Files.**

- `apps/api/src/geo/precision.ts`: new, pure. `decimalPlaces`, `impliedPrecisionM`,
  `checkCoordinatePrecision`.
- `apps/api/src/geo/precision.spec.ts`: 16 tests, including the exact coordinate that caused it.
- `apps/api/src/admin/admin.service.ts`: `createVenue` rejects with a message naming the implied
  precision, the required precision and what to do.
- `apps/api/src/admin/admin.spec.ts`: the failing coordinate is a 400; the same coordinate at a
  500 m radius is a 201, because the rule scales.
- `apps/web/src/pages/TasksTab.tsx`: decimal-count nudge and share-link detection.
- `docs/DECISIONS.md`: D-020. `README.md`: the authoring section.

**Now true.**

1. **The engine has now been wrong zero times and looked wrong twice.** Both were the input.
   The drive was a real rejection of a real absence; this one was a correct measurement against
   a wrong centre. Before touching a threshold because a verdict looks wrong, check the venue
   coordinate and the ping coordinates against a map.
2. **`decimalPlaces` must round-and-compare, not count string digits.** The seeded venue reads
   back as `35.913700000000006`; counting characters would claim fifteen decimals of precision
   for a four decimal value and wave through exactly what this guard exists to catch.
3. **The web does NOT duplicate the threshold.** It nudges on decimal count only; the server
   owns the rule that scales with radius. A second copy of a threshold is the thing this repo
   keeps getting bitten by.
4. **The precision rule scales with the radius**, so it is not "always five decimals". Three
   decimals (~56 m) is fine for a 500 m fence and useless for a 25 m one.
5. **Existing venues are not re-validated.** `Lune` at `31.98, 35.83` is still in the live
   database and still unusable, and there is still no venue edit endpoint.

**Open.**

- **`Lune`'s coordinates are still wrong in production.** The correct value is about
  `31.9399, 35.8486`, taken from where the participant's own fixes clustered. Needs either a
  direct database correction or the venue edit endpoint that does not exist.
- **`accuracyRealism` penalised an honest participant -12 on that visit**: "Median accuracy was
  4 m at an indoor venue. Indoor fixes normally degrade to tens of metres." They had a genuine
  4 m fix at a venue flagged `indoor`. The signal is defensible against a spoofer but this was a
  false positive, and it is the one signal observed firing wrongly on real data. Changing it
  needs a spoof-adversary pass; NOT changed here.
- Unchanged: reaper merged? no — `feat/lazy-reaper` is still an unmerged branch. No Arabic pass.

### 2026-09-08 - feat/venue-edit (on fix/venue-coordinate-precision)

**What.** `PATCH /venues/:id` and a Venues table with an Edit action in the Tasks tab. Ping
ingest now measures against the session's `venueSnapshot` instead of the live venue.

**Why.** D-021. D-020 stopped a bad coordinate being created but left the existing one
unfixable. Building the edit path exposed the ingest bug, which had to be fixed first.

**Files.**

- `apps/api/src/pings/pings.service.ts`: measures against `session.venueSnapshot`, falling back
  to the live venue only when it is null.
- `apps/api/src/admin/admin.service.ts`: `updateVenue`. `dto/update-venue.dto.ts`: all optional,
  no `clientOrgId`. `admin.controller.ts`: `@Patch('venues/:venueId')`.
- `apps/api/src/pings/pings.spec.ts`, `admin.spec.ts`: the regression and the edit boundaries.
- `apps/web/src/pages/TasksTab.tsx`: venues table, form doubles as create-or-correct.
- `docs/DECISIONS.md`: D-021. `README.md`: endpoint table and what is missing.

**Now true.**

1. **THE BUG WORTH REMEMBERING: D-012 was only half applied.** It pinned `venueSnapshot` and
   switched the evaluator to it, but ingest kept reading the venue live — so the evaluator used
   a snapshot venue alongside per-fix `distanceM`/`presence` computed against the live one. One
   venue edit mid-visit put two vintages of geofence in a single trace. Same shape as every
   other bug here: a seam between two subsystems that were each correct alone.
2. **A correction never changes a verdict already reached**, and re-running the evaluator will
   not change it either. Visits are judged against the fence they ran under. Correct, and
   counter-intuitive enough to be worth saying out loud to a reviewer.
3. **A venue cannot change organisation.** `clientOrgId` is absent from `UpdateVenueDto`, so
   `forbidNonWhitelisted` makes it a 400 rather than a silently dropped field.
4. **Precision is re-checked against the RESULTING pair.** Tightening the radius alone can fail
   even though the coordinate did not move, which is the point.
5. **The snapshot-less fallback in ingest is dead code in production** — every session since
   D-012 has a snapshot. It is covered by a test and should be deleted when no such sessions
   remain.

**Verified rather than assumed.** 420 tests pass. The new ingest test fails without the fix: it
puts the snapshot ~5.5 km from the live venue and asserts a fix at the snapshot reads `inside`.

**Open.** `Lune` still needs correcting in production — do it through the deployed `PATCH`
endpoint once this is on `main`, which also verifies the endpoint live.

### 2026-09-08 - feat/arabic-pass

**What.** The participant flow speaks Arabic and lays out right-to-left. Sign in, consent, the
visit screen and the report, plus a language toggle on both screens a participant can reach.

**Why.** D-022, and CLAUDE.md section 9 which scopes i18n to exactly this.

**Files.**

- `apps/web/src/i18n/strings.ts`: the dictionary. `Strings` is derived from the English object,
  so Arabic is checked against it at compile time.
- `apps/web/src/i18n/LocaleContext.tsx`: provider. Owns the dictionary AND the theme, because
  direction is a theme concern and two providers that could disagree is a seam.
- `apps/web/src/i18n/strings.spec.ts`: 5 tests. `jest.config.js`: the i18n dir added to roots.
- `apps/web/src/theme/theme.ts`: `buildTheme(direction)`. `main.tsx`: LocaleProvider wraps all.
- `apps/api/src/session/sessions.service.ts`: `terminalReasonCode` + `timeouts` on SessionView.
- `Consent.tsx`, `VisitPage.tsx`, `Login.tsx`, `api/client.ts`.

**Now true.**

1. **`terminalReason` is the only server-composed sentence a participant sees**, so it now
   travels as a CODE plus `timeouts`, and the client renders it. Any future participant-facing
   string composed on the server needs the same treatment or the screen goes half-English.
2. **No plural machinery, deliberately.** Copy is written count-neutrally — "Locations
   recorded: 3", never "3 locations" — because English needs one plural rule and Arabic six.
   Keep writing it that way; nothing enforces it.
3. **RTL rests on `document.dir` plus MUI's own logical properties, not a plugin.** A component
   written with a physical `marginLeft` will NOT mirror and nothing will warn. Use `ms`/`me` or
   spacing shorthands.
4. **In `ActiveVisit`, `t` is the tracker, not the translator.** The translator is `tx` there.
   This is the one place the convention breaks and it will catch someone.
5. **The console stays English**, including every verification signal reason. Translating those
   means codes and parameters for all nine signals; that is the full i18n that was cut.
6. **The dictionary test is the guard that matters.** Types catch a missing key; they do not
   catch an empty string, an untranslated copy-paste, or a `{placeholder}` lost in translation.
   All four are tested.

**Verified rather than assumed.** 425 tests pass. Both web and api build clean.

**Open.**

- Not yet checked on a real phone in Arabic — RTL on a small screen is where a missed physical
  margin actually shows, and this pass has only been reasoned about, not looked at.
- Western digits, not Eastern Arabic numerals. Correct for Jordan and the Gulf; a choice, not
  an oversight.
- Unchanged: the capture watchdog is still blocked on the lock/unlock test, and
  `accuracyRealism` still has the false positive from user2's visit.

### 2026-09-08 - feat/capture-watchdog

**What.** A silent `watchPosition` is detected and re-attached while the page is visible.
Restarts are counted and shown to the participant.

**Why.** D-023, from the 50 minute drive: four fixes at a perfect cadence, then two isolated
fixes in 48 minutes, and no way to tell a dead watch from a dark screen.

**Files.**

- `apps/web/src/participant/watchdog.ts`: new, pure. `isCaptureStale`, `shouldRestart`.
- `apps/web/src/participant/watchdog.spec.ts`: 12 tests.
- `apps/web/src/participant/useVisitTracker.ts`: liveness refs, the 15 s watchdog interval,
  `restarts` on TrackerState.
- `apps/web/src/i18n/strings.ts`, `VisitPage.tsx`: the restart count in the status line.

**Now true.**

1. **Liveness is recorded on ANY callback, including errors, and BEFORE the throttle.** Both
   halves matter. A fix dropped for arriving too soon still proves the watch is alive, and a
   receiver that cannot get a lock still fires its error callback — so only total silence trips
   the watchdog. Restarting on a missing *fix* instead would throw away a warm watch every time
   someone walked into a basement.
2. **It never runs while the page is hidden.** A silent watch on a locked screen is correct, the
   OS would refuse the restart anyway, and acting there would claim observation that did not
   happen. This is the line the whole system is built around; do not move it.
3. **`STALE_AFTER_MS` is 90 s because that is `SAMPLE_MS * 3`**, the same `maxGap` the engine
   uses for coverage. The client gives up on a watch at exactly the point the server stops
   crediting it. A test asserts the relationship so the two cannot drift apart.
4. **A 30 s floor between restarts stops it spinning** when the device genuinely has no signal.
5. **`restarts` is deliberately visible.** It is the only evidence that capture died rather than
   the screen being off — the ambiguity the drive could not resolve now reports itself.

**Verified rather than assumed.** 437 tests pass. The decision logic is pure and table-tested.

**Open.**

- **Still not run on an iPhone**, which is the device the failure was observed on. The watchdog
  is written against a described failure, not a reproduced one.
- It cannot help while the screen is off, which is probably where most of the drive's 48 minute
  hole came from. This narrows the ambiguity; it does not remove it.

### 2026-09-08 - chore/submission

**What.** Final deliverables pass. The README's self-addressed TODO banner is gone, the
out-of-scope section reflects what was actually built, and a "what I would build next" section
names the four things that would most change what the system can claim.

**Why.** README is a graded deliverable (CLAUDE.md section 8) and was still carrying a note
written to myself, plus an out-of-scope line saying there was no task authoring UI when there is.

**Files.**

- `README.md`: banner removed; out-of-scope corrected on authoring; "What I would build next"
  added; the documentation table now lists `docs/REQUIREMENTS.md` and `.claude/`.
- `docs/AI-NOTES.md`: fourth entry — I described venue editing as "safe" before checking whether
  ingest used the snapshot, which it did not.

**Now true.**

1. **Zero TODOs in the README**, 16 sections, code fences balanced, and every file the
   documentation table names exists.
2. **`.claude/` is listed as a deliverable**, which it is: the brief asks how the work was done,
   and the agents and skills are the answer. They are submitted as they evolved (CLAUDE.md
   section 1) and must not be tidied.
3. **The AI-NOTES entry is the honest one.** All 420 tests passed either side of that bug; it
   was reachable only through a feature that did not exist yet, and nothing in the tooling could
   have surfaced it. That is the argument the file exists to make.

**Open.** Nothing in the docs. Outstanding in the product: no delete anywhere, the watchdog is
unverified on an iPhone, RTL has not been looked at on a real screen, and `accuracyRealism`
still has the false positive from user2's visit — penalising an honest 4 m fix at an indoor
venue. That last one needs a spoof-adversary pass before anyone touches it.

### 2026-09-08 - feat/i18n-json-and-ux

**What.** All copy moved to `en.json` / `ar.json` and extended to the whole app (console and
admin were English). A discreet screen for the participant. A responsive pass so the pages work
on a phone.

**Why.** D-024 and D-025, both from direct user requests. D-024 supersedes the format and scope
halves of D-022; the no-library decision there still stands.

**Files.**

- `apps/web/src/i18n/en.json`, `ar.json`: ~145 keys, nested by area. `strings.ts`: JSON loaders,
  `TranslationKey` derived from English, `lookup`/`interpolate`/`flatten`.
- `apps/web/src/i18n/strings.spec.ts`: 11 tests. `LocaleContext.tsx`: dotted keys with fallback.
- `Console.tsx`, `TasksTab.tsx`, `VerdictChip.tsx`: localised — these were entirely English.
- `apps/web/src/participant/DiscreetMode.tsx`: new. `VisitPage.tsx`: renders it as an overlay.
- `apps/web/tsconfig.json`, `jest.config.js`: `resolveJsonModule`.

**Now true.**

1. **`en.json` is the source of truth and `TranslationKey` is derived from it**, so a key that
   does not exist in English is a compile error. What types CANNOT see — an empty value, an
   untranslated copy-paste, a dropped `{placeholder}`, a key missing from Arabic — is what
   `strings.spec.ts` exists for. Do not weaken it; these files are meant to be edited by
   non-developers.
2. **`t()` falls back English → key, never to empty.** Lookup is now runtime, so a bad key is
   possible in a way it was not before; a visible untranslated sentence beats a blank button.
3. **Verification signal reasons are STILL English in every locale.** They are composed on the
   API. This is the visible seam the whole-app translation created, and it is documented in the
   README rather than hidden.
4. **`DiscreetMode` is an overlay rendered as a SIBLING inside `ActiveVisit`.** It must never
   replace that subtree: `useVisitTracker` lives there, so unmounting it to show a cover would
   release the watch and stop capture — the opposite of the feature's purpose.
5. **It deliberately does not imitate a real lock screen** (D-025) and always shows that the
   visit is running. It conceals from a bystander, never from the participant.
6. **The visit list has two presentations**: a table from `sm` up, cards below. A four-column
   table was unusable at 360 px. Both render from the same `rows`.

**Verified rather than assumed.** 443 tests pass, both apps build. Not verified: nothing has been
looked at in a browser — the Chrome extension is not connected in this environment — so the
responsive work and RTL are reasoned, not observed.

**Open.**

- **No graphs anywhere.** Never built, never planned; the user asked as though they existed.
- **No evidence upload.** Never built either — only an `evidenceKey` field on the report schema.
  It is a documented cut (README, "Deliberately out of scope"), and reversing it needs S3/R2
  credentials plus a decision entry.
- Discreet mode and the responsive layouts are unobserved on a real device.

### 2026-09-09 - feat/evidence-upload (evidence + dashboard)

**What.** The single report photo now uploads, stores, and is shown to the business user. The
console gains an Overview tab with stat tiles and two charts.

**Why.** D-026 and D-027, both direct user requests. D-026 reverses the "evidence upload is out
of scope" cut and the S3 half of CLAUDE.md §4.

**Files.**

- `apps/api/src/evidence/`: `evidence.service.ts` (GridFS store/read/delete), `.controller.ts`
  (raw-body POST, guarded GET), `.constants.ts` (allowlist, cap, magic bytes), `.spec.ts` (17).
- `apps/api/src/reports/`: `create-report.dto.ts` optional `evidenceKey`; `reports.service.ts`
  verifies ownership before the transaction and sweeps orphans after it commits.
- `apps/api/src/console/console.service.ts`: `stats()` aggregation; `.controller.ts`:
  `GET /console/stats`. `console.service.ts` also now projects `report.evidenceKey`.
- `apps/web/src/participant/EvidencePicker.tsx`, `pages/Dashboard.tsx`, `theme/theme.ts`
  (`verdictChartPalette`), `Console.tsx` (Overview tab + `EvidenceImage`).

**Now true.**

1. **THE SCHEMA-REVIEWER PASS EARNED ITS KEEP AGAIN — two blocking finds.** (a) Nothing capped
   storage: each upload wrote a new object and "Replace photo" orphaned the last. On a 512 MB
   Atlas M0, ~120 photos fills the WHOLE database, and Atlas then refuses writes database-wide —
   so the first symptom would be ping ingest failing, three layers from the cause. (b) Nothing
   deleted unreferenced objects, so an abandoned upload was a photo taken inside a venue, kept
   for ever, that no product surface could reach. Both fixed; both have tests.
2. **One photo per session, enforced at upload.** `Report.evidenceKey` is a single scalar, so
   that is what the data model always described. Re-uploading deletes the previous object.
3. **Deletion MUST go through `bucket.delete()`.** A TTL index or a raw delete on
   `evidence.files` removes the file document without cascading to `evidence.chunks`, leaving
   the bytes in the database permanently AND unreachable through the GridFS API. This is why
   evidence has a sweep-shaped retention story and not a TTL one. Retention itself is not built.
4. **A business user may only read a photo a SUBMITTED report references.** Org membership alone
   was not enough: it would have exposed photos from visits the participant abandoned.
5. **`metadata.sessionId` carries an index** (`evidence_by_session`). Replace and sweep both
   query by it; without the index they are collection scans that slow down as storage fills.
6. **Content-Type is a claim, so bytes are checked against it.** SVG is refused deliberately —
   an image to a human, a script host to a browser. Reads also send `nosniff` and
   `Content-Disposition: attachment`.
7. **The chart palette is NOT the brand palette.** Brand green is chroma 0.082 and FAILS the
   dataviz validator's chroma floor — it reads gray in a chart. `verdictChartPalette` is
   re-stepped to `#0F7A55` and passes all six checks. Verified by running the validator, not by
   eye. Do not "unify" these two palettes; they have different jobs.
8. **The dashboard's headline chart is the failure ranking, not volume.** Which check keeps
   failing is knowledge only this system has. It counts negative contributions only, so it is
   not a complete picture of the engine and should not be read as one.

**Verified rather than assumed.** 460 tests pass. Not verified: nothing has been exercised
against a browser or the live deployment yet — no photo has actually been taken on a phone and
no chart has been looked at.

**Open.**

- **Evidence has no retention policy** while pings expire in 30 days. Named in D-026 and in the
  consent copy; the sweep is not built.
- **Sessions that never submit still leak one photo each** — the post-submit sweep only fires on
  submit. A reaper-triggered sweep for terminal sessions is the missing piece.
- Storage is a hard ceiling on M0. The S3 adapter is the real answer and needs credentials.
- No date-range control on the dashboard; 30 days is fixed. No caching on the aggregation.

### 2026-09-09 - feat/s3-object-store

**What.** Evidence can live in an S3-compatible bucket (MinIO locally, R2 or anything else in
production), chosen at boot from config, with GridFS as the fallback. Venue coordinates are
picked on a map instead of typed.

**Why.** D-028 and D-029, both direct user requests: "we have minio correct?" (no, and now yes)
and "link to google maps to make the admin choose the location from the map".

**Files.**

- `apps/api/src/evidence/storage/`: `object-store.ts` (the four-verb interface), `sigv4.ts`
  (hand-written signing, pure), `s3.store.ts`, `gridfs.store.ts`, `object-store.provider.ts`
  (the boot-time choice), `sigv4.spec.ts` (21 tests).
- `apps/api/src/evidence/evidence.service.ts`: refactored onto the interface; knows nothing
  about MongoDB or S3 now.
- `docker-compose.yml`: pinned `minio` + one-shot `minio-init`; the api gets `S3_*` and waits on
  `service_completed_successfully`.
- `apps/web/src/components/slippy.ts` + `.spec.ts` (20 tests), `MapPicker.tsx`; `TasksTab.tsx`
  uses the map with typing behind a toggle.

**Now true.**

1. **Where the photos are is a boot-time log line, never a guess.** `Evidence -> S3 at ...` or
   `Evidence -> MongoDB GridFS (no S3 configured)`. A PARTIAL S3 config logs an ERROR and falls
   back rather than half-working — silent fallback on a typo is how production photos end up in
   MongoDB while everyone believes they are in a bucket.
2. **S3 keys are opaque and slash-free OUTSIDE the store, prefixed INSIDE it.** The bucket path
   is `sessions/<id>/<uuid>` because `listBySession` is a native prefix list; the key handed out
   is `<sessionId>.<uuid>`. This was not theoretical — the first version leaked the slashes into
   `/evidence/:evidenceKey`, a route param does not match `/`, and every read 404'd while
   looking like a missing object.
3. **No AWS SDK, per CLAUDE.md §4.** SigV4 is ours and is pure, which is the only reason it can
   be tested without a bucket. Every mistake in it surfaces as a bare `403
   SignatureDoesNotMatch`, so the canonical request and string-to-sign are asserted directly.
4. **MinIO has NO healthcheck, deliberately.** Recent images ship neither `curl` nor `wget`, so
   a healthcheck using either never passes and `depends_on: service_healthy` hangs for ever —
   which looks like a broken build. `minio-init` retrying with `mc` is the readiness signal.
5. **The map picker is the structural fix for D-020.** A coordinate from a pin cannot be
   imprecise or transposed. The precision guard stays as the backstop.
6. **`decimalsForZoom` caps reported precision by zoom**, so the form cannot claim a millimetre
   from a view where a pixel is forty metres — while never dropping below the four decimals
   D-020 requires.
7. **A test caught me asserting a tile index I had not actually computed.** The Amman reference
   value was wrong. There are now two independent reference points at different latitudes and
   zooms, because one known value can be a coincidence of a consistently-wrong formula.

**Verified rather than assumed.** 501 tests pass. Against a real MinIO in compose: the boot log
chose S3, a PUT landed a 4.1 KiB object at `sessions/<id>/<uuid>` (confirmed with `mc ls`), a
second upload REPLACED it (one object, not two), and a read returned bytes identical to the
file uploaded. Venue creation accepts a map-derived coordinate.

**Open.**

- **The deployed demo still runs on GridFS**, because it has no bucket. The S3 path is exercised
  only by `docker compose up` until R2 credentials exist — then it is four env vars, no code.
- **Nothing has been looked at in a browser.** The map picker's drag, zoom and RTL behaviour are
  reasoned and unit-tested, not observed.
- No address search on the map: finding a venue means panning to it. Geocoding is the obvious
  next step. No pinch-zoom either; the +/− buttons are the only zoom control on a phone.
- Tiles come from `tile.openstreetmap.org`. Fine for a demo, wrong for production volume — a
  paid tile host is needed, and the attribution notice is required by their policy.

### 2026-09-09 - feat/geocode-search

**What.** The venue map has a search box. Type a place, pick a result, the map jumps there at a
zoom suited to what was found. Dragging still works for the final adjustment.

**Why.** D-030. D-029 shipped a map with no way to find anything on it.

**Files.**

- `apps/api/src/geocode/nominatim.ts`: pure — query normalisation, URL building, response
  mapping, zoom-by-kind. `nominatim.spec.ts`: 16 tests.
- `apps/api/src/geocode/geocode.service.ts`: the client, the 1.1 s serialised rate limit, and a
  bounded 10-minute cache. `.controller.ts`, `.module.ts`.
- `apps/web/src/components/MapPicker.tsx`: debounced search with abort, results list.
- `apps/web/src/api/client.ts`, `i18n/{en,ar}.json`.

**Now true.**

1. **THE BUG THIS FOUND: `Number(null)` is `0`, not `NaN`.** So is `Number('')`, `Number([])` and
   `Number(false)`. A missing latitude parsed with a bare `Number()` becomes a venue at 0°, in
   the Gulf of Guinea, that looks like a perfectly ordinary coordinate. A test caught it before
   it shipped. `toCoordinate()` now accepts only a string or a number and returns null otherwise.
   The same trap exists anywhere external numeric data is parsed — the ping DTO is safe because
   class-validator checks types, but nothing else should reach for a bare `Number()`.
2. **Geocoding is PROXIED, not called from the browser**, and the binding reason is that
   Nominatim's policy requires a real `User-Agent`, which a page cannot set. The rate limit is
   also per application, so it can only be honoured where requests converge.
3. **The rate limiter is a serialised promise chain, not a counter.** Parallel callers queue
   rather than race, which is what makes the 1.1 s interval a guarantee instead of a hope.
4. **`geocode/` is its own module and NOT part of `geo/`.** `geo/` is pure — haversine and the
   precision rule — and this does network I/O, holds a cache and enforces a limit. Keeping them
   apart is what stops the pure half growing an untestable dependency.
5. **Result labels are third-party text.** Length-capped on the server, rendered as text by
   React, never as markup.
6. **`zoomForKind` is duplicated client-side**, deliberately and trivially: sending a zoom per
   result would put a presentation decision in the API payload. If it grows past a handful of
   cases it belongs in `@msp/shared`.

**Verified rather than assumed.** 517 tests pass. Against real Nominatim from the compose stack:
"mecca street amman" returned Mecca Mall at 31.97767, 35.84389 with Arabic labels; "city mall
amman" returned one result. Boundaries: no token 401, participant 403, two-character query 400.
Cache measured — 837 ms cold, 64 ms warm for the same query.

**Open.**

- **In-process cache and limiter.** One instance today, so exact; a second instance would double
  the upstream rate and need a shared limiter.
- **No reverse geocoding** — the pin does not say what it is on top of. Rejected for now on
  request budget, since it would fire on every pan.
- Nominatim's coverage of small businesses in Jordan and the Gulf is thinner than Google's, so
  some venues still have to be found by dragging. Community servers are not for production volume.

### 2026-09-09 - fix/submit-confirmation

**What.** Submitting a report now confirms itself, the report form goes away, and the console
has a People tab showing results per participant.

**Why.** Three reports from a live test: no confirmation on submit, pressing it again said
"already submitted", and there was no way to see results per person. D-031 for the last one.

**Files.**

- `apps/api/src/session/sessions.service.ts`: `mine()` returns `submitted` visits from the last
  24 h as well as reaped ones.
- `apps/web/src/participant/VisitPage.tsx`: success Snackbar, and the local state advances
  immediately rather than waiting for the reload.
- `apps/api/src/console/console.service.ts`: `participantStats()`. `.controller.ts`:
  `GET /console/participants`. `apps/web/src/pages/People.tsx`, `Console.tsx`, i18n, client.

**Now true.**

1. **THE SUBMIT BUG WAS A SERVER FILTER, not a UI one.** `/sessions/mine` excluded `submitted`,
   so after a successful submit the list came back WITHOUT that visit, `setCurrent` fell back to
   the stale `ended` session it already held, the report form stayed up as though nothing had
   happened, and a second press produced "already submitted". The participant got an error for
   the successful path and no acknowledgement for the success. Anything that changes which
   states `mine()` returns has to be checked against what the participant screen renders for
   each one.
2. **The local state is advanced optimistically as well as reloaded.** The reload is
   authoritative but it is a round trip, and that round trip is exactly long enough to press
   submit twice.
3. **`verificationResults` has NO `participantId`.** It carries `sessionId` and `clientOrgId`.
   Grouping a pipeline by `$participantId` there does not error — every row collapses under a
   `null` key and the whole column becomes one meaningless bucket. The People aggregation joins
   through `sessionId` in the service. Check the schema before grouping on a field.
4. **The People tab ranks attention, not guilt** (D-031). It will not produce a trust score, and
   the banner names the alternative explanations specifically — a wrong venue coordinate and a
   poor indoor GPS — rather than carrying a generic disclaimer.

**Verified rather than assumed.** 517 tests pass. Against the compose stack: a full
consent → start → end → submit produced 201, and `/sessions/mine` then returned the visit as
`submitted` rather than dropping it. `/console/participants` returned five participants ranked
worst-first with `noUsableEvidence` and `presenceDwell` as their top issues; participant 403,
no token 401.

**Open.**

- **The People view has no per-venue breakdown**, which is the cut that most limits it: a
  participant failing only at one venue is the clearest possible sign the venue is the problem.
- Pass rate is unweighted, so one visit at 100% sorts with twenty at 100%. Visit count is shown
  beside it for that reason.
- Window fixed at 30 days, no control.

### 2026-09-09 - feat/s3-hosted-setup

**What.** Everything needed to point the DEPLOYED API at a real bucket: the `S3_*` variables
declared in `render.yaml`, a boot-time reachability probe with diagnostic messages, and
`/health` reporting which backend is live and whether it answered.

**Why.** Asked directly: "how to connect the s3 minio to the hosted version". The answer is
that you cannot — `http://minio:9000` is a container hostname on a laptop and Render has no
route to it — so the useful work was making a hosted bucket a config-only step you can verify.

**Files.**

- `apps/api/src/evidence/storage/object-store.ts`: `verify()` on the interface.
  `s3.store.ts` / `gridfs.store.ts`: implementations.
- `apps/api/src/evidence/evidence.service.ts`: `onModuleInit` probe, cached in `storeStatus`.
- `apps/api/src/health/health.controller.ts`: `evidence: { backend, ok }`.
- `render.yaml`: the six `S3_*` entries, four of them `sync: false`.
- `README.md`: "Pointing the deployed API at a real bucket".

**Now true.**

1. **`GET /health` now answers "where do photos go".** `{"evidence":{"backend":"s3","ok":true}}`.
   `detail` is deliberately NOT exposed on the public endpoint — it contains the endpoint URL.
   The service log has the detail.
2. **The probe runs ONCE at boot, not per request.** The keep-alive pinger hits `/health` every
   ten minutes; a live round trip to the bucket on each would spend the free tier's request
   budget confirming the bucket still exists.
3. **The two failure modes are distinguishable, and that is the point.** 403 says credentials or
   region; 404 says bucket name or path-style. At the first failed upload they look identical.
   Both messages name the exact environment variables to check.
4. **A bad bucket does NOT stop the API booting.** Evidence is optional; taking the visit flow
   down over a photo store would be the wrong trade. It logs ERROR and falls back to serving
   everything else.
5. **`render.yaml` validated against `https://render.com/schema/render.yaml.json` before commit**
   — the house rule, and the file that has blocked a deploy twice. VALID.
6. **Nothing migrates.** Photos already in GridFS stay there and stay readable; their key is on
   the report. Switching backends changes where NEW photos go.

**Verified rather than assumed.** 517 tests pass. Against compose: a good MinIO config gives
`{"backend":"s3","ok":true}`; a wrong `S3_SECRET_ACCESS_KEY` gives `UNREACHABLE — 403 … check
S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY`; a wrong `S3_BUCKET` gives `UNREACHABLE — 404 … bucket
"no-such-bucket" does not exist`. The API booted and served in all three.

**Open.** No hosted bucket is provisioned, so the deployed demo still runs on GridFS and the S3
path is exercised only by compose. R2 asks for a payment method even on its free tier; Supabase
Storage does not, which is why the README lists it.

### 2026-09-09 - fix/r2-endpoint-guard

**What.** The S3 endpoint is normalised at construction: if it already ends with the bucket
name, the bucket is stripped and a warning is logged. Plus README detail on which two R2 values
are actually the credentials.

**Why.** Prompted by a real setup attempt. R2's bucket page shows the **Account ID** and an
**S3 endpoint with the bucket already appended** — neither is a credential, and both are the
things in front of you when you copy.

**Files.**

- `apps/api/src/evidence/storage/s3.store.ts`: exported `normaliseEndpoint`, called from the
  constructor. `s3-endpoint.spec.ts`: 7 tests. `README.md`.

**Now true.**

1. **`S3_ENDPOINT` ending in the bucket name is corrected, not obeyed.** Pasting R2's displayed
   endpoint produced `…/visit-evidence/visit-evidence/…`, every request 404'd, and the 404 said
   "bucket does not exist" while the bucket was fine.
2. **It fixes AND warns.** Silently correcting configuration is how the next person inherits a
   setting that does not mean what it says.
3. **Only a whole final segment is stripped.** `…/my-visit-evidence` with bucket
   `visit-evidence` is left alone, and Supabase's `/storage/v1/s3` survives a bucket named `s3`.
4. **R2's Account ID is not a variable this app reads** — it is already inside the endpoint
   hostname. The credentials come from *Manage R2 API Tokens*, and the "Token value" shown there
   is a Cloudflare API token, NOT the S3 secret.

**Verified rather than assumed.** 524 tests pass. Against real MinIO, an endpoint of
`http://minio:9000/visit-evidence` logged the warning, corrected itself, and reached the bucket.

**Open.** Still no hosted bucket provisioned; the deployed demo remains on GridFS.

### 2026-09-09 - fix/verdict-rules

**What.** The task's `expectedDwellSeconds` actually reaches the verdict, and the rules stopped
failing honest visits — then were hardened twice after the spoof-adversary pass showed the first
attempt had broken the fraud engine.

**Why.** D-032. Two reports from live use: a task set to 1 minute still said "expected 5 min",
and a real 5-minute visit scored 68 for having good indoor GPS and starting on arrival.

**Files.** `verification/evaluator.service.ts` (session → assignment → task), `signals.ts`,
`rollups.ts`, `types.ts`, `engine.spec.ts`, `test/fixtures/scenarios.ts`,
`reports/visit-lifecycle.spec.ts`.

**Now true.**

1. **`expectedDwellSeconds` is read from the task.** It was authored, stored, shown in the admin
   form, and never used — every visit was scored against the hard-coded 300 s. Resolved per
   evaluation, NOT snapshotted, because tasks cannot be edited yet; the moment task editing
   lands this needs the `venueSnapshot` treatment or an edit will re-score old visits.
2. **THE LESSON: loosening a rule to fix a false positive re-opened the fraud engine.** The
   first attempt flipped a fabricated indoor trace from 68 to 88 with the attacker changing
   nothing. Never change a verification weight without running the spoof-adversary pass — it
   caught this, and then caught four more bugs in the fix.
3. **The score ceiling is 88 and the auto threshold is 75, so every trace has a 13-POINT
   CUSHION.** Any penalty smaller than 13 cannot stop anything on its own. That arithmetic is
   why the dispersion penalty is −15 and not −10.
4. **`accuracyRealism` tests dispersion, not level** — and its `values` array must come from
   USABLE fixes only, because the median does. Drawing them from different populations let one
   junk `accuracyM: 250` disable both negative branches. It also needs `distinct >= 4`, which is
   what separates a shim from quantised Android accuracy on a stationary device.
5. **Corroboration counts intervals that span real time on EITHER clock.** Counting bare
   intervals was cadence-dependent, and only the honest client is rate-limited (30 s throttle);
   testing `receivedAt` alone punished the honest offline flush, whose fixes all arrive at once.
6. **`coverage` full credit needs density, not just ratio.** A fabricator owns `startedAt` and
   `endedAt`, so a ratio of a window they chose is free. Density, not duration — `presenceDwell`
   already charges for duration and counting it twice is the mistake the guards elsewhere in
   that file exist to prevent.
7. **`approachDeparture` is DELETED.** It punished the behaviour the app instructs, and once the
   penalty reached 0 it could only add — paying a fabricator who synthesises two extra
   coordinates and paying the compliant participant nothing.
8. **The "no decorative signals" test now asks whether a signal can make a verdict STRICTER**,
   not merely different. `approachDeparture` had been passing the old version for its whole life.

**Verified rather than assumed.** 536 tests pass. Live against compose: a task authored at 120 s
produced "against an expected 2 min" and auto-verified at 88. Fixture standings — honest 88 / 88
/ 88, gappy honest 66 / 43 / 32 needs_review, and every forgery below the line: tight-cluster 71,
laundered 71, four-ping ladder 70, minimal short-task 62, padded 56, frozen override 19 rejected.

**Open.**

- **`presenceFor` treats client-controlled `accuracyM` as a FENCE EXTENSION**, so reporting 90 m
  accuracy turns a 120 m fence into a 210 m one. Pre-existing, not introduced here, and the
  cheapest attack in the system: stand across the road, inflate accuracy, score 88. The fix is
  to make the error ball shrink confidence rather than widen the fence.
- `clockSkew` is a pure honest-participant tax — an attacker sets `capturedAt = Date.now()` free.
- `jitterFingerprint` −45 assumes GNSS drift; network positioning legitimately repeats a centroid.
- `presenceDwell` integrates `receivedAt`, so a fully offline visit still scores as absence.

### 2026-09-09 - fix/opaque-evidence-key

**What.** `evidenceKey` is validated against the object store's contract instead of
`@IsMongoId()`. Photo upload works again once a real bucket is configured.

**Why.** D-033. Reported from live use: uploading a photo succeeded, then submitting the report
failed with "evidenceKey must be a mongodb id".

**Files.**

- `apps/api/src/evidence/storage/object-store.ts`: `EVIDENCE_KEY_PATTERN`, defined beside the
  interface that promises keys are opaque.
- `apps/api/src/reports/dto/create-report.dto.ts`: `@Matches` instead of `@IsMongoId`.
- `apps/api/src/reports/dto/create-report.spec.ts`: 7 tests pinning both shipped key shapes.
- `apps/web/src/api/client.ts`: the key is URL-encoded on the read path.

**Now true.**

1. **THE SEAM: a config change broke a code path no test and no local run touched.** GridFS keys
   are ObjectIds; S3 keys are `<sessionId>.<uuid>`. Every test ran on GridFS, the deployed demo
   ran on GridFS, and the DTO's `@IsMongoId()` was true of both — until credentials turned the
   other store on. The `ObjectStore` interface had said "opaque to every caller" since D-028 and
   a caller was not honouring it.
2. **The key-shape rule lives with the interface, not the DTO.** A future backend is then
   validated by the contract it implements rather than by whichever caller was written first.
3. **Format validation is hygiene; `assertBelongsTo` is the control.** The pattern only bounds
   length and charset and forbids `/` and `..`, because the value reaches a URL path and a
   `Content-Disposition` header. Whether the key may be used is still decided by asking the
   store which session it was uploaded against.
4. **Both shipped key shapes are now pinned by tests**, so a third backend cannot silently break
   submission the way the second one did.

**Verified rather than assumed.** 543 tests pass. Against compose running on the S3 store, the
exact reported flow: upload returned
`6a9fbe97966ecc34c3f75f3e.c5bf46d7-f008-496f-95aa-55d9c9528d7d`, submit returned **201** where it
previously returned 400, and the business console read the photo back byte-identical.

**Open.** Unchanged: `presenceFor` still treats client-controlled `accuracyM` as a fence
extension, which is the cheapest remaining attack on the engine.

---

### 2026-09-09 - docs/reviewer-guide

**What.** The submission's documentation, aimed at someone who has never seen this repo.
`docs/ASSESSMENT.md` is new: the system design writeup the brief asks for as its own
deliverable, plus a direct answer to each question it raises and an improvement analysis across
frontend, backend, security and features. `README.md` gains a "For the reviewer — start here"
orientation with a code map, real Cloudflare R2 viewing instructions, and one consolidated
account of how to exercise the flow locally, on Docker and live.

**Why.** The brief lists five deliverables, and three of them were being answered implicitly by
"read the whole repo". A grader who cannot find the design writeup has not been given one. The
ASSESSMENT file is separate rather than folded into the README because the brief treats the
writeup and the decision log as distinct artifacts, and the README already had 18 sections.

**Files.**

- `docs/ASSESSMENT.md`: new. Six sections — what the system is, the three decoupling seams and
  why each is load-bearing, the brief's questions answered, where the AI got it wrong, the
  improvement analysis by area, and a deliverables map naming the five decisions worth reading.
- `README.md`: new reviewer section at the top with the code map; the evidence-storage table
  corrected from GridFS to R2 with dashboard navigation and the two key shapes explained; the
  Testing section rewritten to cover the automated suite *and* the manual flow in all three
  environments; `docs/ASSESSMENT.md` linked from the documentation table.

**Now true.**

1. **The deployed demo stores photos in Cloudflare R2, not GridFS.** Confirmed live rather than
   assumed: `GET /health` returns `{"evidence":{"backend":"s3","ok":true}}`. The README said
   GridFS, which stopped being true when the credentials were set. `/health` is the
   authoritative answer to "which store is this instance using" and is now documented as such.
2. **`docs/ASSESSMENT.md` is the entry point for a reviewer**, and the README's first section
   routes there. If the answers there and the code disagree, the code is right and the file is
   stale — every number in it was checked against the source before it was written.
3. **The numbers in the docs are verified, not remembered.** 543 tests / 22 suites, 117 in
   `engine.spec` alone, 8 signals (not 9 — the first draft said nine and the source said
   otherwise), 6 session states, thresholds 75 / 30, `ACCURACY_CAP_M` 100, `MAX_PINGS_PER_SESSION`
   4000, 33 decisions, 35 memory entries, 4 AI notes.
4. **Two limitations are now stated in the graded documentation, not just in code comments:**
   `presenceFor` treating client-controlled `accuracyM` as a fence extension, and
   `sophisticatedSpoof` scoring 88. Both are conceded deliberately — the second is the same
   trace as an honest visit, so anything that moved it would move honest visits too.

**Open.** The RTL Arabic pass has still never been looked at on a real device. Evidence photos
still have no retention rule while pings expire at 30 days; the correct shape is a sweep calling
`bucket.delete()`, not a TTL index, which on GridFS strands the chunks.

### 2026-09-09 - feat/participant-dashboard

**What.** The participant surface stopped being one screen. It now has a history of every visit
they have ever been assigned with its released outcome and the reviewer's feedback, an in-app
notification inbox on its own SSE stream, and a bottom nav between the two. Reviewers write a
second, participant-facing text. Assigning shows a confirmation dialog instead of only a banner.

**Why.** D-034 (what a participant is told), D-035 (notifications derived from the work). D-035
reverses the "Not building: Notifications" line in `docs/BACKLOG.md` — recorded rather than done
quietly, the same shape as D-026 reversing the evidence-upload cut.

**Files.**

- `apps/api/src/participant/outcome.ts` + `.spec.ts`: the release rule, PURE, 21 tests. The
  mirror of `state-machine.ts` in intent — the code where being wrong is silent.
- `apps/api/src/participant/participant.service.ts`: every participant read, scoped to the
  token's subject. Batched `$in` per collection, never per row.
- `apps/api/src/participant/participant.controller.ts`: `@Controller('me')`. No id in any path.
- `apps/api/src/participant/participant-events.service.ts`: per-participant pub/sub + replay.
- `apps/api/src/participant/participant.spec.ts`: 22 tests, boundaries and release-through-HTTP.
- `apps/api/src/session/terminal-reason.ts`: D-019's derivation extracted from `SessionsService`
  so the history screen shares it rather than copying the prose.
- `apps/api/src/db/schemas/task-session.schema.ts`: `assignmentSeenAt`, `outcomeSeenAt`,
  `latestResultAt`, and `{ participantId: 1, createdAtServer: -1 }`.
- `apps/api/src/db/schemas/report-verification.schema.ts`: `feedbackToParticipant`, and
  `{ sessionId: 1, at: 1 }` on `reviewActions`.
- `apps/api/src/admin/admin.service.ts`, `console/console.service.ts`,
  `verification/evaluator.service.ts`: three announce call sites, all fire-and-forget.
- `apps/web/src/participant/ParticipantApp.tsx`, `History.tsx`, `NotificationBell.tsx`,
  `OutcomeChip.tsx`, `useNotifications.ts`; `VisitPage.tsx` reduced to the runner.
- `apps/web/src/hooks/useSseStream.ts`: the transport, extracted from `useVisitStream`.
- `apps/web/src/pages/TasksTab.tsx` (assign dialog), `Console.tsx` (second review field),
  `i18n/{en,ar}.json` (+32 keys each), `README.md`, `docs/DECISIONS.md`.

**Now true.**

1. **`outcome.ts` decides what a participant may be told, and it is the only thing that does.**
   Three callers feed it and none of them may shortcut it — `announceOutcome` re-derives the rule
   rather than trusting the caller, so a push cannot say something the screen would withhold. No
   score, no signal, no engine version can reach a participant through it, and a test asserts the
   returned key set to keep it that way.
2. **`rejected` with no human decision reads as `in_review`, not as a rejection.** The engine's
   verdict is not the organisation's decision. `auto_verified` DOES release, because otherwise a
   clean visit sits at "in review" for ever and the honest majority get the worst experience.
3. **A reviewer now writes two texts.** `note` stays required and internal (D-009's labelled
   data); `feedbackToParticipant` is optional and is the only part they read. Do not merge them.
4. **Notifications are DERIVED, never stored.** Only two `*SeenAt` markers persist. This means
   a notification cannot outlive the thing it describes — starting a visit makes its assignment
   notification disappear on its own, with nothing to clean up.
5. **`outcomeSeenAt` is a TIMESTAMP compared against the release time, not a flag.** A reviewer
   reversing an approval, or a re-run under a newer `engineVersion`, is a NEW decision; a
   set-once flag would have released it and never told anyone. `assignmentSeenAt` stays set-once
   because an assignment happens once.
6. **`.lean()` returns what is IN the document.** `default: null` applies at creation, so any
   session written before this branch has these fields ABSENT — and `undefined !== null` is
   true. The first draft therefore reported every existing visit as already seen and returned an
   empty inbox on the deployed database while passing every test against a fresh volume. Read
   them with `Boolean(...)`, and type them optional so the compiler cannot be talked out of it.
7. **A React effect must not fetch from inside a `setState` updater.** The first draft looked
   up the focused visit inside a `setCurrent` updater and called `load()` there when it missed.
   Updaters must be pure -- StrictMode invokes them twice, so that was two requests per intent
   -- and because `sessions` is a dependency that `load()` replaces, an id genuinely absent from
   `/sessions/mine` (a participant with more live visits than its limit returns) would have
   re-entered the effect on every response and fetched forever. The lookup now happens in the
   effect body and the reload is attempted at most once per id.
8. **Both participant screens stay MOUNTED, one hidden.** `useVisitTracker` lives inside the
   runner, so unmounting it to show the history would release the geolocation watch and the wake
   lock — a participant glancing at their record mid-visit would return to stopped capture and a
   coverage gap they did not cause. Same reason `DiscreetMode` is a sibling overlay.
9. **The participant stream is a separate service from the console's, deliberately.** They differ
   in the only thing that matters about either: the tenancy key. A generic `topic: string` would
   make the subject boundary a parameter, and the worst case here is reading another person's
   work history rather than a peer org's visit counts.
10. **Rule 6's discipline holds on this side too.** `ParticipantService` injects no `Ping` model.

**The schema-reviewer pass found two blockers again.** Item 6 above, and item 5 — neither
visible to a passing test suite, both fatal to the feature on the deployed database. Third pass
in a row that has earned its cost; run it on schema changes.

**Verified rather than assumed.** 587 tests pass. The whole chain was run against the compose
stack over real HTTP: assign → notification appears → visit runs → submit → review with
feedback → the participant sees `approved` and the feedback and NOT the internal note or the
reviewer id (asserted by string search on the response). The SSE push was confirmed by holding
the stream open with `curl` and assigning from another shell — the frame arrived. In a browser:
the bell badge, the bottom sheet, tapping a notification landing on the consent screen for that
visit, the history accordion with feedback and the echoed report, the whole thing in Arabic with
RTL, the assign confirmation dialog, and the two-field review form. Test data was destroyed with
`docker compose down -v` afterwards.

**Open.**

- **In-app only.** No Web Push, no service worker: a participant learns about work when they
  next open the app. Named in D-035 so the gap is deliberate.
- **The stream is in-process** (D-013). A second API replica splits it. The list is the truth
  and the push is an optimisation, so the failure mode is a late notification, not a lost one.
- **`{ participantId: 1 }` on sessions is now redundant** — the new compound index is a superset.
  It is KEPT: Mongoose creates indexes and never drops them, so removing the declaration would
  leave `participantId_1` on the deployed database for ever. Dropping it is a deliberate
  reconciliation in the style of `db/indexes.ts`, not a side effect of this branch.
- **`ReviewActionSchema` still has no `enforceAppendOnly` guard**, unlike `verificationResults`
  and `sessionEvents`. It is append-only by construction today — nothing updates one — but the
  rule 8 guard is missing and the fixtures that `deleteMany` this collection would have to move
  first. Raised, not done.
- **`npm run typecheck` was red on `dev` and is now green.** `review-findings.spec.ts:418` read
  `after.state` where the next line already wrote `after!.pingCount`; `.lean()` types the result
  nullable, so the whole `typecheck:tests` script failed. Pre-existing, confirmed by stashing
  this branch, and fixed here in its own commit rather than carried onto `main` — `main` is the
  deployed branch and promoting a red typecheck to it is worse than the one-character diff.
- No pagination on the history: 200 newest, and the screen says so when `assigned` exceeds it.
- Unchanged: evidence retention, deletion of authored objects, the reaper's timeliness.
