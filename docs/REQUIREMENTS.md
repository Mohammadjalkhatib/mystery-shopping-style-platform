# Requirements

Everything that has to be installed to build, run and test this repo, with the version we
pin to and the reason it is here. `CLAUDE.md` §6 says every dependency needs a reason, so
this file is where the reasons live.

Verified against the npm registry on **2026-09-07**. The compatibility matrix at the bottom
records what was actually checked rather than assumed.

---

## 1. Machine prerequisites

Installed by you, not by npm.

| Tool | Required | Verified on this machine | Why |
|---|---|---|---|
| Node.js | `>=22.12` | **24.14.1** ✅ | Vite 8 requires `^20.19.0 \|\| >=22.12.0`; Mongoose 9 and `@nestjs/schedule` 12 require `>=20.19.0`. Node 24 is the current LTS line and satisfies all three. |
| npm | `>=10` | **11.11.0** ✅ | Workspaces. No pnpm or yarn — one lockfile, no extra tool for a reviewer to install. |
| Git | `>=2.40` | **2.53.0.windows.2** ✅ | `core.hooksPath` support for the attribution hook. |
| Docker Engine | `>=27` | **29.5.2** ⚠️ CLI present, **daemon not running** | `docker compose up` is a stated deliverable. Start Docker Desktop before `chore/dockerize`. |
| Docker Compose | `>=2.24` | **v5.1.4** ✅ | `depends_on: condition: service_healthy` and the `develop` block. |

**Not required:** MongoDB installed locally. Tests use `mongodb-memory-server`, which downloads
its own binary, and local runs use the `mongo` container.

### One-time setup per clone

```powershell
git config core.hooksPath .githooks
git config --local core.autocrlf false
Copy-Item .env.example .env
npm install
```

The first line is load-bearing. Without it the `commit-msg` hook is inert and AI attribution
trailers land in the history.

`npm install` pulls ~708 packages. Separately, the **first** `npm test` run downloads a real
MongoDB binary (~780 MB for MongoDB 8.2.6) into a user-profile cache — once per machine, not
per clone. Budget for it on a fresh checkout.

---

## 2. Runtime dependencies

### `apps/api` — NestJS

| Package | Version | Why |
|---|---|---|
| `@nestjs/common` | `12.0.1` | Core framework. D-003. |
| `@nestjs/core` | `12.0.1` | Core framework. |
| `@nestjs/platform-express` | `12.0.1` | HTTP adapter. Express rather than Fastify because `@Sse()` and the SSE keep-alive story are better trodden on Express, and throughput is not a constraint here. |
| `@nestjs/mongoose` | `12.0.0` | Mongoose integration. **This package is the reason we can use Mongoose 9** — see the matrix. |
| `@nestjs/config` | `12.0.0` | Typed env loading. Every threshold in this system is config, not a constant (D-001), so this is not optional ceremony. |
| `@nestjs/schedule` | `12.0.1` | The abandoned-session reaper. D-003. ⚠️ See the open question in §5. |
| `mongoose` | `9.9.5` | ODM. Ships MongoDB driver `~7.5`. D-002. |
| `class-validator` | `0.15.1` | DTO validation. Rule 2 requires DTOs to **reject** server-owned fields, which is `forbidNonWhitelisted: true` — a one-line global pipe rather than hand-rolled guards. |
| `class-transformer` | `0.5.1` | Required peer of `class-validator` under Nest's `ValidationPipe`. |
| `reflect-metadata` | `0.2.2` | Required by Nest's DI. Not optional. |
| `rxjs` | `7.8.2` | Required peer of Nest. Also the return type of `@Sse()`, so it is used directly, not just transitively. D-004. |

### `apps/web` — React

