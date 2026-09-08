# Mystery Shopping Visit Verification

A thin end-to-end slice of location-verified field visits. An admin creates a task tied to a
venue and assigns it to a participant. The participant opens the web app, consents, starts a
visit, keeps the tab open while on site, ends the visit and submits a report. The business
console shows the completed visit appear on its own, with a verification verdict, no refresh.

> Fill the TODOs in this file as features land. Do not leave them for the end. A reviewer
> should be able to clone, run and understand this without asking a question.

---

## What "verified" means here, and what it does not

The system does not claim to prove that anyone was anywhere. It cannot. From a web browser
there is no way to distinguish a real GPS fix from a spoofed one: DevTools overrides
geolocation in two clicks, and the web Geolocation API exposes no equivalent of the native
mock-location flag. Honest consumer GPS also carries roughly 7 to 13 m of error outdoors and
far more indoors, which is where a mystery shop actually happens.

So the question this system answers is not "was the participant there?" It is **"how much
should a human trust this visit, and if not much, what exactly should they look at?"** Every
visit gets a score, a verdict, and an evidence trail with human-readable reasons. High
confidence auto-approves, low confidence rejects, and the ambiguous middle goes to a review
queue. That still meets the requirement of not having a human check every visit. It just does
not pretend to a certainty the platform cannot support.

See `docs/DECISIONS.md` D-001 for the full reasoning.

---

## Features

<!-- Keep this current with dev. One line each. -->

Built and working end to end:

- [x] Demo auth: three roles, deny-by-default guards, one test per authorization boundary
- [x] Participant consent screen, versioned and recorded with a server timestamp
- [x] Participant starts a visit session, server-authoritative state machine
- [x] Location sampling while the tab is visible, with Screen Wake Lock
- [x] Offline buffering, idempotent flush on reconnect
- [x] Participant ends the session and submits a report
- [x] Verification engine: score, verdict, signals — each with a human-readable reason
- [x] Report submission and verification decoupled through an outbox, with a lease
- [x] Business console live visit feed over SSE, no refresh, replay across reconnects
- [x] Review queue as a filter on the feed, with a recorded human override
- [x] Seeded demo data, relocatable for testing outside the client's market

Not built:

- [ ] Admin UI for creating venues, tasks and assignments (seed only — see "What is missing")
- [ ] Abandoned session reaper and hard session cap (the logic exists; nothing schedules it)
- [ ] Evidence upload to object storage — deliberately cut, see "Deliberately out of scope"
- [ ] Arabic pass on participant screens
- [ ] Capture watchdog — nothing notices if `watchPosition` stops delivering silently

---

## Architecture

Three things are deployed; only one of them runs. The web app is a static bundle, so the API
is the only process, and it is what holds the SSE connections open.

```
  PARTICIPANT (phone, HTTPS)                  BUSINESS CONSOLE (browser)
  consent -> start -> pings -> end            live visit feed, review queue.
  -> report                                   One GET, then an open SSE
  pings batched 20, one every 30 s,           connection. It never polls.
  queued in localStorage while offline
              |  POST                                     ^  GET + SSE
              v                                           |
  ============================================================================
   msp-api      NestJS 12 (ESM), Mongoose 9      the only process that runs
  ----------------------------------------------------------------------------
   session/           pings/              reports/          console/
   pure state         idempotent upsert   submit is ONE     reads sessions and
   machine. 409 on    on (sessionId,      transaction:      verificationResults
   an illegal         clientPingId).      report + state    ONLY. Never the
   transition, never  Server stamps       + outbox row      ping collection
   a silent no-op     receivedAt              |                   ^
                                              | kick on submit,   | verdict
                                              | plus a 15 s sweep | event
                                              v                   |
                                      verification/  -------------+
                                      PURE. Evidence in, result out.
                                      score 0-100, verdict, signals, and the
                                      rollups the console reads: dwellSeconds,
                                      coverageRatio, minDistanceM
  ============================================================================
                                    |  Mongoose
                                    v
                        MongoDB Atlas M0  (a replica set, which is what makes
                                           transactions and TTL indexes work)

     clientOrgs   venues   tasks   assignments   sessions   sessionEvents
     pings (TTL, a privacy control)   reports   outbox   verificationResults
     reviewActions
```

The outbox is the seam that matters. `submit` writes the report, the state change and one
outbox row in a single transaction and returns; it never waits for a verdict and never fails
because the evaluator is slow. The evaluator is poked immediately after a submit so the demo
feels instant, and swept every 15 s so a lost poke, a crash or a redeploy mid-request still
gets picked up. That is what makes the outbox durable rather than decorative.

