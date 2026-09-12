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
**Status:** accepted; the authentication half superseded by D-037, the login-page account list
removed by D-038, the authorization half stands

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

---

## D-014: localStorage for the offline buffer, and a deterministic demo org id

**Date:** 2026-09-08
**Status:** accepted

**Decision.** Two things the participant flow forced, neither of which was the plan.

**1. The offline buffer is `localStorage`, not IndexedDB.** The backlog specified IndexedDB.
What the requirement actually needs is: survive a reload and a period offline, then flush
safely. The payload is a few hundred fixes of five short fields -- single-digit kilobytes
against a ~5 MB limit, and `MAX_PINGS_PER_SESSION` bounds it structurally. IndexedDB would buy
async writes and a far larger ceiling, and cost an async wrapper, a schema version, an upgrade
path and a set of failure modes, for data that is deleted minutes later.

The safety property is not the storage engine. It is that `clientPingId` is generated ONCE at
capture time and stored with the fix, so a flush that runs twice is a server-side no-op
(rule 4, first-write-wins). That holds identically in either store. Revisit if evidence upload
or a much longer visit lands.

**2. The seeded organisation has a deterministic string `_id`.** It was a generated ObjectId
while the demo accounts carried the literal `'org-alfa-retail'`. The tenancy filter compares
those two values, so it never matched: **a reviewer signing in as `business` saw an empty
console for every seeded visit.** `ClientOrg._id` is now a string, and the seed and the demo
users share one constant.

**Alternatives considered.**

- *IndexedDB as specified.* Rejected above. Recorded rather than silently substituted, because
  deviating from a written requirement without saying so is how a reviewer loses trust in
  everything else in the document.
- *Make demo users look up the seeded org at boot.* Would also fix the id mismatch. Rejected
  because it makes the auth module depend on seed data having run, which is worse than a
  shared constant, and it would fail differently on an unseeded database.

**Consequences.** `localStorage` is synchronous, so a very large buffer would block the main
thread on write -- the ping cap is what keeps that theoretical. A string org `_id` is
inconsistent with the ObjectId ids used elsewhere, which is mildly ugly and was already flagged
in D-012 as a cost worth naming rather than churning.

**The part worth saying plainly:** the org-id mismatch was invisible to all 353 tests, because
every test builds its own data with a self-consistent org id. It only exists where two
internally-correct subsystems meet, which is exactly the demo a reviewer opens. It was found by
running the actual flow end to end against the real database, and nothing short of that would
have found it. The same run also caught `@IsNumber({ maxDecimalPlaces: 6 })` rejecting honest
fixes, because `8.6 + 2 * 1.4` is `11.399999999999999` and every test fixture had used tidy
numbers. Two seam bugs, one probe.

---

## D-015: The seed only touches sessions that never started

**Date:** 2026-09-08
**Status:** accepted

**Decision.** The seed creates a session for an assignment that has none, and re-clocks a
session that is still `startedAt: null`. A session that has ever started is left completely
alone — no state reset, no clock rewrite.

**Context.** D-012 made the seed `$set` `state: 'pending'` and both clocks on every run, so a
demo session the reaper had abandoned off its idle clock could be revived. That fix was aimed
at sessions that never started, but it was written to apply to all of them. The result,
caught by the first completed `docker compose` run: a `down` + `up` on a preserved volume
re-seeds and **resurrects submitted sessions into a state the state machine cannot produce** —
`state: 'pending'` carrying `startedAt`, `endedAt` and `pingCount: 9`, with reports, outbox
rows, session events and verification results still pointing at them. The business console
showed 2 visits before the restart and 0 after.

The corruption is worse than the disappearance. A resurrected session can be `start`ed again,
and the evaluator builds evidence from every ping for a `sessionId`, so the next verdict would
be computed over **a merged trace from two different visits** — and rule 8 makes results
append-only, so a second result lands under the same `engineVersion` with no way to tell which
visit it describes.

**Alternatives considered.**

- *Keep the reset, but make it complete: also clear `startedAt`, `endedAt`, `pingCount`,
  `venueSnapshot`, `latest*`, and delete the dependent pings, reports, events, outbox rows and
  verification results.* This is the honest version of "re-seeding resets the demo", and it
  was the closer call. Rejected because a seed script that issues cascading deletes across six
  collections is a liability the moment anyone points it at a database with real visits in it,
  and because the thing being deleted is the reviewer's own evidence that the system works.
  Destroying it on the documented start command is the wrong default.
- *Insert an additional pending session per used assignment, so there is always something
  openable.* Keeps history and keeps the demo replenished. Rejected because `assignmentId` is
  `unique: true` on `sessions` and `GET /sessions/mine` returns a single session; allowing many
  per assignment is a data-model change to solve a problem ten assignments already solve.
- *Filtered upsert on `{ assignmentId, startedAt: null }` in one atomic call.* Rejected on a
  mechanical detail: when the filter misses, the upsert attempts an insert and hits the unique
  index on `assignmentId`, so the normal path is an `E11000` caught and swallowed. Read-then-
  write is one extra round trip in a script that runs once and is obvious to read.

**Consequences.** Re-running `docker compose up` is no longer a demo reset — `docker compose
down -v` is, and the README has to say so. A reviewer who completes all ten demo visits gets
nothing new to open until they do that. The seed now reports how many sessions it preserved,
so "the console is not empty and no new session appeared" reads as a deliberate outcome rather
than a broken seed. D-012's actual requirement survives: a pending session abandoned off its
idle clock never started, so it is still revived.

The narrower rule is `startedAt === null` rather than a list of states, because that is the
property that matters — a session with a `startedAt` has evidence attached, whatever state it
now reports.

---

## D-016: Deploy to Render's free tier, and keep the API awake with an external pinger

**Date:** 2026-09-08
**Status:** accepted

**Decision.** The API deploys to Render as a free Docker web service, the web app as a Render
static site, and MongoDB stays on the Atlas M0 that already exists. A free external cron
(cron-job.org or UptimeRobot) hits `/health` every 10 minutes so the service never sleeps.

**Context.** Deployment is not cosmetic here, it is the only way to test the largest unknown
in the project. `navigator.geolocation` and the Screen Wake Lock API are both refused on an
insecure origin, so **the participant flow has never run on a phone** — the permission prompt,
the wake lock and iOS Safari's tab suspension are all unverified, and no amount of local work
changes that. It must be HTTPS, and it should be free.

The free tier landscape in 2026 is much thinner than it was: Fly.io removed free allowances in
2024, Koyeb's free tier is now a Postgres database with no standing free compute, and Railway
is credits-only. That leaves Render and Google Cloud Run.

The other hard requirement is SSE. `GET /console/stream` holds a connection open for the life
of the console (D-004, D-013), which rules out anything whose free tier is a short-lived
serverless function — Vercel Hobby caps a function at 60 s, so the stream would drop and
reconnect every minute for the whole demo.

**Alternatives considered.**

- *Google Cloud Run.* Technically the better platform: a genuine always-free allowance
  (2M requests/month), far faster cold starts than Render, and request timeouts up to 60
  minutes, which suits SSE well. Rejected because it **requires a credit card on file** to
  create the billing account. It stays free, but asking a reviewer to attach a card to open a
  demo is a worse first impression than a slow first load, and this is an assessment
  submission rather than a product.
- *Two services on Render, API and web both as web services.* Rejected on arithmetic. Render
  grants 750 instance-hours per month per workspace and a 31-day month is 744 of them, so the
  allowance covers exactly ONE permanently-awake service. A static site is free and consumes
  none of it, so the web app is always instant and the whole allowance goes to the API.
- *Accept the 15-minute sleep and document the cold start.* The honest minimal option, and it
  costs nothing. Rejected because a reviewer's first click would sit for 30-60 seconds against
  a blank screen, which reads as a broken deployment rather than a free tier — and the same
  first impression is what D-014's org-id bug would have produced.
- *Serve the static bundle from the Nest API, one service and no CORS.* Genuinely simpler, and
  it removes the second URL. Rejected because it puts the web app behind the sleeping service:
  the cold start would then block the page loading at all, instead of only the first API call,
  and there would be nothing on screen to explain the wait.

**Consequences.** The demo depends on an external pinger that is not part of this repository,
and if it stops the service sleeps again — a dependency worth naming rather than hiding. One
awake service consumes essentially the whole monthly allowance, so a second always-on free
service is not available on this workspace. Render free instances are 512 MB and 0.1 CPU, so
this would not survive load; it is sized for a demo and nothing more. Atlas M0 must allow
`0.0.0.0/0` because free Render services have no static outbound IP, which is acceptable only
because the database holds seeded demo data behind its own credentials.

**This also decides the reaper**, which was the open question in the backlog. On a free tier
that sleeps — or that stays up only while a third-party cron keeps pinging it — an in-process
cron is not a mechanism you can assert anything with: a missed ping, an exhausted allowance or
a redeploy stops it silently, and `SESSION_ABANDON_AFTER_SECONDS` is 900, the same order as
the idle window. Lazy-on-read reaping is deterministic, costs nothing while idle, and cannot
drift out of sync with the hosting. Recorded here rather than in the reaper's own entry
because the hosting is what settles it.

---

## D-017: A business user authors their own work; admin is not the only author

**Date:** 2026-09-08
**Status:** accepted

**Decision.** `POST /venues`, `/tasks` and `/assignments` admit both `admin` and `business`.
Only `/venues` takes a `clientOrgId` at all: a business user's comes from the verified token
and naming a different one is a 403, while an admin, who has `clientOrgId: null`, must name one
and it must exist. A task inherits its org from its venue and an assignment from its task, so
neither DTO has the field — the parent document is the authority, and a task whose org
disagreed with its venue's would be readable by one tenant and geofenced against another's.

**Context.** CLAUDE.md §1 describes the flow as "an admin creates a task", so admin-only was
the obvious reading. But the tenancy model already says a business user owns exactly one org
and the console is theirs, and they are the party who actually knows their own venues,
addresses and geofence radii. A platform admin authoring every venue for every client is an
operational bottleneck invented by the permission check rather than by the product.

**Alternatives considered.**

- *Admin only.* Matches the sentence in the brief literally and needs no per-role branching on
  `clientOrgId`. Rejected because it makes the demo worse in the way that matters: the reviewer
  signs in as `business`, sees a console, and still cannot create anything — which is exactly
  the gap this work exists to close. It also leaves `business` a strictly read-only role, which
  makes the tenancy boundary untestable on any write path.
- *Let the caller name `clientOrgId` in every case and check it against the token.* One code
  path instead of two. Rejected because it puts a tenancy-deciding field in the request body
  for a role that has no business setting it, which is rule 2 read backwards — the safe shape
  is a field the business user cannot express at all, not one that is validated after the fact.

**Consequences.** Two authorization shapes to test rather than one, and the DTO for an admin
is not the same DTO as for a business user — `clientOrgId` is conditionally required, which
`class-validator` expresses awkwardly and which the service therefore resolves rather than the
DTO. An admin can still write into any org, so admin remains the role worth protecting; there
is no approval step or audit trail on authoring, which a real deployment would want.

---

## D-018: Creating an assignment creates its pending session, in one transaction

**Date:** 2026-09-08
**Status:** accepted

**Decision.** `POST /assignments` writes the assignment and a `pending` session for it inside
a single `withTransaction`, the same pairing the seed already performs.

**Context.** `/sessions/mine` reads the session collection, not assignments. An assignment
with no session is therefore invisible to the participant it was created for — the work exists
in the database and nothing in the product can reach it. The seed has always created the pair
together; an admin surface that created only half would produce a state the seed cannot and
that no screen explains.

