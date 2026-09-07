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