### Session state machine

Server-authoritative. The participant asks; the server decides and stamps every timestamp.

```
                      start              end               submit
        pending -------------> active ---------> ended -------------> submitted *
           |                     |                 |
           | abandon             | abandon         | abandon
           |                     | expire          |
           v                     v                 v
        abandoned *          abandoned *       abandoned *
                             expired *

        * terminal
```

Everything not on that diagram is illegal, including every self-transition, and returns 409
carrying the current state and the events it would have accepted. Two absences are deliberate:
nothing leaves a terminal state, because verification results are append-only (rule 8) and a
verdict that could be reopened would break that; and there is no `ended -> expired`, because
the hard cap bounds how long we *track* someone, and a participant who has ended their visit
is no longer being tracked.

`abandoned` and `expired` are unreachable in practice today, because `dueEvent()` is
implemented and tested but nothing calls it. See "What is missing, and why".

### Repository layout

```
apps/api          NestJS 12, Mongoose 9, SSE  (ESM package, see D-007)
apps/web          React 19, Vite 8, MUI v9, React Router 8
packages/shared   shared DTO types only
```

---

## Running locally without Docker

Requires Node 22.12+ (24 recommended), npm 10+, and a MongoDB instance.
Exact versions and the reason for each are in `docs/REQUIREMENTS.md`.

```bash
git clone https://github.com/Mohammadjalkhatib/mystery-shopping-style-platform.git
cd mystery-shopping-style-platform

cp .env.example .env
# point MONGO_URI at your local mongo or an Atlas connection string

npm install
npm run db:seed          # one client org, two venues, one task, two participants
npm run dev              # api on :3000, web on :5173
```

Object storage: without Docker you need either a local MinIO or an R2 bucket. Set the five
`S3_*` values in `.env`. Evidence upload is the only feature that needs it.


### Using MongoDB Atlas instead of the container

The free M0 tier works and is what the deployed API uses. Three things catch people out:

1. **The variable is `MONGO_URI`**, not `MONGODB_URI`. The app falls back to localhost if it
   is misnamed, so a typo looks like "Atlas is down" rather than a config error.
2. **Put the database name in the path.** Atlas copies the SRV string without one, and
   Mongoose then silently uses `test`:
   `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/mystery-shopping?retryWrites=true&w=majority`
3. **Allowlist your IP** in Atlas under Network Access, and add the deployed API's egress IP
   too. A missing allowlist surfaces as a connection timeout, not an auth error.

M0 is a replica set, so multi-document transactions (design rule 9) and TTL indexes
(rule 10) both work. Verified against 8.0.32.

**Enable the git hooks once per clone:**

```bash
git config core.hooksPath .githooks
chmod +x .githooks/commit-msg
```

---

## Running with Docker

```bash
cp .env.example .env
docker compose up --build
```

That is the whole procedure — the stack seeds itself, with no manual step.

- Web: http://localhost:5173
- API: http://localhost:3000
- Mongo: `localhost:27017` (add `?directConnection=true` to connect from the host — the
  replica set advertises itself as `mongo:27017`, which only resolves inside the network)

**Mongo runs as a single-node replica set, not a standalone.** Design rule 9 makes report
submission one transaction, and MongoDB refuses multi-document transactions outside a replica
set. A standalone container meant `submit` failed locally while working on Atlas — the worst
kind of bug, invisible until someone ran the documented command. The healthcheck initiates the
set on first start.

**There is no MinIO service.** It existed for evidence upload, which is out of scope and not
built; nothing in the repo speaks S3. The `S3_*` values stay in `.env.example` so the shape is
documented if that work resumes.

Re-running `docker compose up` re-seeds, and the seed is idempotent. It re-clocks demo
sessions that have **not started**, so the reaper cannot leave them stranded, and it creates
any that are missing.

**It does not touch a session that has already started.** Restarting the stack therefore keeps
your completed visits, their reports and their verdicts — the console looks the same after an
`up` as it did before the `down`. The seed says which happened:

```
[seed] sessions created=0 revived=9 preserved=1 -- preserved sessions have already started...
```

`preserved` is why no new session appeared for that participant. Earlier this reset every
session to `pending`, which resurrected submitted visits into a state the state machine cannot
produce and emptied the console on restart (D-015).

Reset the demo — this is the only full reset, and it destroys the visit data:

```bash
docker compose down -v
```

---

## Demo credentials

Authentication is deliberately a demo (see `docs/DECISIONS.md` D-008). Authorization is not:
routes are deny-by-default and role-guarded, with one test per boundary.

**Password for every account: `demo1234`**

| Username | Role | Sees |
|---|---|---|
| `admin` | admin | Everything. Creates venues and tasks, assigns participants |
| `business` | business | The visit console for its own client org only |
| `user1` … `user10` | participant | Their own assigned visits |

`GET /auth/demo-credentials` returns this list at runtime, so a reviewer never has to read the
source to log in.

---

## Deployed URLs

| Surface | URL | Notes |
|---|---|---|
| Participant app | https://msp-web-nc40.onrender.com | Sign in as `user1` … `user10`. Same URL as the console; the app routes by role |
| Business console | https://msp-web-nc40.onrender.com | Sign in as `business` |
| API | https://msp-api-ijht.onrender.com | `/health` answers `{"status":"ok","mongo":"up","uptimeS":N}` |

Password for every account is `demo1234`.

The web app is a static site, so it is always instant. The API is a free web service kept awake
by a 10-minute cron on `/health`; if that cron has lapsed, the first request after 15 minutes
idle takes 30 to 60 seconds while Render wakes the instance. Hit `/health` first and wait for
it before signing in — a cold start looks exactly like a broken deployment.

Location features require HTTPS, which all the deployed URLs have. `localhost` is also treated
as a secure origin, so local development works. **An IP address on your LAN will not** — this
is why the participant flow cannot be tested on a phone without deploying.

---

## Deploying

Render's free tier, Atlas M0 for the database, and a free cron to stop the API sleeping.
Why this and not Fly, Railway, Koyeb or Cloud Run is D-016. Everything below is free and none
of it needs a credit card.

The repository already contains `render.yaml`, so Render configures both services itself.

### 1. MongoDB Atlas

You need the M0 cluster and a connection string. In **Network Access**, add `0.0.0.0/0` —
free Render services have no static outbound IP, so an allowlist cannot be narrower. The
database is demo data behind its own credentials, which is the only reason that is acceptable.

### 2. Seed the Atlas database, at coordinates you can actually stand in

Render's free plan has no one-off jobs, so seed from your machine.

**Put the venues where you are.** A geofence is 75 m wide, and the deployed demo is worth
nothing if nobody can walk into one — from Amman the Kuwait reference points are 1,188 km
away, so every honest visit scores `proximity -25` and `presenceDwell -20` and is correctly
rejected. It looks like a broken engine and is not.

Faking it does not help, and that is the point of the system: a DevTools coordinate override
emits identical consecutive fixes, trips `jitterFingerprint` at -45, and is also rejected.

Get the coordinates of a spot you can reach: in Google Maps, right-click (or long-press on a
phone) on the exact spot and it shows `31.963158, 35.930359` — copy both numbers. Then, from
the repository root, in PowerShell:

```powershell
$env:MONGO_URI       = "mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/mystery-shopping?retryWrites=true&w=majority"
$env:SEED_VENUE_LAT  = "31.963158"   # <- replace with yours
$env:SEED_VENUE_LNG  = "35.930359"   # <- replace with yours
npm run build --workspace @msp/api
npm run db:seed
```

Both variables must be set or the relocation is ignored and you get Kuwait. The seed confirms
with `[seed] venues RELOCATED to ...`.

That anchor becomes **Alfa Market (outdoor)**, a 75 m fence, assigned to `user1`-`user5`.
**Alfa Store (indoor)** is placed ~440 m north-east of it with a 120 m fence and is assigned
to `user6`-`user10` — walkable from the same spot, and far enough that the two fences do not
overlap. Sign in as `user1` and stand at the anchor.

The seed prints `created / revived / preserved` counts. Re-running is safe and never touches a
session that has already started (D-015), so relocating later keeps your completed visits and
their verdicts — each session pinned a `venueSnapshot` of the geofence as it was at the time.

To put the demo back on the client's market before submitting, clear both variables and
re-seed. The venues **move**; they are not duplicated, because the upsert is keyed on the
venue name.

```powershell
Remove-Item Env:SEED_VENUE_LAT, Env:SEED_VENUE_LNG
npm run db:seed
```

### 3. Create the Render blueprint

New → **Blueprint** → pick this repository. Leave **Branch** on `main` and **Blueprint Path**
on `render.yaml`, which are the defaults.

