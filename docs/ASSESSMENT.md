# System design writeup, and answers to the brief

This is the document the brief asks for: the design, the reasoning, and direct answers to the
questions it raises. It assumes you have read the first two sections of `README.md` and nothing
else.

Everything here is answered from what was actually built and, where possible, from what was
actually measured. Where a number comes from a real visit on a real phone, it says so. Where
something is unbuilt or unverified, it says that too.

---

## 1. What the system is, in one paragraph

A business assigns a participant a task at a venue. The participant opens a web app, reads a
consent screen, starts a visit, and their location is sampled while the page is open. They end
the visit and file a short report, optionally with a photo. Submitting writes the report, the
state change and one outbox row in a single transaction; an evaluator picks that row up
afterwards and produces a **score, a verdict, and a list of signals each carrying a
human-readable reason**. The business console shows the visit appear on its own over SSE, with
the evidence trail attached and a review queue for anything ambiguous.

---

## 2. Architecture

The diagrams live in `README.md` under **Architecture** — a data-flow diagram and the session
state machine, both ASCII so they survive a diff. Rather than repeat them, here is the part that
is easy to miss: **the three seams where this system is deliberately decoupled**, because each
one is load-bearing and each one is a decision.

```
   CAPTURE                    INGEST                   EVALUATION            PRESENTATION
   (browser, untrusted)       (server, authoritative)  (pure function)       (console)

   watchPosition              POST /pings              evaluate(evidence)    SSE /console/stream
   throttle 30 s              server stamps            score + verdict       verdict + reasons
   localStorage queue   ──▶   receivedAt         ──▶   + signals       ──▶   review queue
   watchdog                   computes distance        NO I/O AT ALL
                              pins venueSnapshot
        │                          │                        │                     │
        │ gaps are honest          │ rule 2: the client     │ rule 8: results     │ rule 6: never
        │ evidence, not            │ never supplies a       │ are append-only,    │ reads the ping
        │ failure (D-005)          │ distance or a time     │ carry engineVersion │ collection
```

**Seam 1 — capture is best-effort and says so.** A backgrounded tab is throttled by every
browser, so the app releases the location watch when the page hides rather than recording stale
fixes. The gap is then *visible* in `coverageRatio` instead of being silently papered over. This
is the single most important design commitment in the project and section 5 explains why.

**Seam 2 — submission and verification are decoupled through an outbox.** Submit is a fast
transactional write that never waits for a verdict. The evaluator runs after, can be retried,
and can be re-run under a newer `engineVersion` — which matters because the thresholds are
placeholders and will change.

**Seam 3 — the engine is a pure function.** `apps/api/src/verification/` imports no Mongoose,
performs no I/O, and reads no clock. It takes an evidence object and returns a result object.
That is why it has 117 tests over synthetic traces and why the whole rule set could be
red-teamed and rewritten twice in an afternoon without touching a database.

---

## 3. The brief's questions, answered

### 3.1 What does "session" mean as a piece of state, and what states can it be in?

A session is **one participant's one attempt at one assignment**, and it is the only thing in
the system that owns time. Six states:

```
                  start              end               submit
    pending ─────────────▶ active ─────────▶ ended ─────────────▶ submitted *
       │                     │                 │
       │ abandon             │ abandon         │ abandon
       │                     │ expire          │
       ▼                     ▼                 ▼
   abandoned *          abandoned *        abandoned *
                         expired *
                                                        * terminal
```

Three things about it are deliberate:

**Every transition goes through one allowlist**, in `session/state-machine.ts`, which is pure and
has no clock. An illegal transition returns **409 with the current state and the events that
would have been legal** — it never silently no-ops, because a silent no-op is how you get two
"start" calls and one session that thinks it began twice.

**Nothing leaves a terminal state.** Verification results are append-only and carry an
`engineVersion`; a verdict that could be reopened by a later state change would make that
guarantee meaningless.

**`ended → expired` is deliberately absent.** The hard cap bounds how long we *track* someone.
Once they have ended the visit we are not tracking, so an unsubmitted report is `abandon`, not
`expire`. Keeping both would put two timers in a race over one document.

The write is a compare-and-swap — the current state is part of the update filter — so two
concurrent requests cannot both win.

### 3.2 What happens if the participant closes the app or loses connection mid-session?

Three different failures, three different answers.

