# Dev workflow: one issue, one branch, close before merge

**Status:** Accepted

**Context:**
Needed a workflow decision for a single-user hobby project — easy to default to something looser
than a team project would use.

**Decision:**
Same process as get-clear: one GitHub issue per unit of work, one branch per issue, close the
issue before merging, delete the branch (local and remote) once merged and CI is green on main.

**Consequences:**
- Single-user doesn't mean less rigor.
- Full command sequence documented in `CLAUDE.md`.
