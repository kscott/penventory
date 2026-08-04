# Auth dropped entirely — Tailscale is the only access gate

**Status:** Accepted

**Context:**
Session-cookie auth (`users`/`sessions`, single seeded user) was named as a Stack-level decision
in `project-plan.md` early in planning, with its own stated rationale: "Tailscale is the real
security boundary; this is defense-in-depth behind it, not the primary control." It was later
scheduled into a phase by [[2026-07-08-users-sessions-import-runs-added]] — but that ADR's own
context line admits it was caught by asking "what's missing overall" and scheduled off the
original stack-level line item, never independently re-examined for whether a single-user product
actually needs it.

Revisited at the start of Phase 1.1 (2026-08-03), when actually building it raised the question
directly: auth means a password-hashing scheme, a sessions table, cookie middleware, a seeding
mechanism, and a login page — real build and maintenance cost — for a product with exactly one
user, ever, already gated by Tailscale (private network, no public exposure). The only thing
auth would catch that Tailscale doesn't is another device on the same tailnet reaching the app.
Ken confirmed directly: no one else will ever use this.

**Decision:**
Drop auth entirely. No `users`/`sessions` tables, no session-cookie middleware, no login route,
ever, unless the product's actual audience changes (a real second user, or exposure beyond
Tailscale). Tailscale is the sole access control.

**Consequences:**
- Phase 1.1 step 1 is rescoped to just the real `db` client module (`DATABASE_URL` → connection →
  `migrateDatabase`) — the auth half of the original step 1 no longer exists.
- `project-plan.md`'s Stack table, Data Model (`users`/`sessions` section), and Phase 1.1 summary,
  and `phase1.1-plan.md`'s step 1, all needed updating to remove auth rather than just leaving it
  named-but-unbuilt.
- `hooks.server.ts` may still get created later for other cross-cutting route concerns (logging,
  etc.), but not for a session gate.
- If a real second user or non-Tailscale exposure ever becomes real, this decision gets reopened
  from scratch — nothing here is designed to be "auth-ready," since half-built auth is worse than
  no auth.