**Lost connection.** Fixes are queued in `localStorage` and flushed when the network returns.
Ingest is idempotent on `(sessionId, clientPingId)` with the UUID generated on the client, so a
flush that runs twice produces one document. The upsert is `$setOnInsert`, never `$set` — with
`$set` a client could resend a known `clientPingId` carrying different coordinates and quietly
move a fix after the fact.

**Closed the tab.** Capture stops, which is correct. The session is reaped **lazily on read**
(D-016, D-019): the participant's own reads and the console's reads sweep overdue sessions.
Not a cron, because on a free tier that sleeps a cron stops silently on a missed ping or a
redeploy, and the abandon window is the same order as the idle window. The participant is then
told *which* timer fired — never started, went quiet, or ended without filing — because the
engine already distinguishes those and a bare "abandoned" tells them nothing.

**The honest limitation, measured.** On a 50-minute drive on a real phone, capture produced four
fixes at a perfect 30 s cadence and then **two isolated fixes in 48 minutes**. Whether the watch
died or the screen was simply off is not answerable from the trace — which is itself the defect,
because the design treats a missing fix as a gap rather than an error. That produced the
**capture watchdog** (D-023): if `watchPosition` says nothing at all — no fix *and no error* —
while the page is visible, the watch is presumed dead and re-attached, and the restart count is
shown to the participant. It never runs while hidden, because a silent watch on a locked screen
is correct behaviour.

### 3.3 What happens if they deny location permission, or GPS is inaccurate?

**Denied** is a first-class state, not an error. The tracker exposes `permission: 'denied'` and
the screen says plainly that the visit cannot be verified without it. The visit still runs and
can still be submitted; it will simply score `noUsableEvidence` at −35 and land in review. The
participant is never trapped.

**Inaccurate** is handled by treating accuracy as a real quantity rather than a nuisance:

- Above `ACCURACY_CAP_M` (100 m) a fix is `presence: 'unknown'` — evidence of neither presence
  nor absence, and the engine scores it as *missing*, not as *absent*.
- Accuracy is never rounded at ingest, because Android reports quantised repeats and rounding
  would trip the spoof branch on honest traces.
- `indoor` is a per-venue flag and the engine is told not to punish degraded indoor accuracy.

That last point was got **wrong** and then fixed with real evidence. The original rule docked
12 points for a median under 8 m at an indoor venue, on the premise that indoor fixes degrade to
tens of metres. That was true of older hardware and is false of a phone fusing GNSS with Wi-Fi:
it produced false positives on **three separate real honest visits**. It now tests the
*dispersion* of accuracy rather than its level — a real receiver's estimate wanders, a generated
one clusters — which is what the rule was reaching for all along (D-032).

### 3.4 What does "verified" actually mean, and how confident can the system reasonably be?

**This is the question the whole design turns on, and the honest answer is uncomfortable.**

From a web browser there is no way to distinguish a real GPS fix from a fabricated one.
DevTools overrides geolocation in two clicks; a four-line console snippet replaces
`navigator.geolocation.watchPosition` with a function that returns whatever you like. There is
no mock-location flag exposed to the web, no Play Integrity, no DeviceCheck, no attested sensor
stream. **A competent forgery is byte-for-byte an honest trace, and no amount of signal design
changes that.**

So the system does not answer "was the participant there?" It answers **"how much should a human
trust this visit, and if not much, what exactly should they look at?"** There is no boolean
`verified` anywhere in the codebase. Every visit gets a score 0–100, a verdict from
`auto_verified | needs_review | rejected`, and an array of signals each carrying a sentence a
business user can act on.

Eight signals, each a pure function of the evidence:

| signal | what it actually asks |
|---|---|
| `noUsableEvidence` | was there anything to judge at all |
| `proximity` | how close did they get, against *this* venue's radius |
| `presenceDwell` | how long inside, and across how many separate observations |
| `coverage` | how much of the session did we actually watch |
| `jitterFingerprint` | does fix-to-fix movement look like a receiver or like a constant |
| `accuracyRealism` | does the accuracy estimate wander like a real one |
| `teleport` | is the implied speed physically possible |
| `clockSkew` | does the device clock agree with ours |

**What the confidence actually is, measured.** The maximum reachable score is **88** and the auto
threshold is **75**, so every trace carries a 13-point cushion — which means any penalty smaller
than 13 cannot stop anything on its own. That arithmetic governs the whole rule set and is
written down, because it is the difference between a signal and a decoration.