| Package | Version | Why |
|---|---|---|
| `react` | `19.2.8` | UI. |
| `react-dom` | `19.2.8` | Pinned to match `react` exactly — `react-dom@19.2.8` peers on `react@^19.2.8`. |
| `react-router` | `8.3.1` | Routing. **Note: not `react-router-dom`.** As of v7 the DOM exports were consolidated into `react-router`; `react-router-dom` is a legacy re-export. Two routed surfaces: participant and console. |
| `@mui/material` | `9.4.0` | Component library. `apps/web/src/theme/theme.ts` already exists and targets MUI's theme shape. |
| `@mui/icons-material` | `9.4.0` | Icons. Version-locked to `@mui/material` by its own peer range. |
| `@emotion/react` | `11.14.0` | MUI's default styled engine. Listed as an optional peer but required in practice unless you opt into Pigment CSS, which we are not. |
| `@emotion/styled` | `11.14.1` | Same. Also the seam the Arabic RTL pass plugs into. |

### `packages/shared`

No runtime dependencies. Types only, per `CLAUDE.md` §4. If this package ever grows a
dependency, that is a signal it has stopped being a types package.

---

## 3. Development dependencies

| Package | Version | Why |
|---|---|---|
| `typescript` | `6.0.3` | **Deliberately not 7.x.** See the matrix — this is the one place the "use the newest" instruction had to bend. |
| `@types/node` | `26.5.0` | Node 24 typings. |
| `@types/react` | `19.2.18` | React 19 typings. |
| `@types/react-dom` | `19.2.7` | Peers on `@types/react@^19.2.0`. |
| `@types/jest` | `30.0.0` | Matches Jest 30. |
| `@types/supertest` | `7.2.1` | Matches Supertest 7. |
| `jest` | `30.5.1` | Test runner. `CLAUDE.md` §5. |
| `ts-jest` | `29.4.12` | TypeScript transform for Jest. **This package sets the TypeScript ceiling** — see the matrix. |
| `supertest` | `7.2.2` | HTTP assertions for the authorization-boundary tests required by §5. |
| `mongodb-memory-server` | `11.2.0` | Required by §5 for anything touching a database. Downloads a real MongoDB binary on first run — **measured at 781 MB (MongoDB 8.2.6)**, cached under the user profile, once per machine. |
| `vite` | `8.2.2` | Web dev server and build. |
| `@vitejs/plugin-react` | `6.1.1` | React fast refresh. Its three peers (`oxc-transform-react`, `@rolldown/plugin-babel`, `babel-plugin-react-compiler`) are all **optional** and we install none of them. |
| `@nestjs/cli` | `12.0.0` | `nest build` / `nest start --watch`. Also the package that pins our TypeScript version. |
| `@nestjs/schematics` | `12.0.0` | Peer of the CLI. |
| `@nestjs/testing` | `12.0.1` | Nest testing module for the boundary tests. |

**Deliberately not installed:**

- **ESLint / Prettier.** A three-day build with one author. Lint config is a time sink that
  catches nothing the compiler does not, and `CLAUDE.md` §6 says ask before adding. Ask me
  again if a second person joins.
- **`react-router-dom`.** Superseded, see above.
- **`@mui/material-pigment-css`.** Optional peer, alternative styled engine. We use Emotion.
- **`@swc/core` / `@swc/jest`.** Considered as a way to unblock TypeScript 7; rejected in the
  matrix below.
- **Any EXIF library, any S3 SDK.** Those belong to `feat/evidence-upload`, which is proposed
  for the cut list. Not installing them now keeps that cut cheap.

---

## 4. Compatibility matrix — what was actually checked

The instruction was "modernise, but double check it will be compatible." These are the checks
that were run against the registry, not assumed.

