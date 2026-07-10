import { sql } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

// unixepoch(), not CURRENT_TIMESTAMP — CURRENT_TIMESTAMP produces SQLite's
// human-readable TEXT format ('2026-07-10 21:32:54'), but these columns are
// `integer(..., { mode: 'timestamp' })`, which expects a unix epoch integer.
// A default-populated timestamp (never explicitly set — updated_at, always;
// created_at on every row not created via an explicit created_at like
// import does) silently became an Invalid Date on every read. Found via a
// test that actually called .getTime() on one instead of just
// .not.toBeNull() — see docs/adr/2026-07-10-timestamp-default-was-invalid-date.md.
const timestamps = {
	created_at: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updated_at: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
};

// --- Controlled lists (unscoped) --------------------------------------------
// Same shape, same mechanism (resolveOrFlag + aliases) — see phase1-plan.md
// step 3. Not merged into one table: each is a distinct real-world vocabulary.

export const brands = sqliteTable('brands', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const pen_materials = sqliteTable('pen_materials', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const nib_materials = sqliteTable('nib_materials', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const finishes = sqliteTable('finishes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const filling_systems = sqliteTable('filling_systems', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const nib_shapes = sqliteTable('nib_shapes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const vendors = sqliteTable('vendors', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

// --- Controlled lists (brand-scoped) ----------------------------------------
// lines/models reuse the same name across different brands legitimately
// (e.g. two brands both having a "Classic" line) — uniqueness is scoped to
// (brand_id, name), not name alone.

// Both FKs below point at the exact same target column — shared, not two
// copies of the same closure. Named (rather than inlined) so a real unit
// test can invoke it directly instead of relying on coverage-ignore comments
// for a reference Drizzle otherwise only calls during migration generation.
export const brandId = () => brands.id;

export const lines = sqliteTable(
	'lines',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		brand_id: integer('brand_id').notNull().references(brandId),
		name: text('name').notNull(),
		...timestamps
	},
	(t) => [unique().on(t.brand_id, t.name)]
);

export const models = sqliteTable(
	'models',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		brand_id: integer('brand_id').notNull().references(brandId),
		name: text('name').notNull(),
		...timestamps
	},
	(t) => [unique().on(t.brand_id, t.name)]
);

// --- Aliases -----------------------------------------------------------------
// Polymorphic: one table instead of nine near-identical per-type alias
// tables. aliasable_id intentionally has no DB-level foreign key — it points
// at a different table depending on aliasable_type, which SQLite can't
// express as a single FK constraint. Resolution (alias -> canonical row) is
// an application-layer join in resolveOrFlag (step 3), not enforced here.

export const ALIASABLE_TYPES = [
	'brand',
	'line',
	'model',
	'pen_material',
	'nib_material',
	'finish',
	'filling_system',
	'nib_shape',
	'vendor'
] as const;
export type AliasableType = (typeof ALIASABLE_TYPES)[number];

export const aliases = sqliteTable(
	'aliases',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		alias: text('alias').notNull(),
		aliasable_type: text('aliasable_type', { enum: ALIASABLE_TYPES }).notNull(),
		aliasable_id: integer('aliasable_id').notNull(),
		...timestamps
	},
	(t) => [unique().on(t.alias, t.aliasable_type)]
);

// --- Core catalog: pens, inks, nibs, tags -------------------------------------
// Core fields only — no purchases/inkings/pen_nibs/observations (Phase 4) and
// no computed columns (used/swatched/color/color_family — Phase 2/3/4). Every
// FK closure below is named (not inlined) for the same reason as brandId
// above: a real unit test can invoke it directly, one closure per target
// table shared across every column that points at it, not one per column.

export const modelId = () => models.id;
export const penMaterialId = () => pen_materials.id;
export const finishId = () => finishes.id;
export const fillingSystemId = () => filling_systems.id;
export const nibMaterialId = () => nib_materials.id;
export const nibShapeId = () => nib_shapes.id;
export const vendorId = () => vendors.id;
export const lineId = () => lines.id;

export const SIZE_CATEGORIES = ['pocket', 'standard', 'slim', 'oversized'] as const;
export type SizeCategory = (typeof SIZE_CATEGORIES)[number];

export const CONDITIONS = ['new', 'vintage', 'second_hand'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const OWNERSHIP_STATES = ['active', 'retired', 'rehomed'] as const;
export type OwnershipState = (typeof OWNERSHIP_STATES)[number];

// Shared high/medium/low scale — nibs.feedback/wetness, inks.sheen/shading/
// wetness/flow are all independent properties that happen to use the same
// three-point scale, not one field duplicated under different names.
export const LEVELS = ['high', 'medium', 'low'] as const;
export type Level = (typeof LEVELS)[number];

// Seed values for the nib_purities/nib_base_sizes/nib_point_sizes lookup
// tables below — the known real-world set as of this migration, not a type
// constraint. Unlike SIZE_CATEGORIES etc. above, these describe collector/
// manufacturer vocabularies Ken doesn't fully control: a genuinely new karat
// or housing size can show up in real data. Kept as real DB rows instead of
// a TypeScript union specifically so adding one later is a data operation
// (insert a row), not a code change + deploy.
export const NIB_PURITY_SEED = ['9K', '14K', '18K', '21K', '22K'] as const;
export const NIB_BASE_SIZE_SEED = ['#5', '#6', '#8'] as const;
export const NIB_POINT_SIZE_SEED = [
	'EF',
	'F',
	'FM',
	'MF',
	'F/M',
	'M',
	'OM',
	'CM',
	'B',
	'BB',
	'BBB',
	'XXXF',
	'1.0',
	'1.1',
	'1.4',
	'1.5'
] as const;

export const INK_TYPES = ['bottle', 'sample', 'cartridge'] as const;
export type InkType = (typeof INK_TYPES)[number];

export const COLOR_OVERRIDE_SOURCES = ['fpc', 'swatch', 'colorimeter', 'community'] as const;
export type ColorOverrideSource = (typeof COLOR_OVERRIDE_SOURCES)[number];

export const TAGGABLE_TYPES = ['pen', 'ink', 'nib'] as const;
export type TaggableType = (typeof TAGGABLE_TYPES)[number];

export const pens = sqliteTable('pens', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	brand_id: integer('brand_id').notNull().references(brandId),
	model_id: integer('model_id').notNull().references(modelId),
	color: text('color').notNull(),
	material_id: integer('material_id').notNull().references(penMaterialId),
	// Nullable — real, confirmed case: some pens have no plated trim hardware
	// at all (plain/unadorned body, just a nib), not a data-entry gap. Same
	// reasoning as nibs.brand_id/finish_id below.
	trim_color_id: integer('trim_color_id').references(finishId),
	filling_system_id: integer('filling_system_id').notNull().references(fillingSystemId),
	// Nullable — FPC's export tracks neither at all; import (Phase 1 step 6) leaves
	// both unset rather than writing a guessed default, same pattern as
	// nibs.brand_id below. Filled in later by hand via Phase 3's edit UI.
	size_category: text('size_category', { enum: SIZE_CATEGORIES }),
	condition: text('condition', { enum: CONDITIONS }),
	accessories_note: text('accessories_note'),
	notes: text('notes'),
	ownership_state: text('ownership_state', { enum: OWNERSHIP_STATES }).notNull(),
	ownership_changed_on: integer('ownership_changed_on', { mode: 'timestamp' }),
	...timestamps
});

// Exact-match-only lookup tables for purity/base_size/point_size — same
// unscoped shape as step 2's controlled lists (unique name, timestamps), but
// deliberately NOT in ALIASABLE_TYPES and never fuzzy-matched: point_size's
// real data has "FM"/"MF"/"F/M" coexisting as three genuinely distinct
// values (Pilot/Sailor/Diplomat conventions), not typos of each other — a
// fuzzy matcher would actively mis-flag them. Resolution is exact match or
// flagged for an explicit "add this value" decision, never auto-created and
// never fuzzy-suggested. Seeded with NIB_*_SEED's known values by this
// migration; new values afterward are just more rows.
export const nib_purities = sqliteTable('nib_purities', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const nib_base_sizes = sqliteTable('nib_base_sizes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const nib_point_sizes = sqliteTable('nib_point_sizes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	...timestamps
});

export const nibPurityId = () => nib_purities.id;
export const nibBaseSizeId = () => nib_base_sizes.id;
export const nibPointSizeId = () => nib_point_sizes.id;

// Standalone objects, owned independently of any pen — see pen_nibs below,
// the join table that actually tracks which pen a nib is currently in, if
// any. brand_id/purity_id/finish_id/nibmeister_id are nullable — real,
// confirmed gaps: a bare point size in FPC's data ("F"/"M"/"B" alone) means
// Steel + #6 housing + Round shape are assigned, but the manufacturer
// genuinely isn't recorded (JoWo vs. Bock vs. other isn't knowable), and
// Steel nibs have no karat purity at all. material_id/base_size_id/shape_id/
// point_size_id stay required — the same bare-point-size case still assigns
// all four.
export const nibs = sqliteTable('nibs', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	brand_id: integer('brand_id').references(brandId),
	material_id: integer('material_id').notNull().references(nibMaterialId),
	purity_id: integer('purity_id').references(nibPurityId),
	base_size_id: integer('base_size_id').notNull().references(nibBaseSizeId),
	point_size_id: integer('point_size_id').notNull().references(nibPointSizeId),
	shape_id: integer('shape_id').notNull().references(nibShapeId),
	finish_id: integer('finish_id').references(finishId),
	custom_name: text('custom_name'),
	is_custom_grind: integer('is_custom_grind', { mode: 'boolean' }).notNull().default(false),
	grind_description: text('grind_description'),
	nibmeister_id: integer('nibmeister_id').references(vendorId),
	ground_on: integer('ground_on', { mode: 'timestamp' }),
	feedback: text('feedback', { enum: LEVELS }),
	wetness: text('wetness', { enum: LEVELS }),
	notes: text('notes'),
	...timestamps
});

export const penId = () => pens.id;
export const nibId = () => nibs.id;

// Pulled forward from Phase 4 (see ARCHITECTURE.md's 2026-07-09 entry): the
// FPC import needs this now to link an imported pen to the nibs row parsed
// from its stock nib, not three phases later. removed_on null = currently
// installed — a pen with no open pen_nibs row has no nib in it (a real,
// confirmed case: Ken has bought pen bodies without one). Swapping a nib
// closes the old row (removed_on set) and opens a new one; the replaced nib
// keeps its full history rather than being overwritten. Phase 4 step 1 adds
// the assign/remove UI and "current nib" query on top of this table, not the
// table itself.
export const pen_nibs = sqliteTable('pen_nibs', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	pen_id: integer('pen_id').notNull().references(penId),
	nib_id: integer('nib_id').notNull().references(nibId),
	installed_on: integer('installed_on', { mode: 'timestamp' }).notNull(),
	removed_on: integer('removed_on', { mode: 'timestamp' }),
	notes: text('notes')
});

