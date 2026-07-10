# Architecture Decision Records

One file per decision. Filename is `YYYY-MM-DD-short-slug.md` — the date is when the decision
was made, not a sequence number. New decisions are added at the current point in time; nothing
here ever gets renumbered.

Each file:

```markdown
# Title

**Status:** Accepted | Superseded by [[later-file]] | Amended by [[later-file]]

**Context:**
What prompted the decision — the problem, the question, the constraint.

**Decision:**
What was decided.

**Consequences:**
What follows from it — what it fixes, what it costs, what it rules out.
```

A decision that's later reversed or replaced keeps its file — set `Status` to point at the file
that supersedes it — rather than being edited or deleted. The record of *why something used to be
true* is as valuable as the current answer.

`../ARCHITECTURE.md` is the living guide to how the app is actually built today. This folder is
the history of how it got that way. When in doubt about current behavior, read `ARCHITECTURE.md`;
when you need to know why, come here.
