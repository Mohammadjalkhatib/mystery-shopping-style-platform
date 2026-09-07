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