The engine was red-teamed twice by a dedicated subagent. Current standings:

| trace | score | verdict |
|---|---|---|
| honest outdoor / indoor / good-phone indoor | 88 | auto_verified |
| honest but 58 % observed | 66 | needs_review |
| tight-cluster fabrication | 71 | needs_review |
| four-ping ladder | 70 | needs_review |
| padded (mostly-real, two spoofed fixes) | 56 | needs_review |
| frozen coordinate override | 19 | **rejected** |
| **competent scripted forgery** | **88** | **auto_verified** |

That last row is not a bug and must not be "fixed": it is the same trace as the honest one, so
anything that moved it would move an honest visit with it. **The job this engine can actually do
is separate the incompetent forgery from the competent one and price the competent one out of a
casual attempt.** Judged against that standard it works. Judged against "proves presence" it
cannot, and neither can anything else on the web platform.

### 3.5 What should the participant see and understand about why their location is tracked?

This is the part of the brief I took most seriously, because it is the part a user is affected by
and cannot inspect.

The consent screen is written to be **read, not skipped**. It is gated: an "I have read this"
button unlocks the agree button. Four sections, each answering a question the participant would
actually ask —

- **What is collected**: device location, sampled only while the page is open and in front of
  them, from start to end. Nothing before, nothing after.
- **What it is used for**: to judge how well the evidence supports the visit. A score and
  reasons, never a yes/no, and never proof they were somewhere. A human reviews anything
  uncertain.
- **How long it is kept**: the raw trail is deleted automatically by a TTL index — *by the
  database itself, not a job someone has to remember to run*. The summary is kept. An attached
  photo is kept with the report and is **not** on that schedule, and the copy says so.
- **What this app cannot do**: it cannot follow them in the background. If they lock the phone
  or switch apps it stops receiving location, and the gap is recorded as a gap.

Consent is versioned and recorded against the **assignment** with a server timestamp, so it
survives a session being abandoned and re-created, and consenting twice keeps the **first**
timestamp — because the question a dispute asks is when they first agreed, not when they last
tapped.

During the visit the screen is honest in real time: `Capturing` vs `Paused`, the number of
locations recorded, when the page is backgrounded and why that is expected, and how many
restarts the watchdog has had to make. **Nothing is hidden from the participant.**

The one place this gets genuinely delicate is **discreet mode** (D-025): a dark clock overlay so
a shopper is not standing in a store holding a bright page headed "Capturing". It conceals from a
bystander — it never conceals from the participant. A dim line saying the visit is still running
never leaves the screen, and it does not imitate a real lock screen, because cloning system UI is
a phishing pattern and unnecessary.

**Privacy controls that are actually enforced, not promised:** the TTL is reconciled to
`PING_RETENTION_DAYS` on every boot and is owned by exactly one file; the business console is
structurally forbidden from reading the ping collection (rule 6) and reads only rollups; and a
business user can read an evidence photo **only once the participant has submitted the report
that references it** — org membership alone is not enough, because a photo from a visit they
abandoned was never given to the client.

### 3.6 How would this hold up at thousands of active sessions?

Honestly: **the read paths would hold, three specific things would break, and I know which.**

**What holds.** Every hot query is index-backed and was reviewed by a schema-reviewer subagent
before it shipped. The console never joins to pings — the verdict is denormalised onto the
session by the evaluator, so the visit feed is one indexed query on
`{ clientOrgId, state, endedAt }`. Ping ingest is an idempotent upsert on a unique compound
index with a per-session cap of 4000, and the counter lives on the session so ingest can reject
cheaply without a `count()` on the hot collection. Submit is one transaction touching three
documents.

**What breaks first, in order:**

1. **SSE fan-out is in-process.** The console stream and its replay buffer live in one Node
   process. Two instances and half the consoles miss half the events. The fix is a Redis
   pub/sub or Mongo change stream behind the same interface — the controller would not change.
2. **The reaper is lazy-on-read.** Correct on a free tier that sleeps, wrong at scale: a session
   nobody looks at stays `active` indefinitely. At thousands of sessions that needs a real
   scheduler on a tier that does not sleep, and the sweep is already capped at 100 per read so
   it degrades rather than stalls.
3. **The geocoder's cache and rate limiter are per-process.** Two instances double the upstream
   rate against a service whose limit is per *application*.