**`main` is the deployed branch.** `dev` stays the integration branch and every feature still
merges there first, but Render tracks `main`, so what is live is always a reviewed merge
rather than whatever was pushed last. The practical consequence: **a merge into `main`
redeploys the demo**, and a push to `dev` does not.

Render reads `render.yaml` and creates both services. It will prompt for the values marked
`sync: false`:

| Prompt | Value |
|---|---|
| `MONGO_URI` | the Atlas string from step 2 |
| `JWT_SECRET` | any long random string. Generate one with `[guid]::NewGuid().ToString()` twice, concatenated |
| `WEB_PUBLIC_URL` | leave blank for now — you do not know the web URL yet |
| `VITE_API_BASE_URL` | leave blank for now — you do not know the API URL yet |

Both will fail their first build. That is expected: each needs the other's URL.

### 4. Give each service the other's URL

Once Render has assigned the hostnames (something like `msp-api-a1b2.onrender.com`):

- **msp-api** → Environment → `WEB_PUBLIC_URL` = `https://<the msp-web host>`
  Comma-separate it if you also want to run the web app locally against the deployed API:
  `https://msp-web-xxxx.onrender.com,http://localhost:5173`
- **msp-web** → Environment → `VITE_API_BASE_URL` = `https://<the msp-api host>`
  No trailing slash. Vite inlines this at **build** time, so this needs a redeploy, not a
  restart — "Clear build cache & deploy".

Redeploy both. Then check `https://<api host>/health`.

### 5. Stop the API sleeping

A free Render web service spins down after 15 minutes idle and takes 30-60 seconds to wake,
which reads as a broken deployment rather than a free tier. Render grants 750 instance-hours
a month and a 31-day month is 744, so **one** service can stay awake permanently and still be
free.