| # | Question | Answer | Result |
|---|---|---|---|
| 1 | Does `@nestjs/mongoose` accept Mongoose 9? | peer is `^7.0.0 \|\| ^8.0.0 \|\| ^9.0.0` | ✅ The riskiest pairing, and it is explicitly supported. |
| 2 | Does MUI v9 accept React 19? | peer is `^17 \|\| ^18 \|\| ^19` | ✅ |
| 3 | Is Emotion still MUI's default engine in v9? | `@mui/system@9` present; Pigment CSS is an **optional** peer | ✅ Emotion stays. |
| 4 | Does Node 24.14.1 satisfy every engine field? | Nest `>=20`, Mongoose `>=20.19.0`, Vite `^20.19 \|\| >=22.12`, Jest `>=24` | ✅ All four. |
| 5 | Does `react-router` v8 accept React 19.2.8? | peer is `>=19.2.7` | ✅ Barely — 19.2.8 clears it by one patch. Pin `react` at `19.2.8`, do not float below it. |
| 6 | Are `@vitejs/plugin-react` v6's exotic peers mandatory? | all three are `optional: true` | ✅ Nothing extra to install. |
| 7 | **Can we use TypeScript 7?** | **No** | ❌ `ts-jest` peer is `<7` and `@nestjs/cli@12` pins `~6.0.2`. Pinned 6.0.3. See below and D-006. |
| 8 | **Can a CommonJS API consume NestJS 12?** | **No** | ❌ Nest 12 is ESM-only — no CJS entry point exists. Forced `apps/api` and `packages/shared` to `"type": "module"`. See D-007. |
| 9 | Does demo auth need `@nestjs/jwt` / `passport`? | No | ✅ HMAC via `node:crypto`. **Zero new dependencies.** See D-008. |

### The one thing that could not be modernised: TypeScript

TypeScript `7.0.2` is the current `latest`. We are pinning **`6.0.3`**. Two independent
reasons, either of which alone is decisive:

1. **`ts-jest@29.4.12` declares `typescript: ">=4.3 <7"`.** TypeScript 7 is excluded by the
   test runner's own peer range. Testing is the point of this repo (`CLAUDE.md` §5), so a
   toolchain where tests cannot compile is not a toolchain.
2. **`@nestjs/cli@12.0.0` itself depends on `typescript: ~6.0.2`.** The NestJS 12 toolchain
   is built and tested against TypeScript 6. TypeScript 7 is the Go rewrite of the compiler
   and the decorator-heavy ecosystem has not landed on it yet — and this codebase is entirely
   decorator-driven, from `@Injectable()` to `@Sse()` to every `class-validator` rule.

**Alternatives considered before settling for 6.0.3:**

- *TypeScript 7 with `@swc/jest` instead of `ts-jest`.* This does clear the peer conflict, and
  Nest supports SWC officially. Rejected because SWC does not type-check — it strips types and
  runs. On a codebase whose entire premise is "the server does not trust the client," silently
  losing type checking in the test path trades away the thing being tested. It also still
  leaves `@nestjs/cli` on TS 6, so we would be running two compiler versions.
- *TypeScript 5.9.3, the last 5.x.* Safe and boring. Rejected because 6.0.3 satisfies every
  peer range in the tree, is what the Nest CLI ships, and is a full major newer for no extra
  risk. There is no reason to go two majors back when one is free.

This is recorded as a decision in `docs/DECISIONS.md` D-006, since a pinned compiler version
is exactly the kind of choice that needs defending later.

---

## 5. Open questions this file cannot settle

Flagged here so they are not lost. Neither blocks `feat/scaffold`.

1. ~~**Authentication has no design.**~~ **Resolved 2026-09-07 (D-008).** Demo auth: hardcoded
   accounts (`admin`, `business`, `user1`..`user10`, password `demo1234`), HMAC-signed token,
   **zero new dependencies** — no `@nestjs/jwt`, no `passport`. Authorization is real and
   tested: deny-by-default global guard plus `@Roles()`, 12 boundary tests.
2. **`@nestjs/schedule` may not survive contact with the deploy target.** The README says the
   API spins down after ~15 minutes idle and `SESSION_ABANDON_AFTER_SECONDS` is 900 — exactly
   15 minutes. An in-process cron does not run while the process is asleep. If the reaper moves
   to lazy-on-read, this dependency comes out.
3. **Mongo transactions need a replica set.** `CLAUDE.md` rule 9 requires a transactional
   submit. The `mongo:7` container in `docker-compose.yml` is standalone, so transactions throw
   locally while working fine on Atlas. This is a compose change, not a dependency change, but
   it is the same class of thing and it belongs on someone's list.
