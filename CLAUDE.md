# CLAUDE.md

Project context for Claude Code. Read this fully before the first change in a session.

---

## 1. What this is

A thin end-to-end slice of location-verified field visits for a mystery-shopping platform.

Flow: an admin creates a task tied to a venue and assigns it to a participant. The participant
opens a web app, consents, starts a visit session, keeps the tab open while on site, ends the
session, and submits a short report. The business console shows the completed visit appear on
its own with a verification verdict, no refresh.

This is a technical assessment submission. That changes two things about how we work:

- **Every non-trivial choice must be recorded** in `docs/DECISIONS.md` with the alternatives
  considered and why they lost. Use the `decision-log` skill. This is a graded deliverable.
- **Do not polish the process artifacts afterwards.** `CLAUDE.md`, the agents, the skills and
  `docs/AI-NOTES.md` are submitted as they actually evolved. Messy and real beats clean and
  reconstructed.

---

## 2. Repository and git workflow

Repo: `https://github.com/Mohammadjalkhatib/mystery-shopping-style-platform.git`

### Branches

- `main` is protected and only receives merges from `dev` after approval. Never commit or push
  directly to `main`. Never merge to `main` without being asked explicitly.
- `dev` is the integration branch. All feature work merges here first for testing.
- Feature branches: `feat/<short-kebab-name>` or `fix/<short-kebab-name>`, always branched from
  `dev`, always merged back into `dev`.

Examples: `feat/session-state-machine`, `feat/ping-ingest`, `fix/presence-null-on-first-fix`.

### Commits

- Conventional commit subject: `feat(api): ...`, `fix(web): ...`, `chore(docker): ...`,
  `test(verification): ...`, `docs: ...`.
- **The commit body must list the files changed and why each one changed.** One line per file
  or per logical group. Not a diff restatement, a reason. Example:

  ```
  feat(api): add idempotent ping ingest

  - apps/api/src/pings/pings.controller.ts: new POST batch endpoint, accepts up to 20 fixes
  - apps/api/src/pings/pings.service.ts: upsert keyed on (sessionId, clientPingId) so an
    offline queue can flush twice safely
  - apps/api/src/pings/dto/create-ping.dto.ts: validation, rejects client-supplied distance
  - apps/api/test/pings.spec.ts: duplicate flush produces one document
  ```

- **Never add Claude attribution to commits or PRs.** No `Co-Authored-By: Claude`, no
  "Generated with Claude Code", no session URL trailer. This is configured in
  `.claude/settings.json` and enforced by the `commit-msg` hook in `.githooks/`. If you ever
  see a trailer land in a commit message, stop and tell me, do not amend silently.
- Small commits. The history is part of the submission.
- Do not commit unless asked, and never `git push --force` on `dev` or `main`.

### Memory

`docs/MEMORY.md` is the running record of what exists in this repo and why.

**Before opening any merge to `dev`, append an entry to `docs/MEMORY.md`.** Follow the format
already in the file. This is rule 5 of the project and it is not optional. It is how a fresh
session picks up state without re-reading the whole codebase.

---

## 3. Non-negotiable design rules

These are already decided. Do not quietly re-litigate them in code. If you think one is wrong,
say so and we will discuss it, but do not just implement the other thing.

1. **There is no boolean `verified`.** Verification produces a score 0 to 100, a verdict from
   `auto_verified | needs_review | rejected`, and an array of signals each carrying a
   human-readable reason. If you find yourself writing `isVerified: boolean`, stop.
2. **The client is untrusted.** The server computes distance, presence, and every state
   timestamp. Never accept a client-supplied `startedAt`, `endedAt`, `distanceM`, or an
   "I am at the venue" assertion. DTOs must reject those fields, not ignore them.
3. **Two clocks on every ping.** `capturedAt` is the device clock and is untrusted.
   `receivedAt` is the server clock. The delta is a signal, not noise.
4. **Ping ingest is idempotent** on `(sessionId, clientPingId)`. The client generates the UUID
   so an offline flush can run twice safely.
