# Decision log

Decisions made during this build, with the alternatives considered and why they lost.
Newest at the bottom. Entries are never edited, only superseded.

The first five were made before any code was written. That is deliberate: the stack choices
here shape what the verification model can even do, so making them blind would have been the
wrong order.

---

## D-001: Model verification as a score with an evidence trail, not a boolean

**Date:** TODO
**Status:** accepted

**Decision.** Verification produces a score from 0 to 100, a verdict from
`auto_verified | needs_review | rejected`, and an array of signals each carrying a
human-readable reason. There is no boolean `verified` field anywhere in the system.

**Context.** The brief asks the business side to see "whether the visit looks legitimate."
From a web browser, presence at a location cannot be proven. Chrome DevTools overrides
geolocation in two clicks, and the web Geolocation API exposes no equivalent of the native
mock-location flag, so there is no way to detect it client side. Separately, honest consumer
GPS in an urban environment has roughly 7 to 13 m of horizontal error and degrades badly
indoors, which is where a mystery shop actually happens. A boolean claims a certainty that
neither the platform nor the physics supports.

**Alternatives considered.**

- *Boolean `verified` with a distance threshold.* The obvious answer, and the one most
  reference implementations in this space use. Rejected because it is dishonest: it cannot
  distinguish "definitely at the venue" from "no usable fix in the last twenty minutes", and
  it gives the business no way to tell a disputing participant why they were rejected.
- *Three-state enum with no score.* Simpler, and most of the value. Rejected because the
  banding thresholds need to be tunable without a code change once real data exists, and a
  bare enum throws away the information needed to tune them.

**Consequences.** The business console has to communicate uncertainty, which is more UI work
and a harder product conversation than a green tick. It also requires a human review queue for
the middle band, which is more surface area. Accepted, because the alternative is a system
that is confidently wrong.

---

## D-002: MongoDB over SQLite

**Date:** TODO
**Status:** accepted

**Decision.** MongoDB, Atlas M0 in production, a `mongo` container locally.

**Context.** Needed a datastore that is free to host for the demo, supports geospatial
queries, and has a retention story for raw location data.

**Alternatives considered.**

- *SQLite.* Attractive because it is zero-ops and genuinely free. Rejected on hosting: the
  free tiers this project targets have ephemeral filesystems and spin down after inactivity,
  so a SQLite file does not survive between a demo and a reviewer opening the link. It also
  has no geospatial indexing without SpatiaLite, which is not available on managed free
  hosts.
- *Postgres with PostGIS, on Neon or Supabase free tier.* Honestly the stronger technical
  fit. The data model here is relational (assignment to session to report to verification)
  and Postgres would enforce that in the database rather than in application code, and
  PostGIS is more capable than Mongo's 2dsphere. Rejected narrowly, for the reason in
  Consequences below.

**Consequences.** The decisive factor was the TTL index. Mongo expires raw location pings
automatically with a single index carrying `expireAfterSeconds`, which makes the data
retention limit a schema property rather than a cron job that can silently stop running.
Given that raw GPS traces are the most sensitive data in the system, having the purge be
structural is worth more here than referential integrity. The cost is that integrity between
collections is now enforced in application code and can drift. If this went to production I
would revisit and probably move to Postgres with an explicit retention job.

---

## D-003: NestJS for the backend

**Date:** TODO
**Status:** accepted

**Decision.** NestJS 10 with TypeScript and Mongoose, as a standalone API in `apps/api`.

**Context.** The security model of this app is entirely "the server does not trust the
client." That makes input validation and clear separation between pure logic and I/O the
central concern, not raw throughput.

**Alternatives considered.**

- *Express.* Fewer concepts, faster to start. Rejected because validation, dependency
  injection, role guards and scheduled jobs all become hand-rolled, and those four things
  are exactly what this app needs most. The boilerplate would have cost more than learning
  the framework conventions.
- *Next.js API routes, one full-stack app.* Fewer moving parts and one deploy. Rejected
  because the abandoned-session reaper needs a real scheduled process, and because folding
  the backend into the frontend would have made the pure verification engine harder to keep
  isolated from I/O.
- *FastAPI.* Closer to my own background and a better long-term home if verification grows
  into a model rather than rules. Rejected because it puts a second language and a second
  deploy target into a build with a three day budget, for no benefit visible in the slice.

