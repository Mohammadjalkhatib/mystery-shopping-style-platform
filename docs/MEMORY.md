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
