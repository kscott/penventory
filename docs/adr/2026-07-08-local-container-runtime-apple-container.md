# Local container runtime: apple/container, not OrbStack/Docker Desktop

**Status:** Accepted

**Context:**
Phase 0 step 6 needed something to verify `docker build` locally (no runtime was installed at
all). Tried OrbStack first (brew cask) — works, but its onboarding defaults to a Pro-trial
banner, an unnecessary licensing question for what's just a dev-loop build check.

**Decision:**
Switched to Apple's own `container` CLI (`brew install container`, v1.1.0): Apache 2.0, fully
open source, no license tier at all, and the native fit for this Mac (Apple Silicon + macOS 26
Tahoe).

**Consequences:**
- OCI-compatible — builds/runs the same Dockerfile, pulls/pushes the same registries — so
  nothing about the Dockerfile or CI (which still runs `docker build` on GitHub-hosted Ubuntu
  runners, unchanged) depends on this choice.
- One networking difference worth knowing: each container gets its own routable IP on a private
  subnet rather than Docker's NAT+localhost port-publish — `container run -p` didn't map to
  `localhost` in testing; hitting the container's own IP (`container list` shows it) worked.