**Consequences.** More framework ceremony than the problem strictly needs. In exchange, the
`@Sse()` decorator gives the "no manual refresh" requirement almost for free, `class-validator`
pipes let DTOs reject server-owned fields rather than silently ignoring them, and
`@nestjs/schedule` handles the reaper without a separate worker process.

---

## D-004: Server-Sent Events rather than WebSockets

**Date:** TODO
**Status:** accepted

**Decision.** The business console subscribes to completed visits over SSE, filtered by
client organisation.

**Context.** The brief requires the business side to see a completed visit "automatically once
the report is submitted, no manual refresh or trigger needed."

**Alternatives considered.**

- *WebSockets via Socket.io.* The default reflex. Rejected because the data flows one way
  only, server to dashboard. A bidirectional protocol adds a dependency, a heartbeat story,
  and a reconnection story for a channel that never carries client-to-server traffic.
- *Polling every few seconds.* Simplest, and honestly adequate at demo scale. Rejected
  because the requirement is explicitly about not needing a trigger, and because polling
  cost scales with the number of open dashboards rather than the number of events, which is
  the wrong direction.

**Consequences.** SSE has a browser connection limit per domain over HTTP/1.1, which is
irrelevant at this scale but would matter with many tabs. Browsers reconnect SSE natively,
so there is no reconnection code to write. If the dashboard ever needs to send data upstream,
this decision has to be revisited.

---

## D-005: Bounded evidence capture rather than continuous tracking

**Date:** TODO
**Status:** accepted

**Decision.** The participant keeps the tab open during the visit. The app captures a
high-quality fix at check-in, samples fixes opportunistically while the page is visible,
requests a Screen Wake Lock, buffers to IndexedDB when offline, and captures a fix at
check-out. Gaps in the trace are scored by a `coverageRatio` signal rather than treated as
failures.

**Context.** The brief says "from this point, their location should be tracked while the
session is active." On mobile web this is not achievable. `watchPosition` stops delivering
when the screen turns off or the tab is backgrounded, and browsers suspend background tabs
entirely after a few minutes. Keeping the tab open does not change this: locking the phone or
switching apps still stops updates.

**Alternatives considered.**

- *Implement continuous tracking as specified.* Rejected because it does not work. Building
  it would have produced a system that appears to track and silently does not, which is worse
  than one that is honest about its gaps.
- *Require the participant to keep the screen on for the whole visit.* Technically closer to
  the spec. Rejected on product grounds: a mystery shopper standing in a store holding a lit
  phone is conspicuous, which defeats the entire premise of mystery shopping. The tracking
  requirement and the covertness requirement are in direct tension and the brief does not
  acknowledge it.
- *Native app with background location.* The correct long-term answer. It also solves
  mock-location detection, which the web cannot. Rejected as out of scope for a web slice,
  and recorded as the top item in what I would build next.

**Consequences.** The verification model has to reason about missing data as a normal
condition rather than an error, which is more complex than a continuous trace would have
been. In exchange the system is honest about what it observed. This is the pushback I would
most want to discuss in the debrief.

---

## D-006: Pin TypeScript at 6.0.3 rather than the current 7.x

**Date:** 2026-09-07
**Status:** accepted

**Decision.** TypeScript `6.0.3` across all three workspaces, even though `7.0.2` is the
published `latest`.

**Context.** The instruction was to modernise the stack. Every other package went to its
current major. TypeScript is the one that could not, and the blocker is not taste: two
packages in the tree exclude 7.x outright. `ts-jest@29.4.12` declares
`typescript: ">=4.3 <7"`, and `@nestjs/cli@12.0.0` itself depends on `typescript: ~6.0.2`.
TypeScript 7 is the Go rewrite of the compiler and the decorator-heavy ecosystem this repo
sits in has not landed on it. Every layer here is decorator-driven, from `@Injectable()` to
`@Sse()` to every `class-validator` rule.

**Alternatives considered.**

- *TypeScript 7 with `@swc/jest` replacing `ts-jest`.* Genuinely clears the peer conflict, and
  Nest supports SWC officially. Rejected because SWC strips types rather than checking them.
  On a codebase whose entire premise is "the server does not trust the client", silently
  losing type checking in the test path trades away the thing being tested. It also leaves
  `@nestjs/cli` on TS 6 regardless, so we would be running two compiler versions.
