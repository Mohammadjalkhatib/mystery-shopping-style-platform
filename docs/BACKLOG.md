# Backlog

Feature slices in dependency order. One branch each, off `dev`, merged back to `dev`.
Each is sized to be roughly one Claude Code session.

The ordering is deliberate: the state machine and the verification engine come before any
UI, because they are the two pieces where being wrong is expensive and invisible, and because
everything else is shaped by their contracts. Building the pretty participant screen first is
the trap.

---

## Batch 1: the spine

**`feat/scaffold`**
Monorepo, npm workspaces, NestJS app, Vite app, shared types package, Mongoose connection,
health endpoint. No features. Verify `docker compose up` works before adding anything else.

**`feat/data-model`**
All Mongoose schemas and indexes. Includes the 2dsphere index on venues and the TTL index on
pings. Run through `schema-reviewer` before merging. Seed script with two Kuwait venues, one
indoor and one outdoor.

**`feat/session-state-machine`**
Pure state machine in `apps/api/src/session/state-machine.ts`, transition allowlist, session
events collection, hard cap and abandon timers as config. Full test coverage of legal and
illegal transitions. No HTTP yet.

**`feat/ping-ingest`**
Batch ping endpoint, idempotent on `(sessionId, clientPingId)`, server-computed distance and
presence, DTO that rejects server-owned fields rather than ignoring them. Tests for duplicate
flush and for rejected client-supplied fields.

**`feat/verification-engine`**
Pure scoring in `apps/api/src/verification/`. Signals, weights, banding. Table-driven tests
over fixtures from `test-fixture-writer`. Run `spoof-adversary` against it before merging and
record what it found. This is the most important branch in the project.

## Batch 2: the flow

**`feat/participant-flow`**
Consent screen, start visit, live presence indicator, wake lock, `visibilitychange` handling,
IndexedDB buffer, end visit, report form. Mobile-first. This is the screen a reviewer will
open on a phone, so it is the one that has to actually work.

**`feat/report-and-outbox`**
Report submission as a single transaction writing report, session state and outbox entry.
Evaluator consumes the outbox and writes an append-only verification result.

**`feat/business-console`**
Combined admin and business console. Two tabs: Tasks (create venue, create task, assign) and
Visits (live feed). SSE subscription filtered by client org. Review queue for the middle band.

**`feat/evidence-upload`**
S3-compatible upload, EXIF `DateTimeOriginal` and GPS extracted as a verification signal,
then EXIF stripped before storage. Evidence shown in the review queue.

## Batch 3: finish

**`chore/dockerize`**
Production Dockerfiles, multi-stage, compose verified from a clean clone. Rule 6 of the
project: this happens after the first batch of features, not before.

**`feat/arabic-pass`**
RTL direction switch, Arabic strings on participant screens only. Cheap, and it signals that
the market was read rather than ignored.

**`chore/submission`**
README complete, architecture diagram embedded, decision log tidied (add entries, never edit
old ones), AI notes reviewed for honesty rather than polish, deploy and warm the services.

---

## Not building

Payments. Task authoring beyond a minimum form. Participant reputation. Native apps. Full i18n.
Notifications. Anything that appears in this list during a session should be raised, not built.
