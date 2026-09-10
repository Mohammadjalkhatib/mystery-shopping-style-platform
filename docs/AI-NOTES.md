# Where the AI got it wrong, and where I overrode it

Required by the assessment brief: "a short note on where the AI got something wrong or you
overrode it, and why."

Write entries **when they happen**, not at the end. A reconstructed list reads as
reconstructed, and the point of this file is that it is a real record.

Worth including at least one case where the model was right and I overrode it anyway and
then reverted. An honest log has both directions in it.

## Format

```markdown
### YYYY-MM-DD - short title

**What it did.** The suggestion or the code, specifically.

**Why it was wrong.** Not "it was bad", the actual reason.

**What I did instead.**

**Would I have caught this without knowing the domain?** Yes / no. This is the interesting
question, and the answer is the whole argument about where to hand work off.
```

---

<!-- Entries below. Do not delete or tidy them before submission. -->

### 2026-09-07 - The geo-fixtures skill had a wrong reference distance

**What it did.** `.claude/skills/geo-fixtures/SKILL.md` stated: "Distance from
`KUWAIT_CITY_CENTRE` to `SALMIYA` is roughly 9.6 km. Use that as the known-value assertion
for the haversine test rather than inventing a synthetic pair." I wrote the haversine
implementation and its test, and the test failed: the implementation returned 10.62 km.

**Why it was wrong.** The skill was wrong, not the code. The true haversine distance between
(29.3759, 47.9774) and (29.3339, 48.0758) is **10.619 km**. Verified three ways before
touching anything: haversine, an equirectangular approximation (identical to the metre at
this range), and a component breakdown — 4.64 km north-south, 9.55 km east-west after the
cos(29.35 deg) correction. sqrt(4.64^2 + 9.55^2) = 10.62. The 9.6 km figure is roughly the
east-west leg alone, so it looks like the north-south component was dropped when the number
was first written down.

**What I did instead.** Corrected the skill with the right value, a note on how it was
verified, and the date. Corrected the test to assert 10.62 km with a comment explaining that
the skill originally said otherwise.

**Would I have caught this without knowing the domain?** This one is the wrong way round from
the usual entry, and that is why it is worth recording. The *instructions* were wrong and the
*model* was right. The dangerous path was obvious and available: the skill says in so many
words "use this as the assertion", so the natural move is to write
`expect(d).toBeCloseTo(9600)`, watch it fail, and then go hunting for a bug in a haversine
implementation that never had one. Earth radius, radians conversion and the atan2-vs-asin
form are all plausible-looking places to "fix" until the number matches — and any of those
edits would have broken every distance in the system while making the test go green.

The general lesson for the rest of this build: a stated constant in a project doc is an
assertion, not an axiom. Where a number is cheap to derive independently, derive it. I would
not have caught this by reading either file; I caught it because the test ran.

### 2026-09-08 - Two seam bugs that 353 passing tests could not see

**What it did.** The participant flow branch shipped with a full suite green: 353 tests, unit
and integration, every one against a real MongoDB replica set. Then the first end-to-end run
of the actual flow against the seeded database failed twice in a row.

**Why it was wrong.**

1. `create-ping.dto.ts` had `@IsNumber({ maxDecimalPlaces: 6 })` on `accuracyM`. A browser's
   `coords.accuracy` is an arbitrary double and ordinary float arithmetic produces values like
   `11.399999999999999`, so the API returned 400 on honest fixes. An attacker, picking round
   numbers, would have sailed through. Every ping fixture in the test suite used tidy values
   like `9.4` and `12`, so nothing caught it.
2. The seed wrote `clientOrgId` as whatever ObjectId Mongo generated for the organisation,
   while `demo-users.ts` gave the business account the literal string `'org-alfa-retail'`. The
   console's tenancy filter compares those two values. They never matched, so **a reviewer
   signing in as `business` would have seen an empty console for every seeded visit** — the
   headline demo, silently broken.

**What I did instead.** Removed the decimal-places constraint with a comment explaining why
precision is not the threat, and added a regression test that asserts `8.6 + 2 * 1.4` is
accepted and stored unrounded. Gave `ClientOrg` a string `_id` and made the seed and the demo
accounts share one exported constant, with a test that asserts every seeded session's
`clientOrgId` equals the business user's.

**Would I have caught this without knowing the domain?** The interesting part is not domain
knowledge, it is that **both bugs live in the seams between subsystems that are each correct
in isolation.** The DTO is correct; the fixtures are correct; they disagree about what a
plausible float looks like. The seed is correct; the demo accounts are correct; they disagree
about what names an organisation. Unit tests cannot see either, because a unit test constructs
both sides of the seam itself and is therefore self-consistent by construction. Integration
tests did not see them either, for the same reason — I built the fixtures.

