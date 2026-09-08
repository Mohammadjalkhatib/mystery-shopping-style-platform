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