5. **Session transitions are validated against an allowlist.** An illegal transition returns
   409 with the current state. It never silently no-ops.
6. **The business console never reads the ping collection.** It reads sessions and verification
   results. Rollups (dwell seconds, coverage ratio, min distance) are written by the evaluator.
7. **Distance is haversine against a per-venue radius, compared against reported accuracy.**
   Not Euclidean on raw lat/lng. Not a single global radius constant.
8. **Verification results are append-only** and carry an `engineVersion`. Never update a
   verdict in place. Human overrides go in a separate `reviewAction` document.
9. **Report submission and verification are decoupled** through the outbox collection. Submit
   is a fast transactional write. The evaluator runs after, can retry, and can be re-run.
10. **Raw location pings expire.** The TTL index on the ping collection is a privacy control.
    Do not remove it, do not raise the window without asking.

---

## 4. Stack

Monorepo, npm workspaces.

```
apps/api      NestJS 10, TypeScript, Mongoose
apps/web      React 18, Vite, TypeScript, MUI v5, React Router
packages/shared   shared DTO types only (Verdict, Signal, SessionState, presence)
```

- Database: MongoDB. Atlas M0 in production, `mongo` container locally.
- Object storage: S3-compatible. MinIO container locally, Cloudflare R2 in production. The code
  only ever talks to the S3 API, never to a vendor SDK.
- Realtime: Server-Sent Events via Nest's `@Sse()`. Not WebSockets, not polling.
- Tests: Jest. `mongodb-memory-server` for anything that needs a database.

### Layout rules

- `apps/api/src/verification/` is **pure**. No Mongoose imports, no I/O, no `Date.now()` passed
  implicitly. It takes an evidence object and returns a result object. This is what makes it
  cheap to test and it is the most important code in the repo. Keep it clean.
- `apps/api/src/session/state-machine.ts` is also pure.
- Everything else may touch the database.

---

## 5. Testing policy

Test where the logic is non-obvious and where a bug fails silently:

- the verification engine, table-driven over synthetic ping traces
- the session state machine, including every rejected transition
- idempotent ping ingest
- geofence maths against known coordinate pairs
- authorization boundaries, one test per boundary

Do not write tests for UI rendering, the map component, the SSE transport, Mongoose behaviour,
or framework plumbing. If you think something outside the first list needs a test, say why
before writing it.

The principle: a wrong verdict is silent and expensive, a broken button is loud and cheap.

---

## 6. Working style

- Before any non-trivial choice, use the `decision-log` skill. Alternatives and why they lost,
  not just the outcome.
- After changing verification signals, thresholds or weights, run the `spoof-adversary`
  subagent against the new rules before considering it done.
- Schema changes go through the `schema-reviewer` subagent first.
- Ask before adding a dependency. Every one needs a reason.
- When I override you or you get something materially wrong, add an entry to
  `docs/AI-NOTES.md` with what happened and why. Write it when it happens, not later.
- Prefer editing existing files over creating new ones. Do not create documentation files
  unless I ask.

---

## 7. Docker

The whole stack is dockerized once the first batch of features lands. `docker compose up`
must bring up api, web, mongo and minio, seeded and working, with no manual steps beyond
copying `.env.example` to `.env`.

Do not let the compose file drift from the real run instructions in the README.

---

## 8. README

`README.md` is a deliverable. It must always contain:

- what the app does and the full feature list, current as of `dev`
- local run instructions without Docker
- local run instructions with Docker
- the deployed URLs
- the environment variables and what each one is for
- the architecture diagram
- what is deliberately out of scope

Update it in the same branch as the feature, not afterwards.

---

## 9. Out of scope

Do not build these. If they seem necessary, tell me instead of building them.

Payments and reward disbursement. A task authoring UI beyond the minimum admin form. Full
i18n (participant screens get an Arabic pass, nothing more). Participant reputation scoring.
Native mobile apps. Photo and receipt capture beyond the single evidence upload.