**What would need rethinking rather than scaling:** raw pings are the largest collection and the
most sensitive. At thousands of concurrent sessions the TTL is doing real work and the retention
window becomes a cost decision as well as a privacy one. And evidence photos currently share the
512 MB Atlas tier unless an S3 bucket is configured — which it now can be, in four environment
variables.

### 3.7 Is there anything about the idea itself you'd push back on?

Yes, three things, and I raised them by building differently rather than by writing a note.

**1. "Verify that a participant physically visited a location" is not achievable, and selling it
as achievable is the real risk.** Not a technical limitation to be engineered around — a property
of the platform. I built the whole system to answer a weaker, honest question instead, and every
piece of user-facing copy repeats it. If this were my product the thing I would refuse to ship is
a green tick, because the moment a business sees one they will stop reading the reasons, and the
reasons are the entire product.

**2. A verdict is a decision about a person, and the UI must not launder it.** When asked for a
view of "who's working and who's cheating", I built the reporting half and refused the second
half. The People tab ranks **who needs looking at**, with each participant's most frequent
failing signal — because `proximity` failing every time is a different investigation from
`coverage` failing every time. The banner says specifically what else explains a run of
rejections. This is not caution for its own sake: in this very database, a participant showed a
0 % pass rate because a venue had been saved at a coordinate 4.8 km from where they stood. A
"trust score" would have accused a person for a typo.

**3. The most valuable signal available is the one nobody can build on day one.** Participant
history is by far the strongest evidence — forty consistent visits and one odd trace is a
completely different problem from a new account with one odd trace — and it is worthless with no
history. It is top of the "what I'd build next" list and deliberately not faked.

**One thing I would add to the product that the brief does not mention:** the participant should
see their own verdict and its reasons. Currently the evidence trail is business-facing only. A
system that scores people and does not show them the score is one they cannot learn from or
dispute, and the reasons are already written in plain language.

---

## 4. Where the AI got it wrong

Seven entries in `docs/AI-NOTES.md`, written when they happened. The most instructive:

**I described venue editing as "safe" before checking whether it was.** I said started sessions
pin a `venueSnapshot` so an edit is safe — confident, specific, and half true. The evaluator did
read the snapshot; **ping ingest was still reading the venue live**, so editing a venue mid-visit
would have put two vintages of geofence into one trace. All 420 tests passed either side of it.
What caught it was asking "what would make this unsafe?" and reading the one file that would
answer, not any signal the tooling could produce.

**The subagents earned their keep and are the part of the AI setup I would defend hardest.**

- `schema-reviewer` found two **blocking** issues before evidence upload shipped: unbounded photo
  growth that would exhaust a 512 MB Atlas tier and break *writes database-wide* — surfacing
  first as ping ingest failing, three layers from the cause — and orphaned photos that no
  retention rule covered.
- `spoof-adversary` ran twice on one change. The first pass found that my fix for a false
  positive had flipped a fabricated trace from 68 to **88** with the attacker changing nothing.
  The second pass found **four more bugs in the fix**. Neither pass was ceremony; both changed the
  code.

The general lesson: **AI is most useful pointed at the seam between two things that are each
correct alone.** Every real bug in this project lived there — a DTO validating a storage key as a
MongoDB id after the storage layer stopped issuing those; a seed and a demo account disagreeing
about an org id; a re-seed resurrecting submitted sessions. A green suite says the parts agree
with your assumptions, not with each other.

---

## 5. What I would improve, by area

Ordered by what would change the product most, not by effort.

### Frontend

- **Show the participant their verdict and reasons.** The single highest-value addition. The
  copy already exists and is already human-readable.
- **Verify the RTL pass on a real device.** The Arabic translation and layout are complete and
  unit-tested but have never been *looked at* on a phone. A component using a physical
  `marginLeft` will not mirror and nothing warns.
- **A capture-health explainer.** The tracker already knows `visible`, `wakeLock`, `restarts` and
  `pending`. A participant who understands why coverage dropped can fix it mid-visit.
- **Offline-first shell.** A service worker so a dead connection at the venue does not lose the
  report form itself; the fixes are already queued, the form is not.
- **The map needs a paid tile host and reverse geocoding.** Community OSM tiles are demo-grade,
  and the pin does not tell you what it is sitting on.

### Backend