**Alternatives considered.**

- *Create the session lazily, when `/sessions/mine` first reads it.* Removes the transaction
  and self-heals a half-written assignment. Rejected because it puts a write — and the entry
  point of the state machine — inside a read path taken on every participant page load, and it
  gives a session a `createdAtServer` that depends on when somebody happened to open the app,
  which is the clock the abandon timer runs off.
- *Two sequential writes, no transaction, relying on the unique indexes to make a retry safe.*
  Cheaper, and `(taskId, participantId)` and `sessions.assignmentId` are both unique so a retry
  is genuinely idempotent. Rejected because nothing retries: a failure between the two writes
  leaves an assignment that is permanently invisible, with no error anyone would see and no
  screen that lists assignments without sessions to notice it from.

**Consequences.** Authoring now requires a replica set, like report submission already does
(rule 9) — fine on Atlas M0, in the compose stack and under `MongoMemoryReplSet`, but it means
a standalone `mongod` can no longer run the admin surface, and that failure is invisible until
someone tries. Re-assigning the same task to the same participant is refused by the unique
index rather than being treated as an update, so there is no way to move an assignment between
participants; deleting and recreating is the only path, and neither is built.

---

## D-019: The reaper sweeps on participant AND console reads, and says which timer fired

**Date:** 2026-09-08
**Status:** accepted

