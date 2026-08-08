// The set of file "kinds" the import upload screen can accept, and what's actually usable right
// now. `nibs` is deliberately not here — bulk nib entry has no confirmed mechanism (could be a
// CSV import or a bulk-entry form with no file at all), see docs/punch-list.md's loose-nib entry.
// `inkings` is here because it's a confirmed real file (`currently_inked.csv`, Phase 4) even
// though nothing parses it yet.
export const IMPORT_CONTENT_TYPES = [
	{ key: 'pens', label: 'Pens', status: 'active' },
	{ key: 'inks', label: 'Inks', status: 'active' },
	{ key: 'inkings', label: 'Inkings', status: 'coming_soon' }
] as const;

export type ImportContentType = (typeof IMPORT_CONTENT_TYPES)[number]['key'];

// A separate literal tuple, not `IMPORT_CONTENT_TYPES.map(t => t.key)` — Drizzle's `enum` column
// option needs an actual tuple type ([string, ...string[]]) to build the literal union from, and
// `.map()` over a const tuple widens to a plain array type, losing that. Kept in sync by hand and
// verified by a test, same pattern as schema.ts's own NIB_POINT_SIZE_SEED/migration-INSERTs pair.
export const IMPORT_CONTENT_TYPE_KEYS = ['pens', 'inks', 'inkings'] as const;

// One flat type above, no separate compile-time "active" subtype — this guard is the one place
// that decides what's usable right now, checked at the real boundary (a raw string from a form).
// A type riding alongside it wouldn't do anything the guard doesn't already cover.
export function isActiveImportContentType(value: string): value is ImportContentType {
	return IMPORT_CONTENT_TYPES.some((t) => t.key === value && t.status === 'active');
}