- **Snapshot `expectedDwellSeconds` onto the session at `start`**, the way `venueSnapshot` is.
  It is resolved live today, which is safe only because tasks cannot yet be edited. The moment
  task editing lands, an edit would silently re-score visits that already happened.
- **Move SSE fan-out out of process** (see 3.6).
- **A real scheduler for the reaper**, once the hosting can support one.
- **Evidence retention.** Photos never expire while pings do at 30 days. A photo taken inside a
  venue is at least as identifying as a coordinate. The correct shape is a sweep calling
  `bucket.delete()` — **not** a TTL index, which on GridFS deletes the file document without
  cascading to the chunks, stranding the bytes permanently *and* unreachably.
- **Edit and delete across the admin surface.** Venues can be corrected; tasks and assignments
  cannot be touched at all.

### Security

- **`presenceFor` treats client-controlled `accuracyM` as a fence extension.** This is the
  cheapest remaining attack and it is documented, not fixed: reporting 90 m accuracy turns a
  120 m fence into a 210 m one, so someone can stand across the road with entirely real
  coordinates and score 88. The fix is to make the error ball *shrink confidence* rather than
  *widen the fence* — a deliberate behavioural change, not a patch.
- **Demo auth is a hardcoded roster** (D-008). Authorization is real and tested per boundary;
  authentication is not. Real deployment needs sessions, rotation, and rate-limited login.
- **`clockSkew` is currently a pure honest-participant tax** — an attacker sets
  `capturedAt = Date.now()` for free, while the only population reaching the threshold is someone
  flushing a long offline queue. Replace with skew *variance* or delete it.
- **Rate limiting on ingest.** Nothing bounds how fast a participant can POST fixes beyond the
  per-session cap.
- **Atlas allows `0.0.0.0/0`** because free Render services have no static egress IP. Acceptable
  only for demo data behind its own credentials, and it should be the first thing narrowed.

### Features worth building next

1. **Participant reputation.** The strongest signal available, useless without history, top of
   the list the moment there is any.
2. **Labelled data, then tuned thresholds.** Every weight and band is a considered guess. A few
   hundred reviewed visits turn the review queue into training data and make the numbers
   answerable instead of arguable.
3. **Server-side localisation of the signal reasons.** The participant screens are bilingual; the
   evidence trail is not, because those sentences are composed on the API. Returning a code and
   parameters instead of a sentence is a better shape anyway — a reason a client can render is
   one it can also filter, group and chart.
4. **Per-venue breakdown in the People view.** A participant failing only at *one* venue is the
   clearest possible sign that the venue, not the person, is the problem — exactly the case that
   already occurred here.
5. **An AI pass over report text**, flagging reports that do not describe the venue they claim to
   describe. This is the one place an LLM adds something the geometry cannot, and it is checkable
   against the photo.

**What I would not do next: add more signals.** The engine already produces more evidence than
there is data to calibrate it against, and another signal without labels is another guess wearing
a number.

---

## 6. Deliverables map

| The brief asks for | Where it is |
|---|---|
| Working code, runnable by someone else | `README.md` — three sections: without Docker, with Docker, and against the live deployment |
| Agent / subagent configuration, unedited | `.claude/agents/` (3), `.claude/skills/` (2), `.claude/settings.json`, `CLAUDE.md` |
| System design writeup with a diagram | This file, plus the two ASCII diagrams in `README.md` → **Architecture** |
| Decision log, 3–5 key decisions with alternatives | `docs/DECISIONS.md` — 50 entries. The five that matter most are listed below |
| Tests, where judged worth having | 650 across 25 suites. Rationale in `README.md` → **Testing** |
| Where AI got it wrong | `docs/AI-NOTES.md` — 7 entries, and section 4 above |

**If you only read five decisions**, read these:

- **D-001** — what "verified" means, and the refusal to ship a boolean.
- **D-005** — capture is best-effort and gaps are honest evidence. Everything else follows.
- **D-010** — the first spoof-adversary pass, which found that the dwell rule paid a forgery
  more than an honest visit.
- **D-016** — hosting, and why the reaper is lazy-on-read rather than a cron.
- **D-032** — fixing two false positives re-opened the fraud engine, and the two red-team passes
  that caught it.

`docs/MEMORY.md` is the running state of the system, one entry per merged branch, 52 of them.
It is what lets a fresh session pick up without re-reading the codebase, and it is the most
useful thing in the repo for understanding *how* this was built rather than what it does.