**Decision.** `GET /sessions/mine` sweeps that participant's overdue sessions; `GET
/console/visits` and `/visits/counts` sweep the org's. Both `await` the sweep before reading,
so the response reflects it. A reaped session carries a `terminalReason` in plain words, and
`/sessions/mine` keeps showing terminal sessions for 24 hours so the participant can read it.

**Context.** D-016 settled the mechanism — lazy-on-read, not a cron, because on a free tier
that sleeps a cron stops silently and `SESSION_ABANDON_AFTER_SECONDS` is the same order as the
idle window. It did not settle which reads trigger it, and that turns out to decide whether the
feature works at all.

**Alternatives considered.**

- *Participant reads only.* The surgical version: state is corrected exactly where it is
  observed, and no write ever enters the console's read path. Rejected because it does not
  work — abandonment IS the participant not coming back, so the trigger never fires for the
  sessions that most need it. The console would show an `active` visit that died hours ago, and
  the one thing the reaper exists to prevent is the thing it would fail at.
- *A small batch swept on every authenticated request.* Nothing can go stale, and it is the
  closest thing to a cron that is not one. Rejected because it puts a write in the path of ping
  ingest, the hottest route in the system, and makes reaping latency depend on unrelated
  traffic — a session's fate would hinge on whether somebody else happened to be using the app.
- *A generic "this visit has ended" message.* Less copy, and one string to translate for the
  Arabic pass. Rejected because `dueEvent()` already distinguishes expiry from abandonment, and
  the document distinguishes three kinds of abandonment — never started, went quiet mid-visit,
  ended but never filed. Throwing that away leaves a participant unable to tell whether they
  did something wrong.

**Consequences.** Every console list now costs one extra indexed query, and a business user's
read performs writes — defensible because the write is to `sessions`, which the console already
reads, so rule 6 is untouched, but it is a read path with a side effect and that is worth
knowing. Reaping is only as timely as the next read: a session that nobody looks at stays
`active` in the database indefinitely, which is correct for a demo and would not be for
billing or payouts. The sweep is capped at 100 sessions per read, so the first read after a
long outage may take several passes to settle. And the participant's list now shows dead
visits for a day, which is a small step towards a history screen this deliberately is not.

---

## D-020: Refuse a venue coordinate coarser than the geofence it defines

**Date:** 2026-09-08
**Status:** accepted

**Decision.** `POST /venues` rejects coordinates whose implied precision is worse than half the
radius. A value written to `d` decimal places locates a point to within half a unit of the last
place, so the check is arithmetic on how the number was written, not on the number itself. In
practice: three decimals for a wide fence, four for anything tighter.

**Context.** A venue was created at `31.98, 35.83` with a 25 m radius. Two decimals locate a
point to within about 557 m, so that fence could not be entered from anywhere on earth. The
participant stood in the right shop; the system measured 4,789 m and rejected the visit. Every
layer was correct — capture was flawless that run, 7 fixes at a 30 s cadence, 100 % coverage,
3–6 m accuracy — and the verdict was still wrong, because the number it measured against was.
This is the project's recurring failure shape: a seam where two correct things meet, and no
test can see it because no test invents the coordinate.

**Alternatives considered.**

- *Demand a fixed number of decimal places, say five, for every venue.* One rule, no arithmetic,
  trivially explained. Rejected because it is wrong in both directions: five decimals is
  needless ceremony for a 500 m fence around a mall, and it says nothing about *why*, so the
  next person to widen the radius has no idea whether the rule still applies.
- *Warn in the UI and let the server accept it.* Keeps the API permissive and the fix cheap.
  Rejected because the UI is not the only writer — the seed and any future import go through
  the same service, and this failure is silent and expensive precisely because it produces a
  plausible-looking venue that reads as an engine bug months later.
- *Infer the venue location from the pasted Google Maps link.* It is what the user actually had
  on their clipboard, and it would remove the retyping entirely. Rejected for now: a
  `maps.app.goo.gl` short link only resolves by following a redirect, which the browser will
  not allow cross-origin and which would make venue creation depend on a third party being up.
  The form detects the link and says what to do instead.

**Consequences.** A legitimate venue that genuinely sits on a round coordinate cannot be entered
as written and has to be given more decimals, which is a small lie about precision — accepted,
because the alternative is accepting a fence nobody can enter. The threshold of half the radius
is a judgement call, not a derived constant; what would make it principled is data on how far
recorded venue coordinates sit from where participants actually stand, which is the same
labelled data D-009 wants and this project does not have. The check does not run against
existing venues, so a bad coordinate already in the database stays bad until someone edits it —
and there is still no way to edit one.

---

## D-021: Venues can be corrected, and ingest measures against the session's snapshot

**Date:** 2026-09-08
**Status:** accepted

**Decision.** `PATCH /venues/:id` corrects a venue in place. To make that safe, ping ingest now
computes `distanceM` and `presence` against the session's `venueSnapshot` rather than the live
venue, falling back to the live venue only for sessions that predate the field. A venue cannot
change organisation.

**Context.** D-020 stopped a bad coordinate being created but left the one already in the
database unusable, with no way to fix it. Adding an edit path exposed a latent bug: D-012 pinned
`venueSnapshot` at `start` and switched the *evaluator* to it, but ingest was still reading the
venue live. So the evaluator took the venue from the snapshot while consuming per-fix
`distanceM` and `presence` values measured against whatever the venue looked like when each fix
arrived. One edit mid-visit would put two vintages of geofence into a single trace — the exact
failure D-010 item 5 and D-012 each fixed one half of. Without this, venue editing would have
been a one-click corruption of any visit in progress.

**Alternatives considered.**

- *Correct the coordinate directly in the database and build no endpoint.* Fixes the immediate
  problem in one command and adds no surface. Rejected because it makes a database console a
  required part of operating the product: the next wrong venue — and there will be one, because
  the coordinate is typed by a human — needs the same intervention.
- *Delete and recreate the venue instead of editing it.* No new invariants, and create is already
  precision-checked. Rejected because tasks, assignments and sessions reference `venueId`, so a
  recreate orphans all of them and the wrong venue stays in the list for ever next to its
  replacement.
- *Recompute stored pings when a venue moves.* Would make old traces consistent with the new
  geofence. Rejected outright: it rewrites evidence after the fact, which is the thing
  `venueSnapshot` and rule 8 both exist to prevent. A visit is judged against the fence it was
  run under, and a correction applies from the next visit onward.
- *Let a venue move between organisations.* Rejected: tasks, assignments and sessions each carry
  their own `clientOrgId`, so re-homing the venue alone would split one visit across two tenants
  with nothing downstream noticing. The field is absent from the DTO, so it is a 400 rather than
  a silently ignored value.

**Consequences.** A correction does not fix visits already run against the wrong fence — their
verdicts stand, correctly, because they describe what was measured at the time. Re-running the
evaluator on them would not change anything either, which is right but will surprise someone.
There is still no venue delete, and no edit for tasks or assignments. The ingest fallback path
for snapshot-less sessions is untestable in production because every session created since
D-012 has one; it is covered by a test and should be deleted once no such sessions remain.

---

## D-022: A hand-written dictionary and document direction, no i18n or RTL library

**Date:** 2026-09-08
**Status:** superseded in part by D-024 — the no-library decision stands, the TypeScript file
format and the participant-only scope do not

**Decision.** The Arabic pass is a typed object of about ninety strings, a context that swaps
the dictionary and the theme's `direction` together, and `document.documentElement.dir`. No
`i18next`, no `stylis-plugin-rtl`. The API gained a `terminalReasonCode` so the one
server-composed sentence a participant sees can be said in Arabic too.

**Context.** CLAUDE.md scopes this to "participant screens get an Arabic pass, nothing more",
and every dependency needs a reason. The participant flow is four screens and one language pair.
`theme.ts` was already written with `direction: 'ltr'` and an Arabic family in the font stack,
so the groundwork assumed something like this.

**Alternatives considered.**

- *`i18next` + `react-i18next`.* The default answer, with plurals, interpolation, namespaces and
  lazy-loaded bundles. Rejected because every one of those features is for a problem this does
  not have: two languages, one namespace, no runtime loading, and a plural rule set that is
  avoided entirely by writing "Locations recorded: 3" instead of "3 locations". It would be two
  dependencies and a config file to replace fifteen lines of `replaceAll`.
- *`stylis-plugin-rtl` for mirrored styles.* The conventional way to flip an emotion app.
  Rejected after checking what actually needs flipping: `document.dir` already handles text
  direction, alignment, flex order and logical properties, MUI v9 components follow it, and this
  app's own `sx` is spacing shorthands rather than physical `marginLeft`. A plugin to mirror
  styles that are already direction-agnostic is a dependency bought on reputation.
- *Leaving `terminalReason` as the server's English.* Cheapest, and the string is already
  written. Rejected because it is the only server-composed sentence a participant ever reads,
  and leaving it would produce a screen that is Arabic everywhere except the line explaining why
  their visit was closed — the worst possible sentence to leave untranslated.
- *Translating the business console too.* Rejected as out of scope by CLAUDE.md section 9. It is
  an internal tool for a business user, and the verification signal reasons it displays are
  composed on the server in English; doing it properly means codes and parameters for all nine
  signals, which is the "full i18n" that was explicitly cut.

**Consequences.** Adding a third language means editing a TypeScript file and shipping a new
bundle, with no lazy loading — fine at this size, wrong at ten languages. There is no plural
machinery, so any future copy has to keep being written count-neutrally or it will be subtly
wrong in Arabic. The console and every signal reason stay English, so a business user reviewing
an Arabic participant's visit reads English evidence. Numerals are Western digits, not
Eastern Arabic — correct for Jordan and the Gulf, wrong if this ever ships to a market that
expects ٠١٢. And the RTL claim rests on inspection rather than a plugin: a future component
using `marginLeft` directly will not mirror, and nothing will fail to warn about it.

---

## D-023: A capture watchdog that only ever re-attaches a watch

**Date:** 2026-09-08
**Status:** accepted

**Decision.** While the page is visible, if `watchPosition` has not called back at all — no fix
and no error — for three sampling intervals, the watch is presumed dead and re-attached. It
never runs while the page is hidden, never invents a fix, and never back-fills a gap. Restarts
are counted and shown to the participant.

**Context.** On a 50 minute drive the capture layer produced four fixes at a perfect 30 s cadence
and then two isolated fixes in the remaining 48 minutes. Whether the watch died or the screen was
simply off is not answerable from the trace, and that is the actual defect: the design treats a
missing fix as a gap rather than an error, which is correct for scoring and blind for diagnosis.
A stuck watch and an honest dark screen are indistinguishable from the inside.

**Alternatives considered.**

- *Fix nothing until a deliberate lock/unlock test says whether the watch really dies.* The
  disciplined answer, and the test is five minutes. Rejected because the design is the same
  either way — a watch that has said nothing while visible should be re-attached whether that
  happens often or never — and the test would only tell us how often it fires, which the restart
  counter now reports from real use instead.
- *Restart on a missing FIX rather than a missing callback.* Simpler, and it needs no extra
  bookkeeping. Rejected because a receiver that cannot get a lock still fires the error callback
  on its 20 s timeout: it is alive and struggling, and restarting it would throw away a warm
  watch every time someone walked into a basement.
- *Poll `getCurrentPosition` on a timer instead of watching.* Removes the failure mode entirely
  by never holding a long-lived watch. Rejected because it is worse on battery, ignores movement,
  and would replace a bug that shows up as missing evidence with one that shows up as a flat
  battery mid-visit.
- *Restart while hidden too.* Rejected outright. A silent watch on a locked screen is correct
  behaviour, the OS would refuse anyway, and recording anything there would claim observation
  that did not happen — which is the one thing this whole system is built not to do.

**Consequences.** The watchdog cannot distinguish "the watch died" from "this device genuinely
cannot see a satellite for ninety seconds", so a participant in a basement will accumulate
restarts that fixed nothing; the 30 s floor bounds the cost but the count will read as alarming
when it is merely honest. It also cannot help while the screen is off, which is where most of
that 48 minute hole probably came from — this narrows the ambiguity rather than removing it.
And it is still unverified against the failure it was written for: nothing here has been run on
an iPhone.

---

## D-024: Translations move to two JSON files, and cover the whole app

**Date:** 2026-09-08
**Status:** accepted, supersedes the format and scope halves of D-022

**Decision.** `en.json` and `ar.json` hold every user-facing string in the web app — participant
flow, business console and admin surface — nested by area and addressed by dotted key. English
is the source of truth: `TranslationKey` is derived from it, so a key that does not exist is a
compile error. Still no i18n library; D-022's reasoning there is unchanged.

**Context.** D-022 scoped the Arabic pass to the participant screens because CLAUDE.md section 9
said "participant screens get an Arabic pass, nothing more". The user asked for the whole site
and for the content as two editable files they can copy to other dialects. A TypeScript object
is a bad artifact to hand someone who is translating rather than programming: it cannot be
opened by a translation tool, and editing it risks breaking the build in ways a non-developer
cannot diagnose.

**Alternatives considered.**

- *Keep the TypeScript dictionary and hand over an export.* No build changes, and the type
  safety is stronger. Rejected because an export is a copy: the moment it is edited it has
  diverged from the source, and the whole point is that the file the user edits is the file the
  app ships.
- *One flat file of dotted keys.* Simpler lookup, no recursion, and the key names read the same.
  Rejected because a flat list stops being navigable at about eighty entries and there are now
  over a hundred and forty; nesting by area is what lets a translator find "everything the
  consent screen says" without searching.
- *Keep the console in English.* What D-022 decided, and defensible — it is an internal tool.
  Overridden by the user's request. Worth noting the cost is now visible in the product: the
  console chrome is Arabic while the verification signal reasons inside it are English, because
  those are composed on the server. That is a real seam and it is not fixed here.

**Consequences.** Type safety is now derived from a JSON file, so a malformed edit surfaces as a
confusing type error somewhere else rather than at the line that broke. Runtime lookup replaces a
compile-time property access, which is why `t()` falls back to English and then to the key itself
— a missing string must never blank a screen mid-visit. Adding a dialect means copying `ar.json`
and registering it in one place; nothing lazy-loads, so every language ships to every user.
Server-composed strings — the nine verification signal reasons, and API error messages — remain
English regardless of locale, which is the honest limit of what this change achieves.

---

## D-025: A discreet screen for the participant, which does not imitate a lock screen

**Date:** 2026-09-08
**Status:** accepted

**Decision.** A button on the active-visit screen puts up a full-screen dark overlay showing a
clock and a dim line saying the visit is still running. Hold for 800 ms to dismiss. It is an
overlay only: no timer pauses, no fix is suppressed, no state changes.

**Context.** Capture requires the tab to be open and visible (D-005) — a backgrounded tab is
throttled and the watch is released. So the app's honest advice has been "keep this page in front
of you", which for a mystery shopper means standing in a store holding a bright screen headed
"Your visit / Capturing / 12:04 on site". The requirement the product actually has is to be
inconspicuous to shop staff, and the app was working against it.

**Alternatives considered.**

- *Faithfully imitate the iOS or Android lock screen* — carrier row, wallpaper, notification
  stack, slide to unlock. The most convincing cover, and what was asked for. Rejected on three
  grounds: cloning system UI is the visual grammar of a phishing screen and a bad habit to build
  into a product; it breaks cosmetically every time an OS restyles, on devices we cannot test;
  and it is unnecessary, because a dark screen with a clock already reads as an idle phone to
  anyone glancing at it. The requirement is "not obviously a working app", not "indistinguishable
  from a locked phone".
- *A blank black screen with nothing on it.* Simplest and most concealing. Rejected because a
  participant cannot then tell whether their phone is recording, asleep or crashed — it conceals
  from the user as well as the bystander, and this system's one consistent rule is that it does
  not deceive the person using it.
- *Tap anywhere to dismiss.* Fewer instructions. Rejected because a phone in a pocket taps
  constantly; hold-to-dismiss is what survives the situation the feature exists for.
- *Actually pause capture while the cover is up.* Rejected outright: the participant would be
  standing in the venue producing no evidence, which turns the feature that helps them do the job
  into the reason their visit is rejected.

**Consequences.** The screen stays lit and bright-ish, so it saves no battery and is not
invisible in a dark room — it is cover, not camouflage. Anyone who picks up the phone dismisses
it by holding, so it protects against a glance and not against handling. It has been reasoned
about but not observed on a real phone in a real shop, which is the only test that matters and
has not been run. And it slightly weakens the honesty of the visit screen: the participant now
has a supported way to make the app look like it is not running, which is defensible only
because the line saying it IS running never leaves the screen.

---

## D-026: Evidence photos live in GridFS, not S3, and are replaced rather than accumulated

**Date:** 2026-09-09
**Status:** accepted, reverses the storage half of the plan in CLAUDE.md §4

**Decision.** The single report photo is stored in MongoDB GridFS, one object per session, behind
a narrow service interface. Uploading again deletes the previous object; submitting a report
deletes anything that session uploaded and did not reference. Nothing in the repo speaks S3.

**Context.** CLAUDE.md §4 said object storage would be S3-compatible — MinIO locally, R2 in
production — and evidence upload was then cut entirely and recorded as out of scope. Reversing
that cut needs storage that works *now*: R2 credentials do not exist, and a feature that cannot
be demonstrated on the deployed URL is not delivered. Atlas is already provisioned, already a
replica set, and already the thing being backed up.

**Alternatives considered.**

- *S3 via presigned PUT to R2.* The documented plan, and the right answer at any real volume:
  object storage is cheaper per byte, scales past a database, and keeps large blobs out of the
  working set. Rejected for now purely on availability — it cannot be built, tested or deployed
  without a bucket and keys. The service interface is deliberately narrow (`store`, `read`,
  `deleteForSession`, `assertBelongsTo`) so an S3 adapter replaces this file without touching a
  caller.
- *Base64 in the report document.* No new collections and no GridFS. Rejected outright: MongoDB
  documents cap at 16 MB, base64 inflates by a third, and it would put a multi-megabyte blob
  inside a document the console reads on every detail view.
- *Keep every uploaded photo.* Simplest, and an audit trail of attempts. Rejected because the
  schema-reviewer traced the exhaustion path: Atlas M0 is 512 MB for the whole database, images
  do not compress, and roughly 120 photos fills it. Evidence never expires while pings do, so the
  floor only ratchets up. What breaks first is not uploads — Atlas refuses writes database-wide,
  so the first symptom is ping ingest failing, three layers from the cause.

**Consequences.** Photos consume the same 512 MB as everything else, so the demo has a real
ceiling — one object per session keeps it in the low hundreds of visits rather than dozens, and
that is a demo-grade answer, not a production one. **Photos do not expire, while location pings
do** (rule 10), which is an asymmetry worth naming: a photo taken inside a venue is at least as
identifying as a coordinate. A TTL index is specifically the wrong fix — it would delete the
file document without cascading to `evidence.chunks`, leaving the bytes in the database for ever
and no longer reachable through the GridFS API to be removed. A retention sweep calling
`bucket.delete()` is the correct shape and is not built. The consent screen now says the photo
is kept with the report rather than leaving the participant to infer it from the sentence about
location data.

---

## D-027: The dashboard answers "which checks keep failing", not "how many visits"

**Date:** 2026-09-09
**Status:** accepted

**Decision.** The console's Overview tab is five stat tiles, a stacked bar of verdicts per day,
and a ranked bar chart of the signals that most often cost visits their score. Rendered as
inline SVG with no charting dependency, on a three-colour status palette re-stepped for charts.

**Context.** "Graphs in the admin dashboard" had no prior specification — none existed and none
had been discussed. The reference the user pointed at frames its reporting around *recurring
failures* and *smart scores* rather than volume, and that maps exactly onto something this system
already has and does not surface: every verdict carries an array of signals with reasons, and
nothing anywhere aggregates them.

**Alternatives considered.**

- *A pie chart of the verdict mix.* The obvious dashboard chart. Rejected because three slices
  is a table with extra steps — the tiles already carry the percentages, and a pie makes them
  harder to compare, not easier.
- *Visits over time as the headline chart.* Standard, and what most dashboards lead with.
  Kept, but demoted below the failure ranking: volume is a number a business user already knows
  from their own operations, whereas *which check is failing* is knowledge only this system has.
- *A charting library (Recharts, visx, Chart.js).* Faster to write and free tooltips. Rejected:
  every dependency here needs a reason, and a library is a large one for two static forms whose
  mark details — the 2px gap between stacked segments, rounded data-ends, recessive axes — are
  easier to control directly than to talk a library out of.
- *Reusing the brand green for the "auto-verified" series.* Rejected on measurement, not taste:
  at chroma 0.082 it FAILS the palette validator's chroma floor and reads as gray in a chart. The
  chart palette is re-stepped (`#0F7A55`) and passes all six checks. Chrome and data have
  different jobs; one value for both would mean one of them is wrong.

**Consequences.** The failure ranking counts only negative contributions, so a signal that
*awards* points never appears — correct for the question, but it means the chart is not a
complete picture of the engine's behaviour and should not be read as one. Aggregation runs on
every Overview load with no caching, bounded by the 30-day window and the existing
`{ clientOrgId, state, endedAt }` index; it will need caching before it needs a bigger index.
There is no date-range control yet, so 30 days is not adjustable from the UI. And the charts are
hand-built, which means responsive behaviour and accessibility are ours to maintain rather than a
library's — the legend, the direct labels and the full-slot hit targets are load-bearing, not
decoration.

---

## D-028: An S3 object store, hand-signed, chosen at boot — with GridFS as the fallback

**Date:** 2026-09-09
**Status:** accepted, supersedes the storage choice in D-026 wherever a bucket is configured