- *TypeScript 5.9.3, the last 5.x.* Safe and boring. Rejected because 6.0.3 satisfies every
  peer range in the tree and is what the Nest CLI ships anyway, so there is no reason to give
  up a major for nothing.

**Consequences.** We are one major behind on the compiler and will stay there until `ts-jest`
widens its peer range. `moduleResolution: "node10"` is deprecated in 6.x and errors without an
`ignoreDeprecations` escape hatch, which is what pushed the whole repo to `node16` resolution —
that turned out to be the right move anyway. Revisit when `ts-jest` supports 7.

---

## D-007: The API is an ESM package, because NestJS 12 gives no alternative

**Date:** 2026-09-07
**Status:** accepted

**Decision.** `apps/api` and `packages/shared` are both `"type": "module"`. Relative imports
carry explicit `.js` extensions. Types imported from CommonJS dependencies must use
`import type`, never a value import.

**Context.** This was not a preference. NestJS 12 ships **no CommonJS entry point at all** —
`@nestjs/common`, `@nestjs/core`, `@nestjs/mongoose`, `@nestjs/config` and
`@nestjs/platform-express` are all `"type": "module"` with a single ESM path in `exports`.
Under `node16` resolution TypeScript reports TS1479 on every Nest import from a CommonJS file.
There is no configuration that makes a CJS API consume Nest 12.

**Alternatives considered.**

- *Stay on NestJS 11, which is CommonJS.* Everything would have worked with no extension
  discipline, no Jest ESM flags, and standard `ts-jest`. Rejected because the brief for this
  session was to modernise, and because Nest 11 is where this problem gets deferred rather
  than solved. Recorded honestly: this would have been the lower-risk choice for a three-day
  build, and it is the fallback if ESM costs us more than it has so far.
- *Keep source ESM but transpile to CommonJS for tests only.* Would have kept `ts-jest` in its
  default mode. Rejected because the pure tests would pass while any test touching Nest would
  fail at `require()`, which is the worst possible split: green where it does not matter, red
  where it does.

**Consequences.** Three ongoing costs. (1) Every relative import needs a `.js` extension, on a
file that is written as `.ts`. (2) Jest needs `--experimental-vm-modules`; we invoke
`node --experimental-vm-modules node_modules/jest/bin/jest.js` directly so it works on
PowerShell, cmd and sh without adding `cross-env`. (3) **Named imports from CommonJS
dependencies compile and then throw at runtime** — `import { Connection } from 'mongoose'`
type-checks cleanly and dies with "does not provide an export named 'Connection'", because
Node's `cjs-module-lexer` cannot statically detect it. This was caught by the scaffold smoke
test, not by the compiler. The rule for the rest of the build: **`import type` for types from
CJS packages, default-import-plus-property-access for runtime values.** Mongoose and rxjs are
both CommonJS and both will hit this.

---

## D-008: Demo authentication with real authorization boundaries

**Date:** 2026-09-07
**Status:** accepted

**Decision.** Authentication is a hardcoded list of demo accounts — `admin`, `business`, and
`user1` through `user10`, all with the password `demo1234`. Login returns an HMAC-signed token.
There is no user collection, no password hashing, no registration, no refresh tokens, no
password reset. **Authorization, by contrast, is real**: a global deny-by-default guard, a
`@Roles()` guard, and one test per boundary as required by `CLAUDE.md` §5.

**Context.** Auth was absent from the backlog, from the decision log and from the design rules,
yet `JWT_SECRET` sat in `.env.example`, three roles are implied by the flow, and §5 mandates a
test per authorization boundary. That combination is how a build ends up with auth retrofitted
inconsistently across controllers written on different days. The budget is three days and none
of it is being graded on password storage.

**Alternatives considered.**

- *Real JWT with `@nestjs/jwt`, `@nestjs/passport` and `passport-jwt`.* The conventional answer.
  Rejected because it adds four dependencies and a registration/hashing/refresh surface to
  demonstrate something nobody doubts, and it would take a session that the verification engine
  needs more. Nothing in the brief asks for identity management.
- *No auth at all, with a role passed as a query parameter.* Cheapest. Rejected because it makes
  every authorization test meaningless, and the console filtering by client org would then be a
  suggestion rather than a boundary. The whole premise of this system is that the client is not
  trusted; shipping an app where anyone can claim to be an admin contradicts rule 2 in the most
  visible way possible.

