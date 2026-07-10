# `purchases.vendor_id` is nullable; `updated_at` added

**Status:** Accepted

**Context:**
Secondhand pens are usually bought from an individual (a one-time private sale), not a recurring
business worth a permanent `vendors` row — forcing every private-party purchase through the
controlled list was genuine friction for a case that doesn't recur.

**Decision:**
`purchases.vendor_id` is nullable; `notes` covers "who" when it's unset. `updated_at` added —
was simply missing (`created_at` only), inconsistent with every other table.

**Consequences:**
None beyond the fix itself — closes a real gap, not a design tradeoff.
