# Hard rule: the deployed app must be fully operable through its own interface

**Status:** Accepted

**Context:**
Surfaced by Ken asking how `npm run import:fpc` (the then-current CLI design — see
[[2026-07-08-fpc-import-ken-triggered-cli]]) would actually run against the real deployed
instance on Secondo. The honest answer at the time was "exec into the container or manually copy
files onto the host," both flatly rejected: "I should *never* need to get into a container to do
anything with the app. That is a hard fail, red flag, stop do not pass go." A first-pass fix
attempt ("run the CLI locally, treat getting real data onto Secondo as a rare manual sync") was
also rejected, for a sharper reason: it makes a development environment a required part of a
fully functioning app. A dev environment is for building and testing software, not for operating
the finished product — treating "run this on my Mac" as an acceptable stand-in for a missing
feature just relocates the same failure, it doesn't fix it.

**Decision:**
Zero operations may ever require shelling into the container or SSHing into the host to touch its
files. Standing, project-wide rule, not scoped to import.

**Consequences:**
- Migrations and the pre-migration backup already comply (both automatic on container startup,
  no operator action); `/healthz`/`/metrics` are passive.
- Anything added later that would need an operator to shell in or SSH to function is wrong by
  this rule, full stop — same posture as
  [[2026-07-08-no-live-external-state-in-tests]], applied to operation instead of testing.
- Directly caused [[2026-07-09-import-gets-own-phase-1-1]] and
  [[2026-07-09-no-cli-at-all-for-import]].