**Consequences.** Credentials are public and in source control, which is correct for a demo and
catastrophic anywhere else — hence the loud comment in `demo-users.ts` and this entry. The
token is not a JWT, so nothing else can validate it, though it also has none of the `alg: none`
family of JWT footguns. Swapping in real auth later means replacing `AuthService.login` and the
demo user list; `AuthGuard`, `RolesGuard`, `@Roles()`, `@CurrentUser()` and every boundary test
stay exactly as they are. That seam is the reason this is defensible rather than lazy.

---

## D-009: Additive signal scoring from a neutral base, with weights that are admittedly arbitrary

**Date:** 2026-09-07
**Status:** accepted

**Decision.** The engine starts every visit at **50** and adds or subtracts a weighted
contribution per signal, clamped to 0..100. Nine signals. Bands come from config:
`>= 75` auto-verified, `< 30` rejected, the rest to human review. The weights were reasoned
about, not measured, and this entry says so rather than dressing them up.

**Context.** D-001 committed to a score with an evidence trail. That leaves the actual
question open: how do signals combine into a number? There is no labelled data — no set of
visits known to be genuine or fraudulent — so nothing here is fitted. It is a prior.

**Alternatives considered.**

- *Start at 0 and accumulate positive evidence.* The obvious shape. Rejected because it makes
  "no evidence" identical to "proven absent", which directly contradicts D-005: gaps are a
  normal condition on mobile web, not proof of anything. Starting at the middle of the band
  means a visit we learned nothing about lands in `needs_review`, which is the honest answer.
- *Multiplicative confidence, or a probability product.* More principled-looking, and it
  composes badly: one signal near zero annihilates the score regardless of the rest, and with
  hand-picked rather than fitted factors that is a landmine, not a feature. It would also
  imply a calibrated probability, which is exactly the overclaim D-001 exists to avoid.
- *A hand-written decision tree.* Easy to explain, and it was tempting. Rejected because
  every threshold becomes a cliff, and the review band — the thing that makes D-001 work —
  is much harder to express as a region than as a range on a scalar.

**Consequences.** Three, and the first is the one to raise in a debrief.

1. **The score is ordinal, not a probability.** It ranks visits for triage. A 74 and a 76 are
   not meaningfully different, and the system must never render it as "76% likely genuine".
2. **Balance is load-bearing and was initially wrong.** The first weights let positive signals
   sum to +72 over a base of 50, so an honest trace clamped at 100 and the clamp silently
   absorbed every penalty: a teleport of 9.6 km in 30 s still scored 92 and auto-verified.
   Positives are now capped so a perfect honest visit lands at 90, leaving real headroom for
   negatives to bite. The lesson is that in an additive model the *ceiling* is a weight too.
3. **Signals must not restate one another.** `noUsableEvidence`, `presenceDwell` and
   `coverage` all fired on a trace with no usable fixes, counting one fact three times and
   burying the real reason under two derived ones. The latter two now return null when there
   is no usable evidence. Any new signal has to be checked for this.

**What would make it principled.** A few hundred visits labelled by the review queue, then
fit the weights by logistic regression and calibrate the bands against a chosen
false-accept/false-reject trade-off. The review queue is the data collection mechanism; that
is a large part of why D-001 insisted on it. Until then these numbers are a starting point
that is honest about being one.

---

## D-010: Findings from the first spoof-adversary pass, and what was changed

**Date:** 2026-09-07
**Status:** accepted

**Decision.** Six changes to the engine in response to the red-team pass required by
`CLAUDE.md` §6, plus seven constraints handed forward to `feat/ping-ingest`. The finding that
mattered most was not an attack — it was that the engine punished honest participants harder
than it punished forgers.

**Context.** The adversary pass found an attack **cheaper than the documented limit in D-009**.
No script: type a venue coordinate into DevTools Sensors, wait five minutes, nudge the last
decimal, switch the override off, then let the real phone supply the rest of the trace from
wherever you actually are. It scored **78, auto-verified** — and it outranked `honestWithGaps`
at 72. A forgery beat the honest visit it was imitating.

The cause was mine: `dwellSeconds` credited the full interval between two consecutive `inside`
fixes with no cap, while `coverageRatio` capped gaps at three sampling intervals. The
docstring said "we did not observe the middle, so we do not claim it" and the code claimed it
anyway. Worse, `honestWithGaps` credited 360 s of pocketed gap as dwell, so **the bug was
baked into a fixture labelled honest** and no test could see it.