// color/color_family are deliberately absent — both computed at read time
// (Phase 2), not stored, so they don't drift out of sync with nothing behind
// them. color_fpc is the only color field guaranteed to exist for every ink,
// hence NOT NULL; the other three are populated later by Phase 3/4 pipelines.
export const inks = sqliteTable('inks', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	brand_id: integer('brand_id').notNull().references(brandId),
	// Nullable — real, confirmed case (FPC's export leaves Line blank for most
	// inks): not every ink has a sub-line. Same reasoning as maker_id below.
	line_id: integer('line_id').references(lineId),
	maker_id: integer('maker_id').references(brandId),
	name: text('name').notNull(),
	type: text('type', { enum: INK_TYPES }).notNull(),
	color_fpc: text('color_fpc').notNull(),
	color_swatch: text('color_swatch'),
	color_colorimeter: text('color_colorimeter'),
	color_community: text('color_community'),
	color_override_source: text('color_override_source', { enum: COLOR_OVERRIDE_SOURCES }),
	sheen: text('sheen', { enum: LEVELS }),
	shimmer: integer('shimmer', { mode: 'boolean' }).notNull().default(false),
	shading: text('shading', { enum: LEVELS }),
	permanence: integer('permanence', { mode: 'boolean' }).notNull().default(false),
	wetness: text('wetness', { enum: LEVELS }),
	flow: text('flow', { enum: LEVELS }),
	notes: text('notes'),
	ownership_state: text('ownership_state', { enum: OWNERSHIP_STATES }).notNull(),
	ownership_changed_on: integer('ownership_changed_on', { mode: 'timestamp' }),
	...timestamps
});