The only thing that found them was running the real flow against the real seeded database and
reading the output. That is worth remembering for the rest of this build: **a green suite says
the parts agree with my assumptions, not that they agree with each other.** Where two
subsystems were written at different times, the test that matters is the one that starts from
`npm run db:seed` and ends at the screen.

### 2026-09-08 - I invented a config field that does not exist, and shipped it to main

**What it did.** `render.yaml` carried `dockerTarget: production` on the API service. There is
no `dockerTarget` in Render's blueprint schema. Render rejected the blueprint with
"A Blueprint file was found, but there was an issue" — and because that message does not name
the offending field, it looks like the file is malformed rather than like one key being wrong.
It blocked the deploy twice and it was already merged to `main` when it was found.

**Why it was wrong.** I wrote the field by analogy. Docker Compose has `build.target`, the
`docker build` CLI has `--target`, and I had just used both correctly in this repo — so a
`dockerTarget` in a Docker-runtime service read as obviously right. I never checked it. Worse,
I wrote a confident comment justifying it ("naming it means a stage added later cannot silently
become the deployed one") which made an invented field look deliberate and researched.

I did fetch Render's documentation before writing the file, and I did verify the parts I was
unsure of — the static-site shape, `plan: free`, `region: frankfurt`, the `routes` block, all
of which turned out to be correct. I verified everything except the one field I had not
consciously questioned. **The failure was not insufficient research; it was that the field
never entered the set of things I thought needed checking.**

**What was actually available.** Render publishes a JSON Schema at
`https://render.com/schema/render.yaml.json`. Downloading it and validating the file takes one
command, and both `pyyaml` and `jsonschema` were already installed on this machine. Doing that
gives a precise answer — "1 error, dockerTarget is not allowed" — instead of a dashboard
message that names nothing. I did this only after the second rejection. It should have been
the thing I did before committing a config file for a platform I had never deployed to.

**The bit that stings, and generalises.** The commit that introduced this said "Verified
locally rather than assumed" and listed four real checks — `PORT` precedence, multi-origin
CORS, the static build command, `VITE_API_BASE_URL` inlining. Every one of those was a genuine
verification of the *application* code. None of them touched `render.yaml`, which was the only
file in the commit that could not be exercised locally and was therefore the only one that
needed an external authority to check. **The verification effort went where it was easy to
apply, not where the risk was.** Feeling thorough is not the same as covering the risk, and a
list of things you did verify is not evidence about the thing you did not.

The repeating shape across all three notes in this file: the failure is never in the part being
examined. It was in the seam between two correct subsystems (D-014, D-015), in the constant
nobody re-derived, and here in the file that no local test could run. Where something cannot be
exercised locally, find the authority that can check it — a schema, a validator, the real
service — rather than reasoning about whether it looks right.

### 2026-09-08 - I called venue editing "safe" before checking whether it was

**What it did.** When I finished the admin surface I told the user that venue editing was
deliberately left out because "every started session pins a `venueSnapshot`, so an edit is safe
for visits that have not begun and needs a decision about the ones that have." That framing was
confident, specific, and it made the missing feature sound like a small product question waiting
on a preference.

**Why it was wrong.** It was half true, which is worse than plainly wrong. `venueSnapshot`
does protect a completed verdict — the evaluator reads it (D-012). But **ping ingest was still
reading the venue live**, so each fix's stored `distanceM` and `presence` were computed against
whatever the venue looked like at the moment that fix arrived. The evaluator then consumed those
per-fix values alongside a snapshot venue. Editing a venue during an active visit would have put
two vintages of geofence into one trace: not a preference, a data-corruption bug, and the third
time this exact seam has bitten this project. I had read the schema comment saying the snapshot
existed and assumed it was used everywhere it needed to be, rather than checking the one file
that would have told me.

**What I did instead.** Checked `pings.service.ts` before writing the endpoint — prompted by
asking "what would make this unsafe?" rather than by any test failing. Switched ingest to the
snapshot with a fallback for pre-D-012 sessions, and wrote the regression first: put the snapshot
5.5 km from the live venue and assert a fix at the snapshot reads `inside`. It fails without the
change. Only then built `PATCH /venues/:id` (D-021).

**Would I have caught this without knowing the domain?** No, and that is the point. All 420
tests passed before and after; nothing was red. The bug lived in the agreement between two
subsystems that were each individually correct and individually tested, and it was only reachable
through a feature that did not exist yet. What surfaced it was domain reasoning — knowing that a
geofence has a vintage and that mixing vintages is the failure this codebase has already fixed
twice — not any signal the tooling could produce. The honest lesson is narrower than "check your
assumptions": when a comment tells you an invariant exists, find every reader of that field
before you rely on it.


### 2026-09-10 - I wrote an invariant that did not run, and a comment that said it did

**What it did.** The `users` collection has one combination that must never exist: an admin with
an organisation, or a business or participant without one. Either way the account is unreachable
rather than broken-looking — the tenancy filter matches nothing, so the person signs in fine and
their console is simply empty forever. I put the check in a Mongoose field validator on
`clientOrgId`, cross-referencing `this.role`, and wrote a comment claiming it held at the schema
level "for the same reason D-010 bounded `radiusM` here: a seed or a migration must not be able
to reach past it."

**Why it was wrong.** The validator runs on `create()` and nowhere else that matters. Mongoose
does not run validators on `updateOne` / `findOneAndUpdate` at all unless asked with
`runValidators`, and when asked it binds `this` to the **Query**, which has no `role` — so my
guard clause `if (!this?.role) return true` returned true and the check passed silently on
exactly the paths that can reach the invalid state. Upserts skip it too, which is what the seed
was going to use. My comment even described the failure and got it wrong in a specific way: it
said `this` would be "a bare object on findOneAndUpdate", which is not a thing. So the invariant
was decorative, and the comment asserting otherwise would have been believed by the next person
— including me, later.

**What I did instead.** The `schema-reviewer` pass found it before any of it was applied, and
was precise about which operation does what. I replaced the field validator with a
`pre('validate')` hook for creation and a `pre(/^(updateOne|updateMany|findOneAndUpdate|...)$/)`
hook that refuses any update touching `role`, `clientOrgId`, `_id` or `username` outright —
`role` and `clientOrgId` are set once, and a partial `$set: { role: 'admin' }` carries no
organisation to check the invariant against anyway. Same shape as the append-only hook already on
`SessionEventSchema`. Then I wrote four tests that go **at the database directly rather than
through the API**, because the API refuses all of this already and testing through it would have
passed against the broken version too.

**The pattern, since this is the third time.** D-012 was a comment saying `sessionEvents` was
append-only with nothing stopping an `updateOne`. The venue-snapshot note above was a comment
saying an invariant existed while one reader ignored it. This one is a comment saying a validator
enforced something it structurally could not. Each time the code was plausible, the tests were
green, and the comment was the thing that made it look finished. I do not think the lesson is
"write fewer comments" — it is that a comment claiming an invariant is a claim that needs the
same verification as a claim about behaviour, and the cheap way to verify it is to try to
violate the invariant from below, at the layer the comment says is protected.

### 2026-09-11 - I asserted a dependency did not exist, and designed around the gap

**What happened.** Porting the participant screens, I needed three glyphs for the presence
states. I wrote them as hand-drawn SVG paths and justified it in the component comment: "the app
has no icon dependency and one is not worth adding for three glyphs." I then repeated that
justification in D-044's consequences paragraph, and merged both to `main`.

`@mui/icons-material` 9.4.0 is a direct dependency in `apps/web/package.json`. It was already
imported in three files — `ParticipantApp.tsx`, `NotificationBell.tsx`, `History.tsx` — one of
which I had read earlier in the same session.

**Why it was wrong.** I never looked. The claim was not a conclusion from evidence, it was an
assumption I needed in order to justify the thing I was already writing, and I wrote it in the
confident register the rest of the file uses, which is what made it survive review — my own and
otherwise. It cost nothing to check: `node -e "require('./apps/web/package.json')"`, one command,
and the answer was unambiguous. I only ran it because I noticed `StorefrontIcon` in a grep result
I was reading for a different reason.

Worth naming precisely: the bug was not "hand-drew some icons". Hand-drawn SVG is a defensible
choice. The bug is that I recorded a **reason** that was false, in two places designed to be
trusted later — a code comment and a decision entry. A future reader deciding whether to add an
icon library would have found D-044 saying the project deliberately has none.

**What I did instead.** Swapped the three paths for the outlined MUI icons, corrected the comment
to say where the icons come from and to point at this note, and added D-045 rather than editing
D-044 — the decision log is append-only and a wrong entry that gets quietly fixed is worse than
one that gets visibly superseded. Also learned in passing that `HelpOutline` is a v5 name that v9
dropped; the import is `HelpOutlined`.

**The pattern.** The AI-NOTES entry above this one is about a comment claiming an invariant that
did not run. This one is about a comment claiming a fact about the repo that was never checked.
Same shape: the code worked, the tests were green, and the prose was the part that was wrong. The
difference is that the invariant one needed a test to catch and this one needed a single grep, so
the rule I want is narrower and cheaper — **any claim about what the repository contains or does
not contain gets verified before it is written down, not after.** "The app has no X" is a claim
about the repo. So is "nothing else uses this". Both are one command away.