**Alternatives considered.**

- *Raise the auto threshold from 75.* Would have suppressed this attack and every honest visit
  with it. Rejected: the attack scored 78 because the arithmetic was wrong, not because the
  band was loose. Moving the goalposts hides a bug instead of fixing it.
- *Leave `clockSkew` as it was and accept the false positives.* Rejected once it was clear the
  signal is inverted: `abs(receivedAt - capturedAt)` measures **queue latency**, so an honest
  participant flushing after ten minutes underground paid, while an attacker setting
  `capturedAt = Date.now()` paid nothing. It taxed precisely the offline buffering rule 4
  exists to make safe.

**What changed.**

1. **Dwell intervals capped** at the same maxGap coverage uses. The attack drops 78 → 60,
   `needs_review`. `honestWithGaps` drops from 480 s of dwell to the 210 s actually witnessed.
2. **`approachDeparture` softened from -18 to -6** and reworded from an accusation to "could
   not be corroborated". `CLAUDE.md` §1 describes the honest flow as "starts a visit session,
   keeps the tab open while on site, ends the session" — start-inside, end-inside. The old
   weight sent **the modal honest visit** to manual review. The fixture asserting that was
   renamed from `noApproachNoDeparture` to `startedAndEndedOnSite`, because it was never a
   spoof. The one-sided case now costs -2 instead of nothing, which closes the toggle-off gap.
3. **`clockSkew` only fires at the extreme.** The middle band returns null. The statistic that
   would actually catch a forgery is the *variance* of skew across a trace — a forger's latency
   is suspiciously constant — and that is a follow-up, not a guess to make now.
4. **`teleport` no longer skips pairs sharing a server timestamp.** `if (seconds <= 0) continue`
   silently disabled the movement check for every fix in a batch. It also now runs over usable
   fixes only, so one cached cell-tower fix cannot fire a -30 penalty on an honest trace.
5. **`proximity` uses the same accuracy tolerance as the presence rule.** Previously a fix could
   be `inside` for dwell while proximity called it "well outside the geofence", putting two
   contradictory sentences in front of a business user about the same visit.
6. **`medianAccuracyM` is computed over usable fixes only**, and `Math.min(...spread)` /
   `Math.max(...spread)` were replaced with `reduce` — a long offline flush would have thrown
   `RangeError` and stalled the outbox on permanent retry.

**Consequences.** Two findings are accepted rather than fixed, and both should be raised in a
debrief rather than buried.

- **The decorative-signal gate is partly circular.** Three fixtures were written specifically
  to give weak signals a decisive margin, so the gate proves those fixtures exist, not that the
  signals matter in production. It still catches a genuinely dead signal; it does not prove
  relevance. Real traffic is the only fix.
- **The highest-value missing signal is server-side network evidence** — coarse IP region and
  ASN, and especially a mid-session ASN change. It is the one class of evidence a browser
  cannot forge, and it is absent from the evidence contract entirely. A free VPN defeats naive
  IP-region matching, but a free VPN also puts the request on a datacentre ASN, which is itself
  the tell. Not built here; it is the strongest candidate for the next verification slice.

**Handed forward to `feat/ping-ingest`** (each of these is an attack if got wrong):
`receivedAt` must be stamped **per fix, inside the loop, never per batch**; `accuracyM` must be
rejected at `<= 0` and **must not be rounded** (Android reports quantised repeats, and rounding
would trip the `distinct === 1` branch on honest traces); `capturedAt` must be bounded against
the session window; idempotent upsert must be **first-write-wins** (`$setOnInsert`, not `$set`)
so a re-flush cannot rewrite a stored fix; pings accepted only while the session is `active`;
fixes per session capped; and `venue.radiusM` bounded in the schema, because a 5000 m radius
auto-verifies the city. `batchFlushedHonestVisit` exists as an executable form of the first one.

---

## D-011: No 2dsphere index on venues, and GeoJSON storage anyway

**Date:** 2026-09-07
**Status:** accepted

**Decision.** Venue coordinates are stored as a proper GeoJSON `Point` in `[lng, lat]` order,
but **no 2dsphere index is created**. The backlog listed one; it is deliberately not here.

