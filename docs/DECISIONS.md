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