**Decision.** Evidence goes to an S3-compatible bucket when `S3_ENDPOINT`, `S3_BUCKET`,
`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are all present, and to MongoDB GridFS otherwise.
Both sit behind one four-verb `ObjectStore` interface. Requests are signed with a hand-written
SigV4 implementation; MinIO is back in `docker-compose.yml`, pinned.

**Context.** D-026 chose GridFS because no bucket existed and a feature that cannot be
demonstrated is not delivered. That reasoning has not changed for the deployed demo, which still
has no credentials — but locally there is nothing stopping MinIO, and the deployed answer should
be a config change rather than a code change the day R2 keys appear.

**Alternatives considered.**

- *`@aws-sdk/client-s3`.* The normal answer, and it handles retries, multipart and endpoint
  quirks that this does not. Rejected on CLAUDE.md §4, which says the code talks to the S3 API
  and never to a vendor SDK — and the trade is real: several megabytes and a vendor coupling for
  four verbs, against ~90 lines of signing that is pure and therefore testable without a bucket.
- *Switching entirely to S3 and deleting the GridFS path.* One code path instead of two.
  Rejected because it would break the live demo the moment it deployed: production has no
  bucket, and a required dependency that is not provisioned is an outage, not a migration.
- *Failing to boot when S3 is only partly configured.* Safer in the abstract. Rejected because
  it takes the whole API down over an optional feature; instead a partial config logs an ERROR
  and falls back. Falling back on ABSENCE is intended, falling back SILENTLY on a typo is how
  photos end up in MongoDB while the dashboard says MinIO — so that case is loud.
- *Keeping the S3 key in the URL as `sessions/<id>/<uuid>`.* Rejected after it actually broke:
  a route parameter does not match `/`, so every read 404'd and the cause read as a missing
  object rather than a routing rule. The bucket keeps its prefix — `listBySession` is a native
  prefix list, and a flat namespace would make replace-and-sweep a full bucket scan — while
  callers get a slash-free `<sessionId>.<uuid>`. The interface already promised the key was
  opaque; this is the store keeping that promise instead of leaking its layout into a URL.

**Consequences.** Two storage backends to keep behaviourally identical, and only one of them
runs in production — so the S3 path is exercised by `docker compose up` and by nothing else
until credentials exist. The signer is ours: SigV4 mistakes surface only as a bare `403
SignatureDoesNotMatch`, which is why the canonical request and string-to-sign are tested
directly rather than through a request. `listBySession` parses the list response with a regex,
which is fine for a flat list of keys and must be revisited rather than extended if pagination
is ever needed. MinIO adds two pinned images and a one-shot init container; there is
deliberately no healthcheck on minio itself, because recent images ship neither `curl` nor
`wget` and a healthcheck using either hangs `depends_on` for ever.

---

## D-029: Venue coordinates are picked on a map, with typing as the escape hatch

**Date:** 2026-09-09
**Status:** accepted

**Decision.** The venue form shows an OpenStreetMap slippy map with a fixed centre pin; dragging
the map sets the coordinate. Typing remains available behind a toggle. No mapping library —
about thirty lines of Web Mercator maths in `slippy.ts`, separately tested.

**Context.** Coordinates were typed, and D-020 exists because that went wrong in production:
`31.98, 35.83` put a venue 4.8 km from where the participant actually stood, and the visit was
correctly rejected while looking like an engine fault. The precision guard added there catches
imprecision after the fact; a map removes the way in, because a coordinate derived from a pin
cannot be imprecise or transposed.

**Alternatives considered.**

- *Link out to Google Maps and paste the numbers back.* What the user was already doing, and
  what the form's help text told them to do. Rejected because it is the exact workflow that
  produced the bad venue: the round trip through a clipboard is where precision is lost and
  where lat and lng get swapped.
- *Embed Google Maps.* The most familiar map, and the one the request named. Rejected on
  three counts: the JS API needs an API key and a billing account, which is a deployment
  dependency this project deliberately has none of; an `<iframe>` embed cannot report the
  chosen point back to the page at all; and the key would have to ship in the client bundle.
- *Leaflet or MapLibre.* Smoother inertia, pinch-zoom, markers. Rejected for now under the
  ask-before-a-dependency rule: ~150 KB to replace thirty lines of arithmetic, for one form.
  This is the honest place to change course — the moment this needs markers, layers or
  clustering, hand-rolling stops being the cheaper option.
- *A draggable pin instead of a fixed one.* Rejected on interaction, not effort: it needs
  click-versus-drag disambiguation, and on a phone the target ends up under the thumb covering
  it. Moving the map beneath a fixed pin has neither problem.

**Consequences.** The app now depends on `tile.openstreetmap.org` being reachable — the
attribution notice is required by their tile usage policy and is not decoration, and a
production deployment at real volume should use a paid tile host rather than the community
servers. Reported precision is capped by zoom (`decimalsForZoom`), so the form cannot claim a
millimetre from a view where a pixel is forty metres. There is no address search: finding a
venue means panning to it, which is fine for a demo and tedious for a hundred venues —
geocoding is the obvious next step and is not built. Pinch-zoom is not implemented; the
+/− buttons are the only zoom control on a phone.

---

## D-030: Address search via Nominatim, proxied through the API

**Date:** 2026-09-09
**Status:** accepted

**Decision.** The venue map gains a search box backed by OpenStreetMap's Nominatim geocoder,
called from `GET /geocode` on our own API rather than from the browser. The endpoint is
role-guarded to `admin` and `business`, serialised to one upstream request per 1.1 s, and caches
results for ten minutes. The client debounces at 450 ms and aborts in-flight requests.

**Context.** D-029 shipped the map with no way to find anything on it: locating a venue meant
panning from wherever the map happened to open, which is fine for the one venue you are standing
next to and useless for anything else.

**Alternatives considered.**

- *Google Places Autocomplete.* The best results, and the thing most people picture. Rejected
  for the same reasons the map itself is not Google Maps: it needs an API key and an active
  billing account, and a browser-side key ships in the bundle for anyone to lift. Nominatim is
  the same data source as the tiles already on screen, needs no key, and costs nothing.
- *Calling Nominatim directly from the browser.* One less endpoint and no outbound call from our
  service. Rejected on three counts, the first binding: their usage policy requires a genuine
  identifying `User-Agent`, and a browser will not let a page set that header. Second, the rate
  limit is per APPLICATION, and ten admins typing in ten browsers cannot coordinate a shared
  budget — it can only be honoured where requests converge. Third, it would hand every search
  term and the user's IP to a third party directly.
- *No rate limiting, just debounce.* Simpler. Rejected because debounce is per-browser and the
  limit is global; the server-side serialisation is the only thing that actually bounds it, and
  exceeding Nominatim's limit gets an application blocked rather than throttled.
- *Reverse geocoding, to show what is under the pin after dragging.* Genuinely useful. Rejected
  for now purely on request budget: it would fire on every pan, which is the one thing the rate
  limit cannot absorb.

**Consequences.** The API now makes outbound calls to a third party, so venue creation has a
dependency that can be down — the search reports itself unavailable and dragging still works,
which is why the map was built first and the search added second rather than the reverse.
Results are capped at six and cached in process, so a multi-instance deployment would hold one
cache and one rate limiter per instance and could exceed the upstream limit; that is fine at one
instance and needs a shared limiter before it is not. Nominatim's coverage of small businesses in
Jordan and the Gulf is thinner than Google's, so some venues will not be findable by name and
will still have to be located by dragging. The community servers are also not for production
volume — a paid Nominatim host or a commercial geocoder is the answer if this ships for real.

---

## D-031: A per-participant view that ranks attention, not guilt

**Date:** 2026-09-09
**Status:** accepted

**Decision.** `GET /console/participants` returns per-participant results — visit count, the
three verdict counts, pass rate, median score and their most frequent penalty — sorted worst
pass rate first. The People tab renders it under a banner saying plainly that it does not
identify dishonesty.

**Context.** Asked for as "who's working and who's cheating". The first half is a reporting
question this system can answer well. The second half is one it cannot answer at all, and D-001
is the whole reason: the platform does not claim to prove anyone was anywhere, so it certainly
cannot prove someone was not.

**Alternatives considered.**

- *A trust or honesty score per participant.* What the request literally asks for, and the
  number a client would most like. Refused, not deferred. A run of rejections is equally
  consistent with a participant inventing visits, a venue saved at the wrong coordinate — which
  has happened in this database (D-020) — and a phone whose GPS is poor indoors. A single number
  laundered from those into "honesty" would be acted on as though it were evidence, and the
  first person it accused would probably be the victim of a typo in a venue.
- *Only surfacing rejection counts.* Simpler, and it is the column people look for. Rejected
  because it is the column most likely to be misread on its own. The `topSignal` column is what
  makes the list diagnostic rather than accusatory: `proximity` failing every time is a
  different investigation from `coverage` failing every time — the first is about where someone
  was, the second about whether the app was ever on screen.
- *Grouping the signal aggregation by `participantId` in Mongo.* The obvious query. It was
  written that way first and it was wrong: `verificationResults` carries `sessionId` and
  `clientOrgId` and no participant. The pipeline would not have errored — every row would have
  collapsed under a `null` key and the column would have been one meaningless bucket. It joins
  through `sessionId` in the service instead.

**Consequences.** Pass rate is unweighted, so one visit at 100% sorts alongside twenty at 100%;
the visit count is displayed next to it precisely because the rate alone misleads at small n.
Ranking people at all is a product decision with teeth — a list sorted worst-first will be read
as a leaderboard of blame whatever the banner says, and the honest mitigation is that the banner
is specific about the alternative explanations rather than a generic disclaimer. The window is
fixed at 30 days with no control, and there is no per-venue breakdown, which is the cut that
most limits its diagnostic value: a participant who fails only at one venue is the single
clearest sign that the venue, not the person, is the problem.

---

## D-032: The task's dwell expectation is read, and the rules stop punishing honest behaviour

**Date:** 2026-09-09
**Status:** accepted

**Decision.** Four changes to verification. `expectedDwellSeconds` is resolved from the task
instead of the engine default. `accuracyRealism` tests the *dispersion* of reported accuracy
rather than its *level*. `presenceDwell` requires five separate inside-to-inside observations
before it pays in full. `approachDeparture` is deleted outright.

**Context.** Two reports from live use. A task authored with a one-minute dwell still told the
participant "against an expected 5 min" and failed them for it. And a real five-minute visit,
standing in the venue on a modern phone, scored 68 and went to review: −12 for reporting 7 m
accuracy indoors, −6 for starting the session on arrival. Both are the engine punishing people
for doing the job correctly.

**Alternatives considered.**

- *Leave `expectedDwellSeconds` on the engine default and delete it from the task form.* Honest
  about what the code did. Rejected because per-task dwell is the right model — a drive-through
  check and a full store audit are not the same job — and the field was already authored,
  stored, and displayed. The bug was that it was never read.
- *Keep the indoor accuracy threshold and just lower the penalty.* Least disruptive. Rejected
  because the threshold was measuring the wrong thing: level. Modern phones fuse GNSS with
  Wi-Fi and report 4–8 m indoors routinely, which is why it false-positived on three separate
  real honest visits — the only evidence this project has ever had about that signal, all of it
  saying the same thing. Dispersion catches what the branch was actually reaching for: a real
  receiver's estimate wanders, a generated one does not.
- *Keep `approachDeparture` as a bonus-only signal.* What the first attempt did: 0 for the
  "neither observed" case, +6 when both were. Rejected after the spoof-adversary pass showed it
  was then **strictly worse than deleting it** — a signal that can only add cannot cause a
  `needs_review` or a `rejected`, so it can never do the job the engine exists for, and a
  fabricator synthesising coordinates collects the bonus for free while the participant who
  followed our own instruction to start on arrival collects nothing. It paid the attacker more
  reliably than the honest user.
- *Raise the minimum `expectedDwellSeconds` to 240 s so the dwell cap cannot be out-run.* The
  adversary pass's own suggestion, and the simplest fix. Rejected because it answers a business
  question with an evidentiary constant: it would ban the one-minute task outright, which is a
  legitimate thing to want. The corroboration floor gets the same protection by making a short
  task cost more *observations* rather than more *time* — the visit stays short, it just has to
  be watched rather than asserted.

**Consequences.** `honestWithGaps` — a phone pocketed for six of twelve minutes, 58 % observed —
now lands in `needs_review` rather than `auto_verified`, and the fixture's expectation was
changed to say so. That is the honest answer for a visit two thirds of which nobody saw; it was
only clearing the threshold before on the strength of a bonus for being seen to arrive, which is
not evidence about the minutes that went unobserved. A genuinely short visit now needs about two
and a half minutes of sampling to earn full dwell credit, so a task authored at 60 s cannot be
satisfied by two pings — deliberate, and it means `expectedDwellSeconds` no longer controls the
evidentiary bar on its own. The dispersion test is a new false-positive surface: a stationary
Android reporting quantised accuracy could cluster tightly, which is the same failure mode the
ping DTO already warns about for rounding. And the engine still cannot stop a competent
forgery — `sophisticatedSpoof` sits at 88 — which D-001 conceded from the start; what it can do
is keep the incompetent forgery below the line, and these changes were checked against that
standard rather than against an impossible one.

**How this was checked.** The spoof-adversary pass was run TWICE, and both passes found real
holes in this work rather than confirming it.

The first pass found that the initial version of these changes flipped a fabricated indoor trace
from 68 to **88** without the attacker altering anything, and that a 60 s task let a three-fix,
two-minute forgery reach 88 as well. That produced the corroboration floor, the dispersion test
and the deletion of `approachDeparture`.

The second pass found four bugs in *those* fixes: `accuracyRealism` drew its spread from all
fixes while its median came from usable ones, so one junk `accuracyM: 250` disabled both negative
branches for the price of one ping; `(max − min)` is the least robust spread statistic there is
and one outlier defeated it; corroboration counted bare intervals, which is cadence-dependent, so
six pings in sixty seconds bought full credit while the honest client is throttled to one fix per
30 s; and `coverageRatio` is a ratio of a window the fabricator chooses, so four pings pinned it
at 100 %. Each is now closed, and the fixture set carries the attack that proves it.

Final standings: every honest fixture auto-verifies at 88 or lands in `needs_review` for a
reason a person can read; every forgery is below the threshold — the tight-cluster fabrication
71, the four-ping ladder 70, the padded trace 56, the frozen override 19; and under a 60 s task
the fast-cadence forgery scores 58. `sophisticatedSpoof` remains at 88 and must: it is
byte-for-byte an honest trace, and any change that moved it would move `honestOutdoor` with it.

---

## D-033: An evidence key is validated against the store's contract, not MongoDB's

**Date:** 2026-09-09
**Status:** accepted

**Decision.** `CreateReportDto.evidenceKey` is validated with a shape rule owned by the
`ObjectStore` contract — bounded length, no `/`, no `..` — instead of `@IsMongoId()`.

**Context.** D-026 stored evidence in GridFS, whose keys are ObjectIds, and the DTO validated
them as such. D-028 added an S3 store whose keys are `<sessionId>.<uuid>`, and the interface
already declared keys "opaque to every caller". Nothing failed, because the deployed demo had no
bucket. The moment R2 credentials were set, every upload succeeded and every submission
carrying its key was rejected with *"evidenceKey must be a mongodb id"* — a config change
breaking a code path neither the tests nor a local run touched.

**Alternatives considered.**

- *Make the S3 store issue ObjectId-shaped keys.* Would have restored the validator without
  touching it. Rejected because it inverts the dependency: the storage layer would be
  constrained by a DTO's idea of an identifier, and the session prefix that makes
  `listBySession` a cheap native prefix list would have to go with it.
- *Drop the validation entirely and rely on `assertBelongsTo`.* Defensible — the ownership check
  is the real control, and a key that does not exist fails there regardless. Rejected because
  the value reaches a URL path and a `Content-Disposition` header, so a bound on length and
  charset is worth having before it gets that far. Input hygiene, not authorization.
- *Keep the rule in the DTO.* Rejected because that is where it went wrong. The rule now lives
  beside the interface that promises opacity, so the next backend is validated by the same
  contract it implements rather than by whichever caller was written first.

**Consequences.** The pattern is permissive by design — it describes what a key may not be
rather than what it must be — so a malformed-but-well-shaped key now fails one step later, at
`assertBelongsTo`, with "That evidence does not exist" instead of at validation. That is the
correct place for it and a slightly less specific error. Any future store must issue keys within
this charset; one that wanted `/` would have to encode it, exactly as the S3 store already does.

---

## D-034: A participant is told an outcome and a person's feedback, never a score or a signal

**Date:** 2026-09-09
**Status:** accepted

**Decision.** Participants get their own dashboard showing every visit they have been assigned
and, for finished ones, a released **outcome** (`approved` / `not_approved` / `in_review` / …)
plus the reviewer's written feedback. They are never shown the score, the signals or the engine
version. The release rule is a pure function (`participant/outcome.ts`): a human decision
releases in either direction, `auto_verified` releases as approved with no feedback because
nobody had to look, and `needs_review` or `rejected` with no human decision stays `in_review`.
Reviewer feedback is a NEW optional field `reviewActions.feedbackToParticipant`, separate from
the existing required internal `note`.

**Context.** Direct user request: the participant should be able to track what they were
assigned and see the result and feedback once the business confirms. That forced two real
questions — how much of the verification result a checked person may see, and whether the
existing reviewer note becomes participant-facing. Both were put to the user; both went this
way.

**Alternatives considered.**

- *Show the score, or the score and the signals.* Genuinely more useful to an honest
  participant whose GPS was bad, and it is the same data the console already renders. Rejected
  because the signals ARE the anti-spoof rules: "your coverage ratio was 0.43" turns every
  attack the `spoof-adversary` agent has found into a cheaper one, and a numeric score is a
  gradient a spoofer can climb by trial. It also invites "why 61 and not 70", which D-009 admits
  the weights cannot answer.
- *Map `rejected` straight to `not_approved`.* One fewer state and it matches the engine.
  Rejected because the engine's verdict is not the organisation's decision — rule 1 says there
  is no boolean `verified`, and the corollary is that there is no automatic accusation either.
  An unappealable rejection nobody signed is the worst thing this system could tell someone.
- *Hold `auto_verified` until a human confirms.* Matches the request literally. Rejected
  because no human ever reviews a clean visit, so the honest majority would sit at "in review"
  for ever — the worst experience going to the people who did nothing wrong.
- *Reuse the existing `note` as the feedback.* Zero schema change. Rejected because candour is
  the first thing lost when the subject can read it, and D-009 needs that note candid as
  labelled data. Every note already stored was written under the old assumption, so reusing it
  would retroactively publish them.

**Consequences.** A participant who disputes an outcome has only the reviewer's sentence to go
on, and if the reviewer left it empty they have nothing — the system knows why and will not
say. That is a deliberate trade of transparency for spoof resistance, and it is the wrong one
if this ever grows an appeals process; the fix then is a disclosure on request through a human,
not a field on the screen. `feedbackToParticipant` is optional, so it will often be empty, and
the screen has to say "no written feedback was left" rather than pretend. Two text boxes on the
review form is more friction per review than one.

---

## D-035: Notifications are derived from the work, not stored as messages

**Date:** 2026-09-09
**Status:** accepted; reverses the "Not building: Notifications" line in docs/BACKLOG.md

**Decision.** A participant is notified when work is assigned and when a decision is released.
There is no notification collection: `GET /me/notifications` DERIVES the list from the
participant's own sessions, and the only persisted state is two markers on the session,
`assignmentSeenAt` and `outcomeSeenAt`. Delivery is a per-participant SSE stream that carries a
nudge to re-read, not the payload. `assignmentSeenAt` is set once; `outcomeSeenAt` is compared
against the release time so a superseded decision becomes unread again.

**Context.** `docs/BACKLOG.md` lists Notifications under "Not building". The user asked for
them directly, so this reverses that line rather than quietly ignoring it — same shape as D-026
reversing the evidence-upload cut.

**Alternatives considered.**

- *A `notifications` collection with a row per event.* The conventional answer, and the one
  that survives multiple API replicas. Rejected because it is a second copy of the truth that
  can drift from it: a stored "you were assigned Venue X" outlives the venue being renamed, the
  assignment being reassigned and the visit being completed, and then contradicts the screen
  underneath it. Deriving cannot go stale, and it made the whole feature two nullable dates.
- *Polling `/me/notifications` on a timer.* Simpler than a stream and survives replicas.
  Rejected because CLAUDE.md §4 says SSE and not polling, and the argument applies harder here
  than on the console: this stream is idle almost always — a participant is assigned work every
  few days — so a poll frequent enough to feel like a notification is a request every few
  seconds, all day, on a phone, to be told nothing changed.
- *A single set-once "seen" flag per session.* What the first draft did. Rejected during the
  `schema-reviewer` pass: a decision can be superseded by a second `reviewAction` or an
  evaluator re-run under a newer `engineVersion` (which rule 9 explicitly designs for), and a
  set-once flag means the reversal is released and the participant is never told.
- *Web Push / real device notifications.* What "notification" usually means. Not built: it
  needs a service worker, VAPID keys, a subscription store and a permission prompt, and it does
  not work at all unless the app is installed. Out of proportion to a thin slice, and named here
  so the gap is deliberate rather than assumed.

**Consequences.** Notifications only arrive while the app is open — this is an in-app inbox,
not a push notification, and a participant who closes the tab learns about new work the next
time they open it. The stream is in-process like the console's (D-013), so a second API replica
splits it; the list is the truth and the push is an optimisation, so the failure mode is a late
notification rather than a lost one. Deriving means `GET /me/notifications` costs a page of
history on every call rather than an indexed read of unread rows, which is fine at demo scale
and is the first thing to reconsider if a participant ever has thousands of visits.

---

## D-036: Tell the participant where they are, in states rather than metres

**Date:** 2026-09-10
**Status:** accepted

**Decision.** `POST /sessions/:id/pings` returns `latestPresence` — the four-state
`inside | near | outside | unknown` for the newest fix in the batch, computed on the server
against the session's pinned geofence snapshot — and the active-visit screen renders it as a
banner above the timer. It does **not** return `distanceM`, `nearBufferM` or a bearing. The
indicator warns and never blocks: being `outside` does not stop a participant ending the visit
or submitting a report.

**Context.** `docs/BACKLOG.md` listed a "live presence indicator" under `feat/participant-flow`
and it was never built. The server classified presence on the very first fix and told nobody:
a participant could stand in the wrong branch of a chain for an hour and learn about it days
later from a rejection. Raised by the user in exactly those terms.

**Alternatives considered.**

- *Show the distance in metres.* The most useful thing for an honest participant who is 30 m
  outside a 25 m fence. Rejected: it is a live oracle. Move, read, adjust — and with
  attacker-chosen `accuracyM` driving `presenceFor`'s tolerance term to nearly zero, each probe
  is a clean ternary on the boundary. See the consequences below for why this argument turned
  out to be weaker than it looks, and why the decision stands anyway.
- *Block the visit while outside.* Refuse to end or submit. Rejected: indoor GPS is unreliable
  by design — the `indoor` flag exists precisely because indoor venues report far worse accuracy
  — so blocking on a bad fix strands an honest participant standing inside the shop. The engine
  already scores where they were; the screen's job is to inform, not to adjudicate.
- *Collapse `unknown` into "not there".* Simpler copy, three states instead of five counting
  the not-yet-answered one. Rejected: `unknown` means the fix was too coarse to place, which is
  normal indoors and which the engine is explicitly told not to punish. Rendering it as absence
  would accuse people of a GPS problem, and would do it during the ordinary first-30-seconds
  window when no answer has come back at all.

**Consequences.** The `spoof-adversary` pass demolished the premise this entry was originally
going to rest on, and the honest version is narrower: **the fence is already disclosed.**
`GET /sessions/:id` returns `venue.lat`, `venue.lng` and `venue.radiusM` to the participant,
and the ready-to-start card prints the radius. So withholding metres buys only `nearBufferM`,
which an attacker aiming to appear *inside* never needs — and the cheapest passing attack
(mock GPS at coordinates read straight from the session view, six fixes, ~2.5 minutes, no oracle
involved) is unaffected either way. Withholding distance is therefore kept because it costs
nothing to withhold, not because it is load-bearing.

Two things follow, both recorded rather than done here. **Rate-limiting the oracle alone would
be theatre** while `SessionView` ships the fence; it is worth doing only together with
coarsening that payload, which is a product question — telling a participant the size of the
fence they are judged against is arguably the honest thing to do. And the same pass found that
`GET /sessions/:id` had **no ownership check at all**, so any participant token could read any
session's centre, radius and timestamps; that one was not deferred — it is fixed on this branch
with the boundary test that was missing because the check was missing.

The remaining cost is ordinary: presence only updates when a batch reaches the server, so an
offline participant sees a stale answer. The banner shows its age rather than pretending.

---

## D-037: Real accounts, created by an admin and by a business

**Date:** 2026-09-10
**Status:** accepted. Supersedes the authentication half of D-008; its authorization half stands.

**Decision.** Accounts move from the hardcoded array in `demo-users.ts` to a `users`
collection with scrypt-hashed passwords. An admin creates a business account -- the
organisation and its first sign-in, in one transaction -- and a business creates participants
inside its own organisation and nowhere else. Only an admin can create a business user. Every
new account gets the same default password. `GET /auth/demo-credentials` is removed.
`AuthGuard`, `RolesGuard`, `@Roles()`, `@CurrentUser()` and every boundary test are unchanged,
which is the seam D-008 said it was leaving.

**Context.** D-008 scoped identity out and said what reversing it would cost: replace
`AuthService.login` and the demo list. The requirement that forces it is the product's, not the
engineering's -- a platform with one hardcoded customer cannot demonstrate onboarding a second,
and every venue, task and visit in the system already hangs off a `clientOrgId` that only ever
had one value.

**Alternatives considered.**

- *bcrypt or argon2 for hashing.* The conventional answer and the stronger KDF. Rejected: both
  are native modules, which means a compiler in the API image and a rebuild on every Node bump,
  to improve something nobody is grading. `node:crypto`'s scrypt is memory-hard, in the standard
  library, and costs zero dependencies -- the same trade D-008 made when it hand-rolled an HMAC
  token instead of adding `@nestjs/jwt`.
- *Generate a one-time password per account and show it once.* The right answer with a mail
  transport. Rejected because there is none: the password would exist only in a dialog, and
  closing it would strand the account with no reset flow to recover through. A shared default is
  worse security and honest about being a demo; a generated password nobody can retrieve is
  theatre that also loses accounts.
- *Keep the user in the token and skip the per-request read.* One less database round trip on
  every authenticated call, including ping ingest. Rejected: deactivation is the only control
  this system has over an account, and a token is valid for seven days. A control that takes a
  week to apply is not one. `verify` re-reads and projects to the five fields `AuthUser` needs.
- *Two branches, auth swap then account admin.* Offered and declined by the user. Recorded
  because the risk was real: the swap changes how every request in the system resolves identity.

**Consequences.** Ids are derived from the username (`u-<username>`), which keeps them readable
in the six collections that store a participant as a plain string -- and makes **usernames
immutable**, since a rename would orphan the account's visits. There is no rename endpoint, and
adding one means adding an id that is not the username. Accounts are never deleted, only
deactivated, because verification results are append-only (rule 8) and a verdict attributed to a
missing user is unreadable; the schema enforces that rather than asking. The seed writes only
MISSING accounts: scrypt salts randomly, so re-hashing on every boot would silently reset a
password mid-demo, and a username collision with a console-created account logs and continues
rather than bricking a container that seeds on every start.

Two things this deliberately does not fix. Deactivation is immediate for REST but **not for an
already-open `@Sse()` stream**, because guards run at connect: a deactivated user keeps a live
console or notification stream until it reconnects. And there is still no password reset, no
rotation and no second factor -- the default password is the last genuinely demo-shaped thing in
the authentication story, and it is the first thing to replace if this ever carries real users.

The feature also opened a tenancy hole and closes it in the same branch: `createAssignment`
checked that the assignee was a participant but never that they were in the task's organisation,
which was unreachable while every account shared one org and becomes cross-tenant data exposure
the moment a business creates its own. `listParticipants` was unscoped for the same reason. Both
are now org-scoped with a boundary test each.

---

## D-038: The sign-in screen stops advertising the demo accounts

**Date:** 2026-09-10
**Status:** accepted. Reverses the "list them on the page" half of D-008; the accounts and the
shared password themselves are unchanged.

**Decision.** The login page no longer renders the demo-account chips, the shared password, or
the divider above them, and the username and password fields now start empty instead of
pre-filled with `business` / `demo1234`. The credentials stay documented in `README.md`, which
is where a reviewer is already told to look. `auth.demoAccounts` and `auth.demoPasswordFor` are
deleted from both dictionaries.

**Context.** D-008 put the roster on the page so a reviewer would not have to read source to get
in, and that was right while the roster was twelve fakes and the README was thin. Since D-037 a
business creates its own accounts, so the page shows three seeded names out of an open-ended set
— a partial directory, which is worse than none — and the first screen of the product is a form
handing out a password. This is the beginning of a front-end pass; the sign-in screen is the
first thing anyone sees and it should read as the product, not as a fixture.

**Alternatives considered.**

- *Keep the chips but hide them behind `import.meta.env.DEV`.* Tempting, and it keeps the
  one-click path for local work. Rejected: the deployed demo on Render **is** the thing being
  reviewed, so the branch that matters is the one where they are hidden, and we would be
  carrying a code path nobody exercises plus a build-mode difference in the highest-traffic
  screen — the exact place a mode-only bug goes unnoticed.
- *Keep the fields pre-filled and drop only the visible list.* The literal minimum, and the
  password is behind dots anyway. Rejected because a form that arrives filled in is the same
  advertisement with one extra click removed; and a reviewer who then types their own username
  over a stale pre-filled password gets a failed login for no visible reason.
- *Remove the seeded accounts entirely and add a first-run setup flow.* The honest end state.
  Rejected as out of scope for a front-end pass, and the seed is what makes `docker compose up`
  work with no manual steps (§7).

**Consequences.** Signing in to the deployed demo now costs a README lookup, and anyone who had
the click-to-fill habit loses it. If a reviewer reports friction, the cheapest answer is a single
line of helper text naming the README, not the chips coming back. Nothing about credential
handling actually improved — the accounts, the shared `demo1234` and the absence of a reset flow
are all exactly as D-037 left them; this only stops the UI from announcing them.

## D-039: The brand comes from theQA's own tokens, read off their stylesheet

**Date:** 2026-09-10
**Status:** accepted

**Decision.** `apps/web/src/theme/theme.ts` now carries theQA's real design tokens, transcribed
from the `--qa-*` custom properties theqa.io publishes in its Next.js CSS chunks. The primary is
`--qa-teal-700` `#15868c`, not the placeholder green; the type face is IBM Plex Sans Arabic for
both scripts; radii, shadows, motion curves and line-heights come across too. The font is now
actually loaded, which it never was before.

