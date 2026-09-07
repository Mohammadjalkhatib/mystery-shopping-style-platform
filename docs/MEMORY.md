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