// Polymorphic, user-curated only — never auto-generated. No created_at/
// updated_at on either table: project-plan.md's field list for both is
// exactly what's below, nothing more.
export const tags = sqliteTable('tags', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique()
});

export const tagId = () => tags.id;

export const taggables = sqliteTable(
	'taggables',
	{
		tag_id: integer('tag_id').notNull().references(tagId),
		taggable_type: text('taggable_type', { enum: TAGGABLE_TYPES }).notNull(),
		taggable_id: integer('taggable_id').notNull()
	},
	(t) => [primaryKey({ columns: [t.tag_id, t.taggable_type, t.taggable_id] })]
);

// --- Import audit log --------------------------------------------------------
// Append-only: a row is written once, at the end of a dry-run or commit, and
// never updated — run_at is the one timestamp that means anything here, so
// this deliberately skips the created_at/updated_at pair every mutable
// catalog table above gets.

export const IMPORT_OPERATION_TYPES = ['catalog_import', 'color_refresh'] as const;
export type ImportOperationType = (typeof IMPORT_OPERATION_TYPES)[number];

export const IMPORT_MODES = ['dry_run', 'commit'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export const import_runs = sqliteTable('import_runs', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	operation_type: text('operation_type', { enum: IMPORT_OPERATION_TYPES }).notNull(),
	mode: text('mode', { enum: IMPORT_MODES }).notNull(),
	report_summary: text('report_summary', { mode: 'json' }).$type<Record<string, unknown>>(),
	run_at: integer('run_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

// --- Import working state: import_attempts + import_flagged_items ----------
// Never a report file — see docs/adr/2026-07-09-no-cli-at-all-for-import.md.
// Parsing (phase1-plan.md step 6) writes one import_attempts row and one
// import_flagged_items row per item needing a human decision; Phase 1.1's UI
// is the only thing that ever sets `decision`; commit refuses if any flagged
// item under the attempt still has decision = null.

export const IMPORT_ATTEMPT_STATUSES = ['open', 'committed'] as const;
export type ImportAttemptStatus = (typeof IMPORT_ATTEMPT_STATUSES)[number];

export const import_attempts = sqliteTable('import_attempts', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	operation_type: text('operation_type', { enum: IMPORT_OPERATION_TYPES }).notNull(),
	status: text('status', { enum: IMPORT_ATTEMPT_STATUSES }).notNull().default('open'),
	created_at: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	committed_at: integer('committed_at', { mode: 'timestamp' })
});

export const importAttemptId = () => import_attempts.id;

// One generic `needs_confirmation` value rather than a needs_confirmation_*
// value per resolveOrFlag type (brand/line/model/pen_material/nib_material/
// finish/filling_system/nib_shape/vendor — nine today, more as new aliasable
// types get added). The specific field lives in candidate_info instead
// (`{ field: 'nib_material', ... }`), so the enum doesn't have to grow with
// it. unmatched_color_refresh is added by step 8's own migration, not here.
// unparseable_row: a required field (not just the Nib column) was blank —
// see docs/adr/2026-07-10-unparseable-rows-are-correctable.md.
export const IMPORT_FLAG_TYPES = [
	'needs_confirmation',
	'possible_duplicate',
	'unparseable_nib',
	'unparseable_row'
] as const;
export type ImportFlagType = (typeof IMPORT_FLAG_TYPES)[number];

export const IMPORT_DECISIONS = ['import', 'skip', 'merge_into', 'alias_to'] as const;
export type ImportDecision = (typeof IMPORT_DECISIONS)[number];

// Holds one row per parsed CSV row, not only flagged ones — the only way
// commit can know what to write for a clean row too, given the "no file,
// ever" rule (the source CSV text isn't persisted anywhere once parse
// returns; parse and commit are separate calls, potentially separate HTTP
// requests in Phase 1.1). flag_type is null for a clean row that needed no
// human decision — parse sets decision = 'import' on those immediately, so
// "commit refuses if any decision is null" still means exactly what the ADR
// says: a row only blocks commit while something about it is genuinely
// undecided. row_data always carries { entityType: 'pen' | 'ink', sourceLine,
// ... } — entityType/sourceLine live in the JSON rather than their own
// columns, since nothing else needs to query on them.
export const import_flagged_items = sqliteTable('import_flagged_items', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	import_attempt_id: integer('import_attempt_id').notNull().references(importAttemptId),
	row_data: text('row_data', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
	flag_type: text('flag_type', { enum: IMPORT_FLAG_TYPES }),
	// Match candidate(s) — id/name/similarity for possible_duplicate, the
	// specific field name plus resolveOrFlag's candidates for
	// needs_confirmation. Null for unparseable_nib/unparseable_row and for
	// clean rows.
	candidate_info: text('candidate_info', { mode: 'json' }).$type<Record<string, unknown>>(),
	// Row-level decision — the only thing possible_duplicate/unparseable_nib/
	// unparseable_row actually need (one judgment call per row: import/skip,
	// or 'import' meaning "re-resolve, I corrected row_data.raw"). For
	// needs_confirmation with more than one ambiguous field, this is NOT
	// enough by itself — see field_decisions below and
	// docs/adr/2026-07-10-per-field-decisions-not-per-row.md.
	decision: text('decision', { enum: IMPORT_DECISIONS }),
	decision_target_id: integer('decision_target_id'),
	// One entry per ambiguous field named in candidate_info.fields/
	// nibValueFlags — { [field]: { decision, decisionTargetId } }. Commit
	// refuses a needs_confirmation row until every flagged field has an
	// entry here, not just the first one found during parse.
	field_decisions: text('field_decisions', { mode: 'json' }).$type<
		Record<string, { decision: ImportDecision; decisionTargetId: number | null }>
	>(),
	decided_at: integer('decided_at', { mode: 'timestamp' })
});