**Context.** D-002 cited geospatial querying as a reason to choose MongoDB, and the backlog
scheduled a 2dsphere index on this branch. Neither survives contact with the design that was
actually built. Rule 7 computes distance with haversine in pure code, inside the verification
engine, because that code has to stay free of I/O. Rule 6 keeps the business console off the
ping collection entirely. Between them there is **no query anywhere in this system that a
2dsphere index would serve** — not the evaluator, not the console, not the participant app.

**Alternatives considered.**

- *Create the index anyway, as the backlog said.* It is one line and venues are a tiny,
  rarely-written collection, so the write cost is close to zero. Rejected because "close to
  zero cost" is how a schema accumulates cargo: the next person reads a 2dsphere index,
  reasonably assumes something does a `$near` query, and goes looking for it. An index is a
  claim about how the data is read, and this one would be false.
- *Store plain `lat`/`lng` numbers and skip GeoJSON too.* Simpler for the haversine code,
  which wants two numbers. Rejected because it makes the index a migration rather than a
  one-liner, and because `[lng, lat]` ordering is a bug you want to make once, in one place,
  behind accessors — not rediscover later under time pressure.

**Consequences.** If a proximity query ever appears — a "venues near me" picker in the admin
form is the likely first one — it needs one `VenueSchema.index({ location: '2dsphere' })` and
nothing else, because the storage is already correct. Until then the schema does not pretend
to support a query nobody makes. This also weakens one of D-002's stated reasons for choosing
MongoDB, which is worth saying out loud: the geospatial argument in that entry did not survive,
and the TTL argument, corrected in D-002's own consequences and implemented in
`apps/api/src/db/indexes.ts`, is the one actually doing the work.

---

## D-012: Findings from the first schema-reviewer pass, and what was changed

**Date:** 2026-09-07
**Status:** accepted

**Decision.** Twelve changes to the data model in response to the review required by
`CLAUDE.md` §6. Two were blocking. One correction to the reviewer, recorded because a
half-true validator is worse than a documented gap.

**Context.** The pass ran against the schemas, the TTL reconciliation, the seed and their
tests, with the D-010 constraints as the checklist.

**The two blocking findings.**

1. **`rollups` was `type: Object`** — unvalidated Mixed, on the one document the console is
   allowed to read (rule 6) and which is permanent (rule 8). A missing `minDistanceM`, a
   typo'd `dwellSecs` or a `coverageRatio` of −4 all wrote silently, and the console would
   render blanks forever with no repair short of a re-run. The shape had **already drifted
   inside the branch**: a test wrote `rollups: {}` and passed. Now a real sub-schema, every
   field required and bounded, with the two genuinely-nullable fields explicit.
2. **The TTL index had two owners.** `PingSchema` declared it with a hardcoded 30-day literal,
   so Mongoose's `autoIndex` issued its own `createIndex` concurrently with the boot-time
   reconcile using `PING_RETENTION_DAYS`. Whichever landed second either conflicted — surfaced
   on the model's `index` event, which nobody listens to, so swallowed — or silently won. The
   effective retention window depended on a race while the log claimed the configured value
   either way. This is precisely the failure `indexes.ts` was written to prevent, restated one
   layer up, and the tests structurally could not see it. The index is now declared in exactly
   one place and the schema exports only its name.

**Also changed.** `timestamps` removed from `Ping` (its `createdAt` duplicated `receivedAt`
and put a *third* clock into a design whose premise is exactly two); a `{state, startedAt}`
index added because the hard-cap timer reads `startedAt` while the abandon scan filters on
`lastSeenAt`, so a still-pinging session over its cap never appeared in any scan; `NaN`
rejected on `score` (both `NaN < 0` and `NaN > 100` are false, and the path that produces it
is reachable); signal `code`/`contribution`/`reason` all required (rule 1 was accepting
`{code: 'x'}`); **append-only enforced with a pre-hook on `verificationResults` and
`sessionEvents`** rather than resting on everyone remembering it; `MAX_PINGS_PER_SESSION`
with the atomic-update requirement documented for ingest; unique indexes behind the seed's
upsert keys; a ceiling as well as a floor on `PING_RETENTION_DAYS`; `outbox.lastError` capped.

**The seed was destroying its own demo.** Sessions were created `pending` with
`lastSeenAt = now` under `$setOnInsert`. Fifteen minutes after the first `docker compose up`
the reaper marked all ten `abandoned` — terminal — and re-running the seed could not revive
them, because the insert never fired again. The only recovery was `docker compose down -v`.
The clocks are now `$set` on every run, which also makes re-seeding the documented way to
reset a stale demo.