**Context.** The theme had shipped since the first UI commit with a comment saying its hexes were
placeholders that "should not be trusted", and nobody replaced them. Worse, `Inter` sat at the
front of the font stack and was never fetched by anything, so every screen rendered in whatever
`system-ui` resolved to. The app did not look like theQA's product because none of it was
theQA's. A prior attempt to read the site failed because theqa.io is client-rendered.

**Alternatives considered.**

- *Read the rendered DOM with browser automation and copy computed styles.* The obvious route
  and the one the old comment prescribed. Blocked: the Chrome extension was not connected. Also
  weaker than what we got — computed styles give you the handful of values you thought to
  inspect, whereas the stylesheet gives the whole authored token layer including the steps
  nobody would have thought to sample.
- *Keep guessing, but guess better.* Pick a teal by eye from a screenshot. Rejected because the
  failure here was never the quality of the guess, it was that a guess was in the tree at all
  while claiming in a comment to be provisional. A better guess has exactly the same problem.
- *Take purple `--qa-purple-500` as the primary.* Genuinely arguable: theQA ships teal and purple
  as equal full ramps and purple is the more distinctive colour. Lost on evidence — `#15868c` is
  the single colour literal in the served HTML, spent on the app-shell spinner, which is the one
  piece of chrome they paint before their own app boots.
