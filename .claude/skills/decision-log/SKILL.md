---
name: decision-log
description: Records an engineering decision in docs/DECISIONS.md with the alternatives considered and why they were rejected. Use whenever a non-trivial choice is made about stack, data model, algorithm, protocol, scope or a threshold value. Also use when reversing an earlier decision.
---

# Decision log

`docs/DECISIONS.md` is a graded deliverable for this project. The brief says explicitly that
this is where they see whether the work was thought through or whether the first answer was
taken. Entries written during the work are worth more than entries reconstructed at the end,
so write them as they happen.

## When to use this

Any of:

- choosing a library, framework, database, protocol or hosting target
- choosing a data model shape, or changing one
- choosing an algorithm or a threshold value
- deciding not to build something
- reversing an earlier decision (do not edit the old entry, add a new one that supersedes it)

Not for: naming things, file layout, formatting, or anything you would not be asked to
defend.

## Format

Append to `docs/DECISIONS.md`. Never edit an existing entry except to add a
`Superseded by D-NN` line.

```markdown
## D-007: <short imperative title>

**Date:** YYYY-MM-DD
**Status:** accepted | superseded by D-NN

**Decision.** One or two sentences. What we are doing.

**Context.** What forced the choice. What constraint or requirement made this a real
question rather than an obvious default.

**Alternatives considered.**

- *<Alternative A>.* Why it was plausible. Why it lost. Be specific, "too complex" is not
  a reason, "adds a second deploy target and an auth story for no visible benefit in a
  three day build" is.
- *<Alternative B>.* Same.

**Consequences.** What this costs us. What we now cannot easily do. What we would change
if the constraint went away.
```

## Rules

- Every entry names at least one real alternative that was genuinely considered. An entry
  with no alternative is not a decision, it is a note.
- State the cost. An entry with no downside is a sales pitch, not a decision log.
- If a threshold value is arbitrary, say it is arbitrary and say what would make it
  principled. That is a stronger answer than pretending it was derived.
- Keep entries short. Six to twelve lines. Nobody reads a long decision log.
- Number sequentially and never reuse a number.