**Where the reviewer was wrong, and why it is recorded.** It argued that having declined the
2dsphere index (D-011) we owed a coordinate validator, since a 2dsphere index rejects
malformed GeoJSON for free — and gave `[29.3759, 47.9774]` (the Kuwait pair swapped) as the
motivating example. The validator was added and is worth having, but **it does not catch that
example**: lng 29.4 / lat 48.0 is a perfectly valid point in Ukraine, and no range check can
distinguish it from an intentional venue. It does catch swaps for any venue whose longitude
exceeds 90°, which is most of Asia and the Pacific. Rather than claim more, there is now a
test named for the gap. Closing it properly means bounding venues to an operating region,
which is a product decision, not a schema one.

**Consequences.** Deliberately not done, and each is a real exposure: the outbox has no lease,
so a worker that dies mid-row leaves `status: 'processing'` forever and that visit is never
verified and never retried — the silent-failure class §5 exists for, and it belongs to
`feat/report-and-outbox`. The venue config is read live at evaluation time rather than
snapshotted onto the session, so an admin editing `radiusM` between a visit and its evaluation
mixes two vintages in one verdict. The console list still needs a per-row join for the verdict;
denormalising `latestVerdict` onto `Session` would collapse it to one indexed query without
violating rule 8. And ids are `String` rather than `ObjectId` throughout, which costs roughly
double on the leading field of every ping index — consistent, deliberate, and not worth
churning now, but it is a cost on the hot collection rather than an oversight.

**Verified on the real target, not just in tests.** The reviewer flagged that Atlas M0 is a
shared tier that restricts some admin commands and that `collMod` should be checked before
merging rather than after. It works: the retention window was narrowed 30→7 days and widened
back on the live M0 cluster, both through `collMod`, with the privacy warnings firing.

---

## D-013: In-process SSE fan-out with a replay buffer, and fetch instead of EventSource

**Date:** 2026-09-07
**Status:** accepted

**Decision.** The live visit feed is an in-process RxJS subject with a 50-event replay buffer
per organisation. The browser reads it with `fetch` and a ReadableStream rather than the
native `EventSource`, and tracks `Last-Event-ID` explicitly.

**Context.** D-004 chose SSE and asserted that "browsers reconnect SSE natively, so there is
no reconnection code to write." That is true of the transport and false of the requirement.
On reconnect the browser sends `Last-Event-ID`; a server that ignores it drops every event
from the gap, and "the visit appears with no refresh" is the one thing the brief explicitly
asks for. Two further things only show up off localhost: free-tier platforms sit behind
buffering proxies that hold a stream until their buffer fills, and those proxies drop idle
connections at around 30-60 s -- and a visit feed is idle most of the time by nature.

**Alternatives considered.**

- *Native `EventSource`.* The obvious choice, and it handles reconnection and `Last-Event-ID`
  for free. Rejected because **it cannot send an `Authorization` header.** The workarounds are
  putting the bearer token in the query string, where it lands in access logs, proxy logs and
  browser history, or converting the whole app to cookie auth for the sake of one endpoint.
  Reading the stream with `fetch` keeps the header and costs about thirty lines, and it makes
  `Last-Event-ID` explicit rather than magic.
- *A Mongo change stream or Redis pub/sub for fan-out.* Correct for more than one API
  instance. Rejected as premature: this build runs one container, and a change stream would
  add a second failure mode and an ordering story for no visible benefit in the slice.
- *Polling the visit list every few seconds.* Genuinely adequate at demo scale and already
  rejected in D-004. Worth restating that the reason is the requirement wording, not
  performance.

**Consequences.** The fan-out is **single-instance**. A second API replica would leave each
console connected to one process and seeing only the visits that process evaluated — this is
the first thing that breaks under horizontal scaling, and the fix is a change stream or Redis.
The replay buffer is bounded at 50 events per org and lives in memory, so a client
disconnected for longer than 50 visits, or across a restart, silently misses the overflow; the
list endpoint on mount is the backstop. `X-Accel-Buffering: no` and a 20 s comment heartbeat
are both required for the stream to survive a proxy, and neither is testable on localhost —
verified against the deployed URL is the only way to know.