- *Add `@fontsource/ibm-plex-sans-arabic` and self-host, as theqa.io does.* The better end state:
  no third-party request, no FOUT, works offline in the Docker demo. Rejected for now only
  because it needs a dependency (§6) and a `<link>` needs none.

**Consequences.** The web app now has a hard runtime dependency on Google Fonts; offline or with
that host blocked it falls back to `system-ui` and looks like it did before. That is the trade we
took to avoid a dependency, and self-hosting is the fix when someone wants to spend one. These
tokens are a transcription of a live site, so they will silently go stale if theQA rebrands —
the source URLs and the read date are in the file header so the next person can re-read rather
than re-guess. `verdictChartPalette` is now knowingly inconsistent: its values were validated
against a brand green that no longer exists, and they are left untouched with a STALE notice
rather than hand-edited, because re-deriving them means re-running the dataviz validator's six
checks, not picking new hexes by eye.

## D-040: Design tokens are a plain export, not an augmented MUI theme

**Date:** 2026-09-10
**Status:** accepted

**Decision.** `qa` — theQA's transcribed token layer from D-039 — is exported from
`theme/theme.ts` as an ordinary named const. Components import it directly for the rungs MUI's
palette has no name for. The palette keeps the dozen values MUI itself resolves (`primary`,
`divider`, `text.secondary`), and those stay the preferred route where they exist.

**Context.** D-039 landed the real tokens but left `qa` module-private, so the only reachable
values were the ones mapped onto MUI's palette. A screen needing `neutral[300]`, `teal[50]`,
`radius.sm` or a named shadow had nowhere to get it, and the front-end pass would have started
hardcoding hexes into components — the exact failure D-039 was fixing, one layer down.

**Alternatives considered.**

- *MUI module augmentation (`declare module '@mui/material/styles'`), so tokens ride on the
  theme as `theme.qa.*`.* The idiomatic MUI answer, and it keeps one object to pass around.
  Lost on two counts: the tokens are direction-independent but `buildTheme` is called once per
  direction, so they would be duplicated into both themes for no reason; and in an `sx` prop the
  augmented form is strictly worse to read — `sx={{ color: (t) => t.qa.neutral[700] }}` against
  `sx={{ color: qa.neutral[700] }}`.