Create a free job at [cron-job.org](https://cron-job.org) or UptimeRobot:

- URL: `https://<api host>/health`
- Every **10** minutes

Point it at `/health` and nothing else. While the service is asleep Render answers
`/robots.txt` itself, so a pinger aimed there never reaches the app and never wakes it.

This is why the web app is a **static site** rather than a second web service: static sites
are free and consume none of those 750 hours, so the whole allowance goes to the API.

### 6. Verify on an actual phone

This is the point of deploying, so do not skip it. Open the participant app on a real handset,
sign in as `user1`, and confirm the geolocation prompt appears, that consent gates the visit,
and that fixes are being accepted. On iOS, background the tab for a minute and return — the
capture should stop and resume, and `coverageRatio` should show the gap rather than pretending
the time was observed.

Step 2 already placed the venues where you are, so `user1` should score a real verdict rather
than being rejected for distance. If it is rejected, check the seed logged
`venues RELOCATED to ...` and that you are standing within 75 m of the anchor.

---

## Testing

```bash
npm test
npm run test:watch
```

We test where the logic is non-obvious and where a bug fails silently: the verification
engine, the session state machine, idempotent ping ingest, geofence maths, and authorization
boundaries.

We deliberately do not test UI rendering, the map component, the SSE transport, or framework
behaviour. A wrong verdict is silent and expensive; a broken button is loud and cheap.

---

## Environment variables

See `.env.example`. Every value is documented there. The ones worth knowing about:

| Variable | Why it exists |
|---|---|
| `PING_RETENTION_DAYS` | TTL on raw location pings. This is a privacy control, not a tuning knob |
| `VERIFY_AUTO_THRESHOLD` / `VERIFY_REJECT_THRESHOLD` | Verdict banding. Config rather than constants because they are placeholders until there is labelled data to tune them against |
| `SESSION_HARD_CAP_SECONDS` | Sessions auto-end. Without this you accumulate zombie sessions and keep tracking people who think they are done |
| `S3_*` | The only values that differ between MinIO locally and R2 in production |

---

## What is missing, and why

Stated plainly rather than left to be discovered.

**There is no admin UI.** Venues, tasks and assignments exist only via `npm run db:seed`.
The data model, the tenancy boundary and the `admin` role are all in place, and the console
already reads through them — but there are no `POST /venues`, `POST /tasks` or
`POST /assignments` endpoints and no form. So a business or admin user cannot create a new
assignment from the app. The seed creates one org, two venues, two tasks and ten assignments,
which is enough to demonstrate the whole flow but not to author new work.

**Nothing schedules the reaper.** `dueEvent()` and `SessionsService.apply()` both exist and
are tested, so `abandoned` and `expired` are reachable in principle and unreachable in
practice. This is blocked on a real question rather than on effort: an in-process cron does
not run while a free-tier service is asleep, and `SESSION_ABANDON_AFTER_SECONDS` is 900 —
exactly the idle window before such a service sleeps. Reaping lazily on read is the cheap
deterministic answer and is not built.

**Location capture holds while the tab is visible and goes quiet after that.** The flow has now
run on a real handset — a 50-minute drive around Amman on 8 September 2026, deliberately outside
the geofence. What it settled, and what it did not, is worth stating precisely because the two
halves have different answers.

Capture is correct while the page is in front of you. The permission prompt works on the
deployed origin, and the first 102 seconds produced four fixes at 30, 32 and 33 second
intervals — `SAMPLE_MS` holding exactly, against a `watchPosition` that fires on movement and
was firing continuously in a moving car. Reported accuracy converged 36 m → 6 m → 5 m → 4.5 m
as the receiver locked.

The remaining 48 minutes produced two fixes. Both were isolated: one at 7 minutes, one 34
seconds before the visit ended. `onVisibility` does re-attach the watch on resume
(`useVisitTracker.ts`), so a resume should produce a *cadence*; two lone fixes is instead the
shape of "re-attached, delivered one cached position, then went quiet". A screen that was
genuinely only on for twenty seconds twice would look identical from the trace, and that
ambiguity is the point below.

**There is no capture watchdog.** If `watchPosition` stops delivering without raising an error,
nothing notices and nothing restarts it. Treating a missing fix as a gap rather than a failure
is right for *scoring* — it is what `coverageRatio` exists to weigh — but it also makes a stuck
watch indistinguishable from an honest dark screen, both to the system and to anyone reading
the trace afterwards. Distinguishing them needs a deliberate lock/unlock test, not another
drive.

**The offline queue is still untested.** This run was expected to exercise it and did not. Every
fix arrived with 1–2 seconds of clock skew, so none of them ever sat in the buffer: the 43-minute
hole is a capture gap, not a network gap. Buffering through real signal loss remains unverified.

The engine half needs no such caveat. Against six fixes over 3011 seconds it returned `rejected`
at score 0, with `coverageRatio` 9.4% — arithmetically exact once both long gaps are truncated
to the three-interval cap — `minDistanceM` 7083 m matching the real driving route, and
`jitterFingerprint` at **+2**, correctly reading honest driving GPS as a real receiver rather
than reaching for a fraud explanation.

**The brand theme is placeholder.** `apps/web/src/theme/theme.ts` still carries invented hex
values with a comment explaining how to extract the real ones.

---

## Testing away from the client's market

The client is in Kuwait and Bahrain, and the seed defaults to real Kuwait coordinates. A
geofence is 75 m wide, so **if you test from anywhere else every visit is rejected** — from
Amman the seeded venues are 1,188 km away, which scores `proximity -25` and
`presenceDwell -20`. That is the engine working correctly, and it is confusing precisely
because nothing is broken.

Overriding your location in DevTools does not help either: a fixed override emits identical
consecutive coordinates, which trips `jitterFingerprint` at −45 and is also rejected. The
system is designed to refuse exactly that.

So move the venues to you instead. In `.env`:

```
SEED_VENUE_LAT=31.9539
SEED_VENUE_LNG=35.9106
```

Then `npm run db:seed`. Re-seeding **moves** the existing venues rather than creating new
ones, so assignments keep working. Unset them and re-seed to go back to Kuwait.

The outdoor venue lands on your coordinates; the indoor one is placed about 440 m away so
both are walkable from one spot without their geofences overlapping.

---

## Deliberately out of scope

Named so it is clear these are cuts, not omissions:

- Payments and reward disbursement
- A full task authoring UI beyond the minimum admin form
- Participant reputation scoring, which is the strongest long-run verification signal but
  useless with no history. Top of the "what I would build next" list
- Native mobile apps, which are the correct answer for background tracking and mock-location
  detection and the wrong answer for a web slice
- Full internationalisation. Participant screens get an Arabic pass, nothing more

---

## Project documentation

| File | What it is |
|---|---|
| `CLAUDE.md` | Working rules and design constraints for Claude Code |
| `docs/DECISIONS.md` | Engineering decisions with alternatives and why they lost |
| `docs/MEMORY.md` | Running record of what exists and why, one entry per merged branch |
| `docs/AI-NOTES.md` | Where the AI got things wrong and where it was overridden |
