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

- [x] Demo auth: three roles, deny-by-default guards, one test per boundary
- [x] Demo auth: three roles, deny-by-default guards, one test per boundary
- [ ] Admin creates a venue with a per-venue geofence radius
- [ ] Admin creates a task and assigns it to a participant
- [ ] Participant consent screen, versioned and recorded
- [ ] Participant starts a visit session, server-authoritative state
- [ ] Location sampling while the tab is visible, with Screen Wake Lock
- [ ] Offline buffering to IndexedDB, idempotent flush on reconnect
- [ ] Participant ends the session and submits a report
- [ ] Evidence upload to object storage, EXIF read then stripped
- [ ] Verification engine: score, verdict, signals
- [ ] Business console live visit feed over SSE, no refresh
- [ ] Review queue for the ambiguous band
- [ ] Abandoned session reaper and hard session cap
- [ ] Arabic pass on participant screens

---

## Architecture

TODO: embed the diagram. State machine and data flow both belong here.

```
apps/api          NestJS 12, Mongoose 9, SSE  (ESM package, see D-007)
apps/web          React 19, Vite 8, MUI v9, React Router 8
packages/shared   shared DTO types only
```

Key structural points:

- `apps/api/src/verification/` is pure. No Mongoose, no I/O. It takes an evidence object and
  returns a result. This is what makes it cheap to test and it is the most important code here.
- Report submission and verification are decoupled through an outbox collection. Submit is a
  fast transactional write, the evaluator runs after and can be retried or re-run with a newer
  engine version.
- The business console never reads the ping collection. It reads sessions and verification
  results, which carry rollups written by the evaluator.

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

Brings up `mongo`, `minio`, `api` and `web`, creates the bucket, and seeds the database.

- Web: http://localhost:5173
- API: http://localhost:3000
- MinIO console: http://localhost:9001 (minioadmin / minioadmin)

Stop and reset everything including data:

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
| Participant app | TODO | |
| Business console | TODO | |
| API | TODO | |

**Cold start warning.** The API is on a free tier that spins down after about 15 minutes of
inactivity. The first request after an idle period can take up to a minute while the service
wakes. Subsequent requests are normal. Load the API URL once before demoing.

Location features require HTTPS, which all the deployed URLs have. `localhost` is also treated
as a secure origin, so local development works. An IP address on your LAN will not.

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