- *Extend `palette` with custom keys instead (`palette.neutral`, `palette.brandTeal`).* Keeps
  everything in one place and needs augmentation anyway. Rejected because MUI's palette entries
  carry meaning — `main`/`light`/`dark`/`contrastText`, used by component variants — and a raw
  50..900 ramp shoved in there gets picked up by `color="neutral"` props that then behave oddly.
  It also cannot hold the non-colour scales, so radius, motion and shadows would need a second
  mechanism regardless.
- *A separate `tokens.ts` module, with `theme.ts` importing from it.* Cleaner on paper. Rejected
  as ceremony at this size: the tokens exist to build the theme, they are read from the same
  source on the same date, and splitting them puts the provenance comment a file away from the
  values it vouches for. Worth revisiting if a second consumer appears that has no theme.

**Consequences.** Two ways to reach a colour now coexist, and the boundary between them is a
convention in a doc comment rather than something the compiler enforces — someone will
eventually write `qa.neutral[200]` where `divider` was meant, and nothing will complain. The
export is also a wider contract than the palette: every rung listed is now something a component
may depend on, so removing one is a breaking change rather than an edit. Deliberately kept
trimmed to the steps in use for that reason. If a second app or a non-React consumer ever needs
these, the separate-module alternative above becomes the right shape.

## D-041: The console opens with the review queue, and the disclaimer becomes a footnote

**Date:** 2026-09-10
**Status:** accepted

**Decision.** The visits tab now opens with a band naming how many visits are waiting on a human
decision, and `console.disclaimer` moves from a full-width `Alert` above the fold to a caption
under the table it qualifies. The filter chips become a segmented control, and the verdict is
drawn in the table as a coloured rail plus a dot rather than a filled chip.

**Context.** The screen had no answer on it. Five tabs, a paragraph-length info alert, and four
filter chips each wearing a count badge all rendered at the same weight, so the thing a business
user opens the console to find out — is anything waiting on me — took as much scanning as
everything else. On a 360 px phone the badged chips wrapped to three rows and pushed the table
below the fold outright.

**Alternatives considered.**

- *Keep the `Alert` and add the band above it.* The smallest change and it loses nothing.
  Rejected: two full-width blocks before the first row is worse than one, and the alert is what
  the band is trying to outrank. Something had to be demoted for anything to be promoted.
- *Drop the disclaimer from this screen entirely; it is already on every verdict in the drawer.*
  Tempting, and it is genuinely repeated there. Rejected because the table is where a reader
  forms the impression that a score is a measurement, and D-001 is worth one caption. Demoting
  it is a real reduction in prominence and that is the cost, taken deliberately.
- *Keep the filled `VerdictChip` in the table and add the score as its own column.* Less churn,
  and the chip already exists. Rejected: a filled colour block in every row of a column turns
  the column into a bar chart of nothing, and it competes with the venue name, which is what
  the eye is actually looking for. The chip survives unchanged on the phone cards, where there
  is no column of siblings for it to compete with.
- *Build the venue/participant search box from the mockup.* Rejected as out of scope for a
  restyle: `GET /visits` filters on verdict only, so this is a server change and an index, not a
  front-end one. Noted rather than half-built behind a disabled input.

**Consequences.** The disclaimer is now materially less likely to be read — that is the point of
a footnote and it is the honest cost of this change; if a reviewer says the caveat has become too
quiet, the answer is to make the caption heavier, not to restore the alert. The band reads
`counts['needs_review']`, which the SSE handler already maintains, so it stays live without a
refetch; if that count and the list ever disagree the band is the one that will look wrong. The
table is hidden entirely when empty, so the empty-state sentence is now the only thing rendered
in that case rather than sitting under a framed header row.

## D-042: The verdict's caveat moves out of a tooltip and under the score

**Date:** 2026-09-10
**Status:** accepted

**Decision.** The detail drawer prints the verdict's explanation — "The evidence is ambiguous. A
human decides.", and its two siblings — as body text under the score, where it used to be the
`title` of a tooltip on a chip. `VERDICT_EXPLAIN` is exported from `VerdictChip` rather than
copied, so the three strings still exist in exactly one place.

**Context.** The score is the object a reviewer is deciding about and it rendered as a small chip
the same size as the engine-version chip beside it. Making it the largest thing in the panel is
the obvious fix, but a large confident number is exactly what D-001 says this system must not
produce — so the sentence qualifying it had to grow with it rather than stay behind a hover.

**Alternatives considered.**

- *Keep the tooltip and just enlarge the score.* The smallest change. Rejected because a tooltip
  is not reachable by touch at all, and the drawer is full-bleed on a phone — the one surface
  where the caveat would have disappeared completely is the one where the number got biggest.
- *Write a new, shorter string for the drawer.* A sentence sized for the space rather than
  inherited from the chip. Rejected: two copies of the "this is not proof" wording is exactly the
  thing that drifts, and the drift always goes one way — the shorter copy loses the hedge. One
  string, one place, is the whole point of exporting it.
- *Print the full `verdict.auto_verified` label instead ("Consistent with a genuine visit").*
  Rejected as saying the same thing twice: the heading above it already carries the short label,
  and the explanation is the part that adds the hedge.

**Consequences.** This pulls in the opposite direction from D-041, which demoted the console's
standing disclaimer to a footnote on the same screen. That is deliberate and not a contradiction:
the list-level disclaimer is a general statement about how to read a table and is read once,
whereas this sentence is attached to one specific number a person is about to act on. The general
caveat got quieter and the specific one got louder. If a future change wants to trim either, they
should be argued separately. The cost is vertical space in a drawer that already scrolls, and one
more import edge between a page and a component.

## D-043: The chart palette is re-derived on teal, one step off the brand primary

**Date:** 2026-09-10
**Status:** accepted. Supersedes the chart half of D-039, which left these values STALE.

**Decision.** `verdictChartPalette` becomes `--qa-teal-600` `#1ea8af`, `--qa-yellow-800`
`#a77f26` and `--qa-red-800` `#ad1f2a`, re-derived through the dataviz validator rather than
picked by eye. It is deliberately not the same three steps as `verdictPalette`.

**Context.** D-039 replaced the brand green with teal but left the chart palette untouched under
a STALE notice, because its whole justification — "the brand green is low-chroma and reads gray
in a chart" — referenced a colour that no longer existed. The values had to be re-derived, and
the honest way to do that is to run the checks, not to eyeball a teal.

**Alternatives considered.**

- *Use the brand primary `--qa-teal-700` `#15868c` directly, so chrome and charts match.* The
  obvious thing to want. It FAILS the chroma floor at 0.092 — it reads as gray in a chart. This
  is the same failure the old green had and for the same structural reason: a colour picked to
  sit quietly behind UI chrome is picked to be low-chroma, which is exactly wrong for a data
  mark. That the replacement hue failed identically is the useful finding here.
- *Find an off-ramp teal that passes chroma AND clears 3:1 contrast.* Five candidates were
  tested across the plausible lightness range (`#0d8a91`, `#00858f`, `#0a7f88`, `#008b94`,
  `#127e86`). Every one cleared contrast and every one failed chroma, topping out at 0.099. Teal
  in sRGB cannot hold chroma >= 0.1 while dark enough for 3:1 against a white surface; the two
  constraints are in genuine tension for this hue, not for want of searching.
- *Shift the hue toward green to buy chroma.* Would pass everything. Rejected: it walks back to
  a green for `auto_verified`, which is the thing D-001 spends its budget avoiding, and it stops
  reading as the brand.
- *Keep the chip's `--qa-yellow-700` for `needs_review` so the two palettes agree.* Rejected on
  adjacent-pair separation against the red; the 800 step buys the margin.

**Consequences.** Contrast for the teal is a WARN at 2.81:1, and a WARN is not dismissable — it
obligates visible labels or a table view. `Dashboard` already satisfies this: the legend renders
a swatch beside a text label for every series and the stat tiles are labelled, so no series is
identified by colour alone. **That relief is now load-bearing.** A chart added later without
visible labels is not licensed to use this palette, and the file says so. There are also now two
near-but-unequal colours per state across the app, which will look like a mistake to anyone who
does not read the comment — the comment is the mitigation. No dark-mode steps were derived
because `palette.mode` is `light` and there is no dark surface to validate against.

## D-044: Presence is the participant screen, not a banner on it

**Date:** 2026-09-10
**Status:** accepted

**Decision.** `PresenceBanner` stops being an MUI `Alert` and becomes a centred block with a
drawn mark, a headline and a hint, in the brand's colours rather than MUI's semantic set.
`inside` is `--qa-teal-700`, not a success green. On the same screen the elapsed clock comes out
of its card, capture health becomes rows instead of a middot-joined sentence, and "End visit"
stops being a filled `color="secondary"` button.

**Context.** The on-site screen had four `Alert`s that could render at once — presence, the
background-tab notice, the offline notice, and a permission error — all at identical weight.
Only one of them tells the participant to do something, and it was the one competing with a
timer that changes every second. Separately, the brand change in D-039 turned
`color="secondary"` from a muted amber into `--qa-purple-500`, so the button that stops location
capture had quietly become the brightest thing on the screen.

**Alternatives considered.**

- *Keep the `Alert` and raise only its severity.* Cheapest. Rejected: severity changes the colour,
  not the weight, and the problem was that four things looked equally important. Raising presence
  to `error` would also make `near` and `unknown` — neither of which is a failure — shout.
- *Use `success` green for `inside`.* What MUI's severity vocabulary pushes you toward, and it is
  what the old code did. Rejected on D-001 grounds: this screen feeds the verdict that comes out
  the other end, and a green tick at the start promises a certainty the engine will not deliver.
  The brand teal reads as confident without claiming proof.
- *Colour the capture-health rows by severity — red for offline, red for a restart.* Rejected:
  queued fixes and a capture restart are both normal, already handled, and recoverable. Colouring
  them as failures makes a working visit look broken to someone who cannot do anything about it.
  They are amber, and every row says its piece in words so the colour carries nothing alone.
- *Leave "End visit" filled and just change the colour.* Rejected. Ending is not what the screen
  wants you to do, it is what you do when finished; a filled button under the thumb is an
  invitation. Outlined and neutral, with "start" the only filled action in the flow.

**Consequences.** `PresenceBanner` no longer inherits MUI's alert affordances — it is not
announced as a `role="alert"` any more, which for a value that changes while the page is open is
arguably a regression for a screen reader and is worth revisiting with a live region. The three
marks are hand-drawn SVG rather than an icon dependency, so they are ours to maintain. The
tinted grounds are `qa.*[50]` steps, which means this screen now depends on the token export from
D-040 rather than the palette alone.

## D-045: The presence marks use the icon library that was already installed

**Date:** 2026-09-11
**Status:** accepted. Corrects the icon half of D-044, whose stated reason was factually wrong.

**Decision.** `PresenceMark` renders `@mui/icons-material` outlined icons —
`PlaceOutlined`, `WarningAmberOutlined`, `HelpOutlined` — instead of the three hand-drawn SVG
paths D-044 introduced.

**Context.** D-044's consequences paragraph says the marks are "hand-drawn SVG rather than an
icon dependency, so they are ours to maintain", and the component carried a comment saying "the
app has no icon dependency and one is not worth adding for three glyphs". Both were false.
`@mui/icons-material` 9.4.0 is in `apps/web/package.json` and was already imported by
`ParticipantApp`, `NotificationBell` and `History`. The premise was never checked; it was
asserted. Recorded in `docs/AI-NOTES.md` for 2026-09-11.

**Alternatives considered.**

- *Keep the hand-drawn paths and just correct the comment.* The smaller diff, and the paths did
  render. Rejected: the only argument for hand-drawing was avoiding a dependency that is already
  there, so with the premise gone there is no argument left — three bespoke SVGs are three things
  to maintain and restyle in a codebase that has a maintained set for exactly this.
- *Use the filled variants (`Place`, `Warning`, `Help`).* Rejected for consistency: the bottom
  navigation and the notification bell use outlined icons, and the presence disc sits on a tinted
  ground where a filled glyph reads heavier than intended.

**Consequences.** Icon geometry is now MUI's and will move if the library is upgraded, which is
the trade for not maintaining it. `HelpOutline` — the v5 alias — does not exist in v9; the import
is `HelpOutlined`, and that is noted at the import because the v5 name is what autocomplete
memory reaches for and the failure is a build error rather than a silent one.

## D-046: The end-visit confirm is a sheet over the live screen, and consent keeps one gate

**Date:** 2026-09-11
**Status:** accepted

**Decision.** The end-visit confirm becomes a bottom `Drawer` over the running screen instead of
replacing the action area in place. The report form loses its card and dividers and gains a
"Visit closed" line, keeping MUI `Rating` rather than the pill selector the mockup drew. The
consent screen gets one bordered panel per section and keeps its single read gate.

**Context.** These were the last three artboards on the design canvas. Two of them, as drawn,
described behaviour the app does not have, and porting them faithfully would have been a product
change wearing a mockup's clothes.

**Alternatives considered.**

- *Port the consent mockup's per-section read-gating — four independent ticks, "2 left".* This is
  what the canvas shows, and it is a stricter, more defensible consent flow. Rejected here
  because it is a change to how consent is obtained, not to how it looks: four pieces of state,
  new copy in both languages, and a different claim about what the participant attested to. The
  gate is a product and arguably legal decision and does not belong in a styling pass. Only the
  visual half was taken. The mockup was mine, and drawing it did not make it agreed.
- *Port the report mockup's 1-5 numbered pills in place of the stars.* Bigger touch targets and
  less ambiguous than five stars. Rejected: `Rating` already carries keyboard interaction and
  screen-reader semantics that hand-built pills would have to reimplement, and a required field
  in the only form a participant fills is the wrong place to spend that risk for a target-size
  gain. The rest of that screen's layout was taken.
- *Keep the confirm inline and just restyle it.* Rejected. The confirm replaced the timer and the
  presence state with itself, so the state being closed vanished at the moment of deciding about
  it. A sheet leaves it on screen. `DiscreetMode` already establishes the sibling-overlay pattern
  on this screen for the same reason: `useVisitTracker` lives in `ActiveVisit` and anything that
  unmounts that subtree stops capture.

**Consequences.** The end sheet adds a dismissable surface to the one flow that must not be
ambiguous — a participant can now background the app with the sheet open and return to it, which
the inline version made impossible. The visit is unaffected either way, since the sheet is a
sibling of the tracker rather than a parent. Two new copy keys, `visit.endTitle` and
`visit.startedAt`, plus `report.visitClosed`. The consent and report mockups on the canvas now
show more than the code does, which is a trap for whoever reads them next; the canvas should be
re-saved to match, or these two rejections will look like unfinished work.

## D-047: The console's section nav moves into the app bar

**Date:** 2026-09-11
**Status:** accepted

**Decision.** The five section tabs move from the top of the scrolling container into the
`AppBar`: inline beside the title from `lg` up, and on their own row inside the same `AppBar`
below that. They stay MUI `Tabs`, restyled as pills — indicator hidden, selected state a teal
tint instead of an underline.

**Context.** The console mockup put the nav in the top bar and the port never moved it; it stayed
a default underlined `Tabs` strip sitting above the content, scrolling away with it. Two things
follow from that. The nav scrolled out of reach on a long visit list, and the app bar carried
only a title and a sign-out while the row below it did the actual navigating.

**Alternatives considered.**

- *A row of `Button`s styled as pills.* What the mockup literally draws, and simpler markup.
  Rejected: `Tabs` carries `role="tablist"`, `aria-selected` and arrow-key navigation between
  sections, and a hand-rolled row would have to reimplement all of it to reach parity. Same call
  as keeping `Rating` over pill buttons in D-046 — a shape is not worth rebuilding semantics for.
- *One `ConsoleNav` instance, repositioned with CSS order/wrap rather than rendered twice.*
  Rejected as fragile: the two positions are in different flex contexts (inside the `Toolbar`
  and below it), which `order` cannot bridge. The duplicate is `display: none`, so only one
  tablist is ever in the accessibility tree.
- *Skip straight to the sidebar.* Rejected as a bigger change than the one asked for, and it is
  not obviously better — see the sidebar artboard's own note. Drawn, not built.

**Consequences.** Below `lg` the `AppBar` is two rows tall, which costs about 45 px of vertical
space on a phone permanently — the trade for the nav never scrolling away. The `lg` breakpoint is
a guess at where five pills plus the status chip, the account name and the sign-out stop fitting;
it was picked by counting, not measured, and is the first thing to adjust if it looks tight. The
nav is still `variant="scrollable"`, so on a narrow phone it scrolls sideways rather than
wrapping to a third row.

## D-048: The participant's section nav moves into the app bar too, and the pills are shared

**Date:** 2026-09-11
**Status:** accepted

**Decision.** The participant shell's fixed `BottomNavigation` is replaced by the same pill nav
the console got in D-047, on a second row inside its `AppBar`. The pill styling is extracted to
`components/PillTabs.tsx` and both surfaces use it. The participant toolbar title becomes the
product name, since the tabs below it now say which section is open.

**Context.** The two surfaces navigated in two different ways for no reason a user would be able
to name — the console with tabs at the top, the participant app with a fixed bar at the bottom.
Asked to make them match.

**Alternatives considered.**

- *Keep the bottom bar. It is the correct mobile pattern and this shell is explicitly
  mobile-first.* The strongest argument against this change, and it is not wrong in general: a
  bottom bar is where the thumb is. It loses here on what it is being spent on. The nav switches
  between the visit runner and the history list, which a participant does a handful of times a
  day, and it was holding the most reachable strip of the screen permanently to do it. **The
  primary actions have not moved** — "Start visit", "End visit" and "Submit report" are all still
  pinned to the bottom of their own screens, which is where thumb reach actually matters.
- *Duplicate the pill `sx` block into `ParticipantApp`.* Rejected: it is thirty lines of styling
  that has to stay identical for the surfaces to look like one product, and a copy drifts the
  first time either side is touched. Extracted instead, which is why `PillTabs` exists.
- *Keep "Your visit" as the toolbar title.* Rejected as saying the same thing twice: the active
  tab already reads "Visit" directly underneath it. The bar carries `auth.appName` and
  `participant.yourVisit` was deleted from both dictionaries rather than left dead.

**Consequences.** The participant loses a persistent bottom target and gains about 45 px of
permanent top chrome — a two-row app bar on a phone. `PillTabs` is now a shared component with
two callers, so a change to it moves both surfaces at once, which is the point and also the risk.
The participant artboards on the design canvas still draw a simplified single-row bar reading
"Your visit"; they were never literal about that bar (they omit the bell, the language toggle and
sign-out too) and were left alone rather than half-corrected.

## D-049: "Use my location" recentres the map and draws its own accuracy, rather than filling the field

**Date:** 2026-09-12
**Status:** accepted

**Decision.** The venue map picker gains a third way in, alongside address search and dragging:
a "Use my location" button that takes one `getCurrentPosition` fix, recentres the map on it and
emits the coordinate. The zoom is derived from the fix's reported accuracy
(`zoomForAccuracy` in `slippy.ts`), and the accuracy radius is drawn to scale as a circle
anchored to the fix. Above 100 m the caption changes from confirmation to a warning.

**Context.** Asked for it: the common case for adding a venue is someone standing in it, and
making them type a name into a geocoder to find the building they are inside is silly. The real
question is not whether to add the button but how much to trust what it returns — a browser fix
is 5 m on GPS and several kilometres on an IP lookup, and the API reports which it gave you.

**Alternatives considered.**

- *Write the fix straight into the coordinate field and skip the map.* The obvious version, and
  rejected as exactly the D-020 failure with a new entrance. A 2 km IP fix formatted to six
  decimals looks identical to a 6 m GPS fix, so the geofence gets anchored on a guess and the
  precision guard — which counts decimal places, not metres — waves it through.
- *Refuse to emit a coordinate when accuracy is worse than 100 m.* Tempting and rejected: it
  leaves the form in a state where the button visibly did something (the map moved) and the
  field did not change, which reads as a bug. Emitting plus a warning plus a visible circle puts
  the same information in front of the user without a dead end.
- *Fixed street-level zoom on arrival, like the geocoder results use.* Rejected because it draws
  a guess and a measurement as the same picture. Zoom-from-accuracy costs about ten lines of
  pure maths and makes a bad fix look bad.
- *`watchPosition`, so the pin tracks the user.* Rejected: this answers a question once. A watch
  keeps yanking the map away from someone who has started fine-tuning the pin.

**Consequences.** 100 m is borrowed, not derived — it is the accuracy ceiling the verification
engine already treats as unusable, on the argument that a fix too coarse to prove presence is
too coarse to define the place. A venue whose true radius is 25 m deserves a tighter threshold
and does not get one. The 30 s timeout is longer than the tracker's 20 s and is a guess at how
long an indoor receiver needs; nothing measured it. The button is available to admins and
business users alike because they share one `VenueForm`, so a business user adding a venue from
head office gets an office-accuracy fix and a warning telling them to drag — correct, but it
means the fast path is only fast for the people actually on site.

## D-050: The participant nav sits inline in the toolbar at the same width the console's does

**Date:** 2026-09-12
**Status:** accepted. Completes D-048, which described only half of the placement.

> **Renumbered.** This shipped as a second `D-049`, colliding with the venue-picker entry above
> it, which is the one `MapPicker.tsx` points at. The log is append-only and a heading is not
> reasoning, but two entries cannot share a number without making every cross-reference a coin
> flip — so the later of the two moved to D-050 rather than the collision being left in place.
> Recorded here rather than fixed silently.

**Decision.** The participant shell renders `PillTabs` twice, exactly as the console does since
D-047: inline in the `Toolbar` beside the title from `lg` up, and on its own row inside the same
`AppBar` below that.

**Context.** D-048 moved the participant nav off the bottom bar and into the `AppBar`, and its
entry says "on a second row inside its `AppBar`" — which is what was built. The console, however,
puts the pills inline in the toolbar row itself from `lg` up and only falls back to a second row
below that. So on any wide window the two surfaces still looked different: the console's nav was
in the bar, the participant's was in a strip under it. D-048 claimed parity it had not delivered.

**Alternatives considered.**

- *Use `md` for the participant instead, since two pills need far less room than the console's
  five.* Genuinely better on its own terms — it would put the nav in the bar on a tablet too.
  Rejected because it makes the two surfaces change shape at different widths, which is the
  inconsistency this entry exists to remove. If it is ever revisited, lower BOTH.
- *Drop the second row and let the nav scroll inside the toolbar at every width.* Rejected: the
  participant toolbar already carries the title, the account name, the bell and two buttons, and
  on a 360 px phone adding a scrolling nav to that row makes five things compete in 360 px.

**Consequences.** Two `PillTabs` instances per surface now, the hidden one `display: none` so only
one tablist reaches the accessibility tree. The practical effect for participants is close to nil:
this shell is used on phones, which are below `lg` essentially always, so the second row is what
they will see. The change is really about the two surfaces agreeing when someone opens the
participant view on a laptop — which is exactly how it is reviewed.
