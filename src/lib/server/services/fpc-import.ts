import type Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { backupDatabase } from '../backup';
import { create } from '../db/repository';
import { resolveOrFlag, type ResolveResult } from '../db/resolve-or-flag';
import {
	brands,
	filling_systems,
	finishes,
	import_attempts,
	import_flagged_items,
	import_runs,
	inks,
	lines,
	models,
	nib_base_sizes,
	nib_materials,
	nib_point_sizes,
	nib_purities,
	nib_shapes,
	nibs,
	pen_materials,
	pen_nibs,
	pens,
	vendors,
	type AliasableType,
	type ImportFlagType
} from '../db/schema';
import type * as schema from '../db/schema';
import {
	applyDecision,
	CommitRefusedError,
	createControlledListRow,
	findOrCreateExactMatchWithDecision,
	type FieldDecisions,
	type FlagCandidateInfo,
	type TableWithId
} from './decision-resolution';
import {
	findDuplicateMatches,
	type DuplicateMatch,
	type IdentityCandidate
} from './duplicate-detection';
import { parseNibText, type ParsedNibText } from './nib-parser';

export { CommitRefusedError };

type Db = BetterSQLite3Database<typeof schema>;
type RawCsvRow = Record<string, string>;
type FlaggedItemRow = typeof import_flagged_items.$inferSelect;

const CSV_OPTIONS = { delimiter: ';', columns: true, skip_empty_lines: true } as const;

// A pen row missing any of these can't become a valid catalog entry at all —
// see docs/adr/2026-07-10-unparseable-rows-are-correctable.md for the full
// reasoning behind this exact set. Nib is deliberately excluded (blank is a
// real, valid case — a pen body with no nib). Date Added is also excluded —
// missing it falls back to the DB's own default (import time) rather than
// blocking the row; losing the acquisition date is real but recoverable,
// unlike losing what the pen even is. Trim Color is ALSO excluded — confirmed
// real case (Ken, 2026-07-10): some pens have no plated trim hardware at all
// (plain/unadorned body, just a nib), not a data-entry gap. trim_color_id is
// nullable in the schema for the same reason.
const PEN_REQUIRED_FIELDS = ['Brand', 'Model', 'Color', 'Material', 'Filling System'];

function blankRequiredFields(raw: RawCsvRow, required: string[]): string[] {
	return required.filter((key) => !raw[key] || raw[key].trim() === '');
}

// --- Row snapshots persisted in import_flagged_items.row_data --------------
// Everything commit needs to write the row, whether or not it needed a
// decision — see the schema comment on import_flagged_items for why this
// holds every row, not only flagged ones (there's nowhere else the parsed
// data could live between parse and commit, given the no-file rule).

type PenRowData = {
	entityType: 'pen';
	raw: RawCsvRow;
	sourceLine: number;
	color: string;
	notes: string | null;
	ownershipState: 'active' | 'retired';
	ownershipChangedOn: string | null;
	createdAt: string;
	brand: ResolveResult;
	model: ResolveResult | null; // null when brand isn't a settled id yet — resolved at commit
	material: ResolveResult;
	trimColor: ResolveResult | null; // null when Trim Color is blank — real case, no trim hardware
	fillingSystem: ResolveResult;
	nib: ParsedNibText;
	nibMaterial: ResolveResult | null;
	nibShape: ResolveResult | null;
	nibFinish: ResolveResult | null;
	nibBrand: ResolveResult | null;
	nibManufacturer: ResolveResult | null;
	nibmeister: ResolveResult | null;
};

type InkRowData = {
	entityType: 'ink';
	raw: RawCsvRow;
	sourceLine: number;
	name: string;
	type: string;
	colorFpc: string;
	notes: string | null;
	ownershipState: 'active' | 'rehomed';
	ownershipChangedOn: string | null;
	createdAt: string;
	brand: ResolveResult;
	line: ResolveResult | null;
	maker: ResolveResult | null;
};

// A required field was blank at parse time — nothing was resolved, nothing
// was even attempted, so there's no brand/model/etc. to snapshot. Corrected
// (row_data.raw edited) and re-resolved at commit via decision: 'import' —
// see resolveRowForCommit.
type UnparseableRowData = {
	entityType: 'unparseable_row';
	originalEntityType: 'pen' | 'ink';
	raw: RawCsvRow;
	sourceLine: number;
	missingFields: string[];
};

type RowData = PenRowData | InkRowData | UnparseableRowData;

// --- Identity keys for duplicate detection -----------------------------------
// Exact match on *resolved* controlled-list identity, never fuzzy string
// comparison across a whole multi-field blob — confirmed necessary against
// Ken's real collection data (2026-07-10): the old approach fuzzy-compared a
// single joined string of raw text, and a long *shared* prefix (Brand,
// Model, Material, Trim Color are identical across every colorway of the
// same pen line — completely normal in a real collection, not a data
// problem) drowned out the one field that's actually supposed to differ,
// flagging ~265 of 540 real rows as "possible duplicates" when they were
// almost entirely genuinely distinct items. See
// docs/adr/2026-07-10-identity-key-is-resolved-not-raw-text.md.

// One piece of an identity group key: the real database id once a field has
// resolved, or a stable `new:<name>` marker for a field that's about to be
// created. Safe as an identity marker even before creation — 'resolved'
// already covers every exact/alias/fuzzy match against the existing catalog,
// so 'new' is guaranteed not to collide with anything already there; the
// marker only needs to be stable enough for two rows in the *same batch*
// introducing the same brand-new value to group together (parse never
// writes to the DB — see parseCatalogImport — so two rows both introducing
// "Emberglass" both resolve 'new' independently, not 'resolved' on the
// second one). Returns null when the field is still 'flagged' — no identity
// can be known yet, so duplicate detection for this row defers to commit
// time, exactly the way model/line resolution already defers when brand
// itself is ambiguous.
function identityPiece(result: ResolveResult, rawName: string): string | null {
	if (result.outcome === 'resolved') return `id:${result.id}`;
	if (result.outcome === 'new') return `new:${rawName.trim().toLowerCase()}`;
	return null;
}

// Computable only when brand/model/material/trim all have a known identity
// (resolved or new) — never when any of them is still ambiguous ('flagged'),
// since there's genuinely no way to know yet what real-world entity that
// field refers to.
//
// Model resolution itself requires a real brandId (models are brand-scoped),
// so resolution.model stays null whenever brand isn't 'resolved' yet — see
// resolvePenFields — including when brand.outcome === 'new'. That's fine for
// identity purposes even then: two rows in the *same batch* both introducing
// the same brand-new brand AND naming the same raw Model text will resolve
// to the exact same real ids once committed (parse never writes — nothing
// exists yet for either row to have matched 'resolved' against — see the
// "two rows same new brand" behavior already proven elsewhere), so the raw,
// normalized Model text is itself a safe identity marker here, without
// needing an actual resolveOrFlag call against a brandId that doesn't exist
// yet. Only when brand is genuinely 'flagged' does model identity stay
// truly unknowable, deferring the whole row to commit.
function penIdentityGroupKey(raw: RawCsvRow, resolution: PenFieldResolution): string | null {
	const brand = identityPiece(resolution.brand, raw.Brand);
	if (brand === null) return null;
	// resolution.model is null exactly when brand isn't 'resolved' (see
	// resolvePenFields — model resolution needs a real brandId to query the
	// brand-scoped models table). Since `brand` above is already non-null,
	// resolveOrFlag's 'flagged' outcome has already been filtered out by the
	// guard above — resolveOrFlag has exactly three outcomes, so the only one
	// left is 'new'. There's no third case to handle here: a brand-new
	// brand's model was never even looked up, so the raw, normalized Model
	// text is the safe identity marker (see the module comment above).
	const model = resolution.model
		? identityPiece(resolution.model, raw.Model)
		: `new:${raw.Model.trim().toLowerCase()}`;
	if (model === null) return null; // Model itself is ambiguous — resolveOrFlag flagged it
	const material = identityPiece(resolution.material, raw.Material);
	if (material === null) return null;
	const trim = resolution.trimColor
		? identityPiece(resolution.trimColor, raw['Trim Color'])
		: 'none';
	if (trim === null) return null;
	return [brand, model, material, trim].join('|');
}

// Type is a small fixed enum (INK_TYPES) validated directly, never resolved
// through resolveOrFlag — safe to include in the group key as plain
// normalized text, no identityPiece needed. Line mirrors penIdentityGroupKey's
// Model handling, including the same "only 'new' is possible here" reasoning
// — `line` stays null whenever brand isn't 'resolved' yet (line resolution
// needs a real brandId), and brandPiece being non-null above already rules
// out 'flagged'.
function inkIdentityGroupKey(
	raw: RawCsvRow,
	brand: ResolveResult,
	line: ResolveResult | null
): string | null {
	const brandPiece = identityPiece(brand, raw.Brand);
	if (brandPiece === null) return null;
	const linePiece = !raw.Line
		? 'none'
		: line
			? identityPiece(line, raw.Line)
			: `new:${raw.Line.trim().toLowerCase()}`;
	if (linePiece === null) return null; // Line itself is ambiguous — resolveOrFlag flagged it
	return [brandPiece, linePiece, raw.Type].join('|');
}

// Existing-catalog identities are built directly from the real FK columns —
// no joins, no name reconstruction, no risk of the two sides' field sets
// silently drifting apart (a real bug earlier in this same review: the old
// name-based reconstruction dropped fields on one side but not the other).
// A row's own already-resolved ids are always exactly comparable to another
// row's, because both come from the same columns.
function loadExistingPenIdentities(db: Db): IdentityCandidate[] {
	const rows = db
		.select({
			id: pens.id,
			brand_id: pens.brand_id,
			model_id: pens.model_id,
			material_id: pens.material_id,
			trim_color_id: pens.trim_color_id,
			color: pens.color
		})
		.from(pens)
		.all();

	return rows.map((row) => ({
		id: row.id,
		groupKey: [
			`id:${row.brand_id}`,
			`id:${row.model_id}`,
			`id:${row.material_id}`,
			row.trim_color_id !== null ? `id:${row.trim_color_id}` : 'none'
		].join('|'),
		freeText: row.color
	}));
}

function loadExistingInkIdentities(db: Db): IdentityCandidate[] {
	const rows = db
		.select({
			id: inks.id,
			brand_id: inks.brand_id,
			line_id: inks.line_id,
			type: inks.type,
			name: inks.name
		})
		.from(inks)
		.all();

	return rows.map((row) => ({
		id: row.id,
		groupKey: [
			`id:${row.brand_id}`,
			row.line_id !== null ? `id:${row.line_id}` : 'none',
			row.type
		].join('|'),
		freeText: row.name
	}));
}

// --- Field resolution --------------------------------------------------------
// Extracted so the exact same resolution logic runs whether a row is being
// resolved fresh at parse, or re-resolved at commit after a correction (see
// resolveRowForCommit) — one implementation, not two copies that could drift.

type PenFieldResolution = {
	brand: ResolveResult;
	model: ResolveResult | null;
	material: ResolveResult;
	trimColor: ResolveResult | null;
	fillingSystem: ResolveResult;
	nib: ParsedNibText;
	nibMaterial: ResolveResult | null;
	nibShape: ResolveResult | null;
	nibFinish: ResolveResult | null;
	nibBrand: ResolveResult | null;
	nibManufacturer: ResolveResult | null;
	nibmeister: ResolveResult | null;
};

function resolvePenFields(db: Db, raw: RawCsvRow): PenFieldResolution {
	const brand = resolveOrFlag(db, 'brand', raw.Brand);
	const material = resolveOrFlag(db, 'pen_material', raw.Material);
	const trimColor = raw['Trim Color'] ? resolveOrFlag(db, 'finish', raw['Trim Color']) : null;
	const fillingSystem = resolveOrFlag(db, 'filling_system', raw['Filling System']);
	const model =
		brand.outcome === 'resolved' ? resolveOrFlag(db, 'model', raw.Model, brand.id) : null;

	const nib = parseNibText(db, raw.Nib);
	let nibMaterial: ResolveResult | null = null;
	let nibShape: ResolveResult | null = null;
	let nibFinish: ResolveResult | null = null;
	let nibBrand: ResolveResult | null = null;
	let nibManufacturer: ResolveResult | null = null;
	let nibmeister: ResolveResult | null = null;
	if (nib.kind === 'parsed') {
		nibMaterial = resolveOrFlag(db, 'nib_material', nib.materialName);
		nibShape = resolveOrFlag(db, 'nib_shape', nib.shapeName);
		if (nib.finishName) nibFinish = resolveOrFlag(db, 'finish', nib.finishName);
		if (nib.brandName) nibBrand = resolveOrFlag(db, 'brand', nib.brandName);
		if (nib.manufacturerName) nibManufacturer = resolveOrFlag(db, 'brand', nib.manufacturerName);
		if (nib.nibmeisterName) nibmeister = resolveOrFlag(db, 'vendor', nib.nibmeisterName);
	}

	return {
		brand,
		model,
		material,
		trimColor,
		fillingSystem,
		nib,
		nibMaterial,
		nibShape,
		nibFinish,
		nibBrand,
		nibManufacturer,
		nibmeister
	};
}

function penFlaggableResolutions(
	resolution: PenFieldResolution
): { field: string; result: ResolveResult }[] {
	return [
		{ field: 'brand', result: resolution.brand },
		...(resolution.model ? [{ field: 'model', result: resolution.model }] : []),
		{ field: 'pen_material', result: resolution.material },
		...(resolution.trimColor ? [{ field: 'trim_color', result: resolution.trimColor }] : []),
		{ field: 'filling_system', result: resolution.fillingSystem },
		...(resolution.nibMaterial ? [{ field: 'nib_material', result: resolution.nibMaterial }] : []),
		...(resolution.nibShape ? [{ field: 'nib_shape', result: resolution.nibShape }] : []),
		...(resolution.nibFinish ? [{ field: 'nib_finish', result: resolution.nibFinish }] : []),
		...(resolution.nibBrand ? [{ field: 'nib_brand', result: resolution.nibBrand }] : []),
		...(resolution.nibManufacturer
			? [{ field: 'nib_manufacturer', result: resolution.nibManufacturer }]
			: []),
		...(resolution.nibmeister ? [{ field: 'nibmeister', result: resolution.nibmeister }] : [])
	];
}

function buildPenRowData(
	raw: RawCsvRow,
	sourceLine: number,
	resolution: PenFieldResolution
): PenRowData {
	return {
		entityType: 'pen',
		raw,
		sourceLine,
		color: raw.Color,
		notes: raw.Comment || null,
		ownershipState: raw.Archived === 'true' ? 'retired' : 'active',
		ownershipChangedOn: raw.Archived === 'true' ? raw['Archived On'] || null : null,
		createdAt: raw['Date Added'],
		...resolution
	};
}

// --- Flag determination ------------------------------------------------------

function fieldsNeedingConfirmation(
	resolutions: { field: string; result: ResolveResult }[]
): Record<string, ResolveResult> {
	const flagged: Record<string, ResolveResult> = {};
	for (const { field, result } of resolutions) {
		if (result.outcome === 'flagged') flagged[field] = result;
	}
	return flagged;
}

type Flag = { flagType: ImportFlagType; candidateInfo: Record<string, unknown> | null };

// Duplicate match, unparseable nib, and controlled-list field ambiguity are
// three *independent* signals — a row can trip more than one at once (a
// near-dupe of an existing pen on Model/Color/Material/Trim while its Brand
// is also a typo; a duplicate whose Nib text is separately malformed — Nib
// isn't part of the composite key, so this is a real, reachable case). Every
// signal that fires gets recorded in candidateInfo; flagType picks one
// "headline" reason (duplicate > unparseable nib > needs_confirmation, in
// order of how consequential getting it wrong is) for the review UI, but
// nothing is ever silently dropped just because it wasn't the headline one.
// See docs/adr/2026-07-10-flag-signals-are-not-mutually-exclusive.md — this
// replaces an earlier if/else-if chain that returned as soon as the first
// signal matched, discarding the rest.
function determineFlag(
	dupMatches: DuplicateMatch[],
	nib: ParsedNibText | null,
	flaggedFields: Record<string, ResolveResult>
): Flag | null {
	const nibValueFlags = nib?.kind === 'parsed' ? nib.flags : [];
	const hasDuplicate = dupMatches.length > 0;
	const hasUnparseableNib = nib?.kind === 'unparseable';
	const hasFieldAmbiguity = Object.keys(flaggedFields).length > 0 || nibValueFlags.length > 0;

	if (!hasDuplicate && !hasUnparseableNib && !hasFieldAmbiguity) return null;

	const info: FlagCandidateInfo = { fields: flaggedFields, nibValueFlags };
	if (hasDuplicate) info.matches = dupMatches;
	if (hasUnparseableNib) info.unparseableNibReason = nib.reason;

	const flagType: ImportFlagType = hasDuplicate
		? 'possible_duplicate'
		: hasUnparseableNib
			? 'unparseable_nib'
			: 'needs_confirmation';

	return { flagType, candidateInfo: info };
}

function writeFlaggedItem(db: Db, attemptId: number, rowData: RowData, flag: Flag | null) {
	db.insert(import_flagged_items)
		.values({
			import_attempt_id: attemptId,
			row_data: rowData,
			flag_type: flag?.flagType ?? null,
			candidate_info: flag?.candidateInfo ?? null,
			decision: flag ? null : 'import',
			decided_at: flag ? null : new Date()
		})
		.run();
}

// --- Parse -------------------------------------------------------------------

export function parseCatalogImport(
	db: Db,
	{ pensCSV, inksCSV }: { pensCSV: string; inksCSV: string }
): { attemptId: number } {
	const attempt = db
		.insert(import_attempts)
		.values({ operation_type: 'catalog_import' })
		.returning()
		.get();

	const pensRaw = parse(pensCSV, CSV_OPTIONS) as RawCsvRow[];
	const inksRaw = parse(inksCSV, CSV_OPTIONS) as RawCsvRow[];

	const existingPenIdentities = loadExistingPenIdentities(db);
	const existingInkIdentities = loadExistingInkIdentities(db);
	const batchPenIdentities: IdentityCandidate[] = [];
	const batchInkIdentities: IdentityCandidate[] = [];

	let flaggedCount = 0;

	for (const [index, raw] of pensRaw.entries()) {
		const sourceLine = index + 2; // +1 for 0-index, +1 for the header row

		const missingFields = blankRequiredFields(raw, PEN_REQUIRED_FIELDS);
		if (missingFields.length > 0) {
			const rowData: UnparseableRowData = {
				entityType: 'unparseable_row',
				originalEntityType: 'pen',
				raw,
				sourceLine,
				missingFields
			};
			writeFlaggedItem(db, attempt.id, rowData, {
				flagType: 'unparseable_row',
				candidateInfo: { missingFields }
			});
			flaggedCount++;
			continue;
		}

		// Resolve first, THEN compare identity — Ken's framing, 2026-07-10:
		// duplicate detection on raw text can't tell a real near-dupe from
		// several genuinely distinct rows that happen to share most fields by
		// design (every colorway of the same pen line). Only computable when
		// brand/model/material/trim all have a known identity already (see
		// penIdentityGroupKey) — otherwise this row's duplicate check defers
		// to commit time, same as model resolution itself already defers
		// when brand is ambiguous.
		const resolution = resolvePenFields(db, raw);
		const groupKey = penIdentityGroupKey(raw, resolution);
		let dupMatches: DuplicateMatch[] = [];
		if (groupKey !== null) {
			dupMatches = findDuplicateMatches(
				groupKey,
				raw.Color,
				existingPenIdentities,
				batchPenIdentities
			);
			batchPenIdentities.push({ id: sourceLine, groupKey, freeText: raw.Color });
		}

		const rowData = buildPenRowData(raw, sourceLine, resolution);
		const flaggedFields = fieldsNeedingConfirmation(penFlaggableResolutions(resolution));
		const flag = determineFlag(dupMatches, resolution.nib, flaggedFields);
		writeFlaggedItem(db, attempt.id, rowData, flag);
		if (flag) flaggedCount++;
	}

	for (const [index, raw] of inksRaw.entries()) {
		const sourceLine = index + 2;

		const brand = resolveOrFlag(db, 'brand', raw.Brand);
		const line = raw.Line
			? brand.outcome === 'resolved'
				? resolveOrFlag(db, 'line', raw.Line, brand.id)
				: null
			: null;
		const maker = raw.Maker ? resolveOrFlag(db, 'brand', raw.Maker) : null;

		const groupKey = inkIdentityGroupKey(raw, brand, line);
		let dupMatches: DuplicateMatch[] = [];
		if (groupKey !== null) {
			dupMatches = findDuplicateMatches(
				groupKey,
				raw.Name,
				existingInkIdentities,
				batchInkIdentities
			);
			batchInkIdentities.push({ id: sourceLine, groupKey, freeText: raw.Name });
		}

		const notesParts = [raw.Comment, raw['Private Comment']].filter((v) => v && v.trim() !== '');

		const rowData: InkRowData = {
			entityType: 'ink',
			raw,
			sourceLine,
			name: raw.Name,
			type: raw.Type,
			colorFpc: raw.Color,
			notes: notesParts.length > 0 ? notesParts.join('\n\n') : null,
			ownershipState: raw.Archived === 'true' ? 'rehomed' : 'active',
			ownershipChangedOn: raw.Archived === 'true' ? raw['Archived On'] || null : null,
			createdAt: raw['Date Added'],
			brand,
			line,
			maker
		};

		const flaggedFields = fieldsNeedingConfirmation([
			{ field: 'brand', result: brand },
			...(line ? [{ field: 'line', result: line }] : []),
			...(maker ? [{ field: 'maker', result: maker }] : [])
		]);
		const flag = determineFlag(dupMatches, null, flaggedFields);
		writeFlaggedItem(db, attempt.id, rowData, flag);
		if (flag) flaggedCount++;
	}

	db.insert(import_runs)
		.values({
			operation_type: 'catalog_import',
			mode: 'dry_run',
			report_summary: {
				totalRows: pensRaw.length + inksRaw.length,
				pensRows: pensRaw.length,
				inksRows: inksRaw.length,
				flaggedCount
			}
		})
		.run();

	return { attemptId: attempt.id };
}

// --- Commit --------------------------------------------------------------
// settleField/applyDecision/CommitRefusedError live in decision-resolution.ts
// — extracted so their full decision-permutation matrix (merge_into/
// alias_to/import, per-field vs not, contains vs fuzzy-only) can be tested
// directly and exhaustively, independent of the full CSV pipeline.

export type CommitResult = {
	committed: true;
	pensCreated: number;
	inksCreated: number;
	nibsCreated: number;
};

// Two independent requirements, checked together rather than switched on a
// single flag_type — a row can need both at once now that determineFlag no
// longer collapses simultaneous signals into just one (see its comment):
//   1. A row-level decision (import/skip) whenever flag_type is anything
//      other than needs_confirmation — possible_duplicate, unparseable_nib,
//      and unparseable_row are each a single judgment call by nature (see
//      docs/adr/2026-07-10-per-field-decisions-not-per-row.md). A pure
//      needs_confirmation row needs no row-level decision at all — the
//      per-field decisions below are the whole answer.
//   2. Every ambiguous field named in candidate_info (fields + nibValueFlags)
//      has its own entry in field_decisions — not just the first one found
//      during parse, and not just when flag_type happens to be
//      needs_confirmation: a possible_duplicate or unparseable_nib row can
//      carry field ambiguity too (see docs/adr/2026-07-10-flag-signals-are-
//      not-mutually-exclusive.md).
function isItemFullyDecided(item: FlaggedItemRow): boolean {
	if (item.decision === 'skip') return true;

	const requiresRowDecision = item.flag_type !== null && item.flag_type !== 'needs_confirmation';
	if (requiresRowDecision && item.decision === null) return false;

	const info = item.candidate_info as FlagCandidateInfo | null;
	const requiredFields = [
		...Object.keys(info?.fields ?? {}),
		...(info?.nibValueFlags ?? []).map((f) => f.field)
	];
	const decisions = (item.field_decisions as FieldDecisions | null) ?? {};
	return requiredFields.every((field) => decisions[field] !== undefined);
}

type PendingFlag = {
	// The flagged_item row this pending flag supersedes — commit updates this
	// row in place (new row_data/flag_type/candidate_info, decision reset to
	// null) rather than inserting a fresh one. Necessary, not cosmetic: the
	// original row's decision/field_decisions must carry forward (a
	// merge_into already recorded for `brand` on this same row must still
	// apply once `model` is what's newly ambiguous), and — the actual bug
	// this closes — inserting a separate row left the original row's
	// decision:'import' sitting there unchanged, so every retry re-ran its
	// resolution from scratch and re-flagged the exact same ambiguity again,
	// forever, even after the newly-inserted row was correctly decided. See
	// docs/adr/2026-07-10-re-flags-update-the-original-row.md.
	originalItemId: number;
	rowData: RowData;
	flagType: ImportFlagType;
	candidateInfo: Record<string, unknown> | null;
};

// Resolves a controlled-list field whose scope (brandId) wasn't known until
// commit — model/line when Brand itself was flagged or new at parse (see
// resolvePenFields/the ink loop in parseCatalogImport). Mirrors applyDecision
// exactly (field_decisions first, contains-signal guard, create-on-import)
// when a decision is already recorded for this field; otherwise resolves
// fresh and, if still ambiguous, supersedes the *same* flagged_items row with
// a new needs_confirmation flag instead of throwing — the ambiguity couldn't
// have been decided in advance because it wasn't discoverable until brandId
// was known. Returns null to tell the caller to skip writing this row this
// pass (it'll be retried on the next commit attempt, once decided).
function resolveDeferredField<T extends TableWithId>(
	tx: Db,
	item: FlaggedItemRow,
	field: string,
	type: AliasableType,
	rawName: string,
	scopeId: number,
	table: T,
	newFlags: PendingFlag[],
	rowData: RowData,
	reason: string
): number | null {
	const fieldDecisions = item.field_decisions as FieldDecisions | null;
	if (fieldDecisions?.[field]) {
		return applyDecision(tx, item, field, type, rawName, scopeId, table);
	}
	const result = resolveOrFlag(tx, type, rawName, scopeId);
	if (result.outcome === 'resolved') return result.id;
	if (result.outcome === 'new') return createControlledListRow(tx, rawName, scopeId, table);
	newFlags.push({
		originalItemId: item.id,
		rowData,
		flagType: 'needs_confirmation',
		candidateInfo: { fields: { [field]: result }, nibValueFlags: [], reason }
	});
	return null;
}

// Re-resolves a row whose flag required a correction rather than a plain
// decision: unparseable_row (required fields were blank — re-check row_data
// .raw, which the review UI would have let the user edit, then resolve it
// exactly like a fresh row) and unparseable_nib (re-parse row_data.raw.Nib
// alone). Returns null and records a pending re-flag if the correction still
// leaves something ambiguous — "correct it and try again" can itself surface
// a new, different problem, same as importing fresh data always could.
// decision: 'import' is the only way to reach this — 'skip' already
// short-circuits before rowData is even read, and anything else
// (merge_into/alias_to) makes no sense for a whole-row/whole-nib correction.
function resolveRowForCommit(
	tx: Db,
	item: FlaggedItemRow,
	rowData: RowData,
	newFlags: PendingFlag[]
): RowData | null {
	if (rowData.entityType === 'unparseable_row') {
		if (item.decision !== 'import') {
			throw new CommitRefusedError(
				`row ${item.id} (line ${rowData.sourceLine}): unparseable_row can only be 'import' (corrected, re-resolve) or 'skip'`
			);
		}
		if (rowData.originalEntityType !== 'pen') {
			throw new CommitRefusedError(
				`row ${item.id} (line ${rowData.sourceLine}): ink unparseable_row correction isn't implemented yet`
			);
		}
		const missing = blankRequiredFields(rowData.raw, PEN_REQUIRED_FIELDS);
		if (missing.length > 0) {
			throw new CommitRefusedError(
				`row ${item.id} (line ${rowData.sourceLine}): still missing required fields: ${missing.join(', ')}`
			);
		}
		const resolution = resolvePenFields(tx, rowData.raw);
		const newRowData = buildPenRowData(rowData.raw, rowData.sourceLine, resolution);
		// Duplicate detection itself is NOT run here — it's deferred to the
		// universal, authoritative check runCommitTransaction runs right
		// before actually creating the pen, once every controlled field has
		// its final resolved id (this row's identity can't be reliably known
		// yet at this point the same way a fresh parse-time row often can't —
		// see penIdentityGroupKey). That single check point covers every pen
		// unconditionally, corrected-unparseable_row included, so there's no
		// need for a second, earlier, necessarily-partial one here. See
		// docs/adr/2026-07-10-identity-key-is-resolved-not-raw-text.md.
		const flaggedFields = fieldsNeedingConfirmation(penFlaggableResolutions(resolution));
		const flag = determineFlag([], resolution.nib, flaggedFields);
		if (flag) {
			newFlags.push({
				originalItemId: item.id,
				rowData: newRowData,
				flagType: flag.flagType,
				candidateInfo: flag.candidateInfo
			});
			return null;
		}
		return newRowData;
	}

	// Keyed off the row's actual nib data, not item.flag_type — a row whose
	// Nib is unparseable can have flag_type === 'possible_duplicate' instead
	// (duplicate is the headline signal; see determineFlag), since Nib isn't
	// part of the composite key a duplicate match is found on. Gating this
	// re-resolution on flag_type === 'unparseable_nib' alone missed that case
	// entirely: deciding 'import' on such a row skipped nib re-resolution,
	// and rowData.nib.kind stayed 'unparseable' straight through to
	// runCommitTransaction's `if (rowData.nib.kind === 'parsed')` check,
	// which silently skips nib creation — no error, no re-flag, the pen just
	// committed with no nib at all. See
	// docs/adr/2026-07-10-flag-signals-are-not-mutually-exclusive.md.
	if (rowData.entityType === 'pen' && rowData.nib.kind === 'unparseable') {
		if (item.decision !== 'import') {
			throw new CommitRefusedError(
				`row ${item.id} (line ${rowData.sourceLine}): a row with an unparseable Nib can only be 'import' (corrected, re-resolve) or 'skip'`
			);
		}
		const nib = parseNibText(tx, rowData.raw.Nib);
		if (nib.kind === 'unparseable') {
			throw new CommitRefusedError(
				`row ${item.id} (line ${rowData.sourceLine}): Nib still unparseable: ${nib.reason}`
			);
		}
		let nibMaterial: ResolveResult | null = null;
		let nibShape: ResolveResult | null = null;
		let nibFinish: ResolveResult | null = null;
		let nibBrand: ResolveResult | null = null;
		let nibManufacturer: ResolveResult | null = null;
		let nibmeister: ResolveResult | null = null;
		if (nib.kind === 'parsed') {
			nibMaterial = resolveOrFlag(tx, 'nib_material', nib.materialName);
			nibShape = resolveOrFlag(tx, 'nib_shape', nib.shapeName);
			if (nib.finishName) nibFinish = resolveOrFlag(tx, 'finish', nib.finishName);
			if (nib.brandName) nibBrand = resolveOrFlag(tx, 'brand', nib.brandName);
			if (nib.manufacturerName) nibManufacturer = resolveOrFlag(tx, 'brand', nib.manufacturerName);
			if (nib.nibmeisterName) nibmeister = resolveOrFlag(tx, 'vendor', nib.nibmeisterName);
		}
		const updatedRowData: PenRowData = {
			...rowData,
			nib,
			nibMaterial,
			nibShape,
			nibFinish,
			nibBrand,
			nibManufacturer,
			nibmeister
		};
		const flaggedFields = fieldsNeedingConfirmation([
			...(nibMaterial ? [{ field: 'nib_material', result: nibMaterial }] : []),
			...(nibShape ? [{ field: 'nib_shape', result: nibShape }] : []),
			...(nibFinish ? [{ field: 'nib_finish', result: nibFinish }] : []),
			...(nibBrand ? [{ field: 'nib_brand', result: nibBrand }] : []),
			...(nibManufacturer ? [{ field: 'nib_manufacturer', result: nibManufacturer }] : []),
			...(nibmeister ? [{ field: 'nibmeister', result: nibmeister }] : [])
		]);
		const flag = determineFlag([], nib, flaggedFields);
		if (flag) {
			newFlags.push({
				originalItemId: item.id,
				rowData: updatedRowData,
				flagType: flag.flagType,
				candidateInfo: flag.candidateInfo
			});
			return null;
		}
		return updatedRowData;
	}

	return rowData;
}

export async function commitImportAttempt(
	db: Db,
	sqlite: Database.Database,
	attemptId: number,
	backupDir: string
): Promise<CommitResult> {
	const items = db
		.select()
		.from(import_flagged_items)
		.where(eq(import_flagged_items.import_attempt_id, attemptId))
		.all();

	if (items.length === 0) {
		throw new CommitRefusedError(`import attempt ${attemptId} has no rows`);
	}
	if (items.some((item) => !isItemFullyDecided(item))) {
		throw new CommitRefusedError(
			`import attempt ${attemptId} still has undecided flagged items — commit refused`
		);
	}

	await backupDatabase(sqlite, backupDir);

	let pensCreated = 0;
	let inksCreated = 0;
	let nibsCreated = 0;
	const newFlags: PendingFlag[] = [];

	try {
		runCommitTransaction(db, items, attemptId, newFlags, {
			onPenCreated: () => pensCreated++,
			onInkCreated: () => inksCreated++,
			onNibCreated: () => nibsCreated++
		});
	} catch (err) {
		if (newFlags.length > 0) {
			// The transaction above rolled back everything, including any
			// attempt to record these — write them now, outside the rolled-
			// back transaction, so Ken actually sees what needs a second
			// decision instead of the refusal just vanishing.
			//
			// Updates the *original* row (by originalItemId) rather than
			// inserting a new one — field_decisions is preserved (a merge_into
			// already recorded for e.g. `brand` on this row must still apply
			// once `model` is what's newly ambiguous), while decision/
			// decision_target_id/decided_at reset to null so the row requires
			// a fresh, explicit decision for whatever it now represents. This
			// is what makes retrying commit actually converge: before, the
			// original row's decision stayed 'import' untouched, so every
			// retry re-ran its resolution from scratch and re-flagged the
			// exact same ambiguity again — inserting yet another row every
			// time — even after the previously-inserted row was correctly
			// decided, permanently blocking the whole attempt. See
			// docs/adr/2026-07-10-re-flags-update-the-original-row.md.
			for (const { originalItemId, rowData, flagType, candidateInfo } of newFlags) {
				db.update(import_flagged_items)
					.set({
						row_data: rowData,
						flag_type: flagType,
						candidate_info: candidateInfo,
						decision: null,
						decision_target_id: null,
						decided_at: null
					})
					.where(eq(import_flagged_items.id, originalItemId))
					.run();
			}
		}
		throw err;
	}

	db.insert(import_runs)
		.values({
			operation_type: 'catalog_import',
			mode: 'commit',
			report_summary: { pensCreated, inksCreated, nibsCreated }
		})
		.run();

	return { committed: true, pensCreated, inksCreated, nibsCreated };
}

function runCommitTransaction(
	db: Db,
	items: FlaggedItemRow[],
	attemptId: number,
	newFlags: PendingFlag[],
	counters: { onPenCreated: () => void; onInkCreated: () => void; onNibCreated: () => void }
) {
	db.transaction((tx) => {
		for (const item of items) {
			if (item.decision === 'skip') continue;

			const rowData = resolveRowForCommit(tx, item, item.row_data as unknown as RowData, newFlags);
			if (rowData === null) continue; // still ambiguous after correction — re-flagged, not written

			if (rowData.entityType === 'unparseable_row') {
				// Provably unreachable, not just untested: resolveRowForCommit's
				// unparseable_row branch only ever throws, returns null, or
				// returns a brand-new PenRowData from buildPenRowData — it can
				// never return the original UnparseableRowData object. Left in
				// as defense-in-depth against a future change to that function
				// breaking the guarantee silently; TypeScript can't prove the
				// unreachability itself (no path-sensitive narrowing across the
				// function call), a human reading both functions together can.
				throw new CommitRefusedError(`row ${item.id}: unresolved unparseable_row reached commit`);
			}

			if (rowData.entityType === 'pen') {
				const brandId = applyDecision(
					tx,
					item,
					'brand',
					'brand',
					rowData.raw.Brand,
					undefined,
					brands
				);

				let modelId: number;
				if (rowData.model) {
					modelId = applyDecision(tx, item, 'model', 'model', rowData.raw.Model, brandId, models);
				} else {
					const resolved = resolveDeferredField(
						tx,
						item,
						'model',
						'model',
						rowData.raw.Model,
						brandId,
						models,
						newFlags,
						rowData,
						'model flagged once brand context was known'
					);
					if (resolved === null) continue;
					modelId = resolved;
				}

				const materialId = applyDecision(
					tx,
					item,
					'pen_material',
					'pen_material',
					rowData.raw.Material,
					undefined,
					pen_materials
				);
				const trimColorId = rowData.raw['Trim Color']
					? applyDecision(
							tx,
							item,
							'trim_color',
							'finish',
							rowData.raw['Trim Color'],
							undefined,
							finishes
						)
					: null;
				const fillingSystemId = applyDecision(
					tx,
					item,
					'filling_system',
					'filling_system',
					rowData.raw['Filling System'],
					undefined,
					filling_systems
				);

				// The universal, authoritative duplicate check — runs for
				// every pen right before writing it, using each controlled
				// field's now-final resolved id (never a speculative one —
				// by this point brandId/modelId/materialId/trimColorId are
				// exactly what's about to be written). Catches everything
				// the parse-time check couldn't (any field that was
				// ambiguous or brand-new at parse) and anything a
				// mid-import correction changed, without needing a second,
				// necessarily-partial check anywhere else in this function —
				// see docs/adr/2026-07-10-identity-key-is-resolved-not-raw-text.md.
				// loadExistingPenIdentities(tx) reflects this transaction's
				// own writes so far too (read-your-own-writes), so a match
				// against a pen created earlier in this same commit is caught
				// exactly like one already sitting in the catalog.
				//
				// Skipped when item.flag_type is already 'possible_duplicate'
				// — that means this exact concern was already surfaced (at
				// parse, or by an earlier re-flag round) and the row's
				// current decision already answers it (import-anyway or the
				// row wouldn't have reached here at all — 'skip' short-
				// circuits earlier in the loop). Re-running the check here
				// too would rediscover the identical match and push another
				// re-flag on top of a decision that already accounted for
				// it — confirmed while fixing this: correcting an
				// unparseable Nib on an already-possible_duplicate row (a
				// combination this session's flag-signal-masking fix made
				// reachable) re-triggered this check and overrode the
				// reviewer's already-made "import anyway" call.
				if (item.flag_type !== 'possible_duplicate') {
					const commitGroupKey = [
						`id:${brandId}`,
						`id:${modelId}`,
						`id:${materialId}`,
						trimColorId !== null ? `id:${trimColorId}` : 'none'
					].join('|');
					const commitDupMatches = findDuplicateMatches(
						commitGroupKey,
						rowData.color,
						loadExistingPenIdentities(tx)
					);
					if (commitDupMatches.length > 0) {
						newFlags.push({
							originalItemId: item.id,
							rowData,
							flagType: 'possible_duplicate',
							candidateInfo: { fields: {}, nibValueFlags: [], matches: commitDupMatches }
						});
						continue;
					}
				}

				const pen = create(tx, pens, {
					brand_id: brandId,
					model_id: modelId,
					color: rowData.color,
					material_id: materialId,
					trim_color_id: trimColorId,
					filling_system_id: fillingSystemId,
					notes: rowData.notes,
					ownership_state: rowData.ownershipState,
					ownership_changed_on: rowData.ownershipChangedOn
						? new Date(rowData.ownershipChangedOn)
						: null,
					created_at: new Date(rowData.createdAt)
				});
				counters.onPenCreated();

				if (rowData.nib.kind === 'parsed') {
					const nibMaterialId = applyDecision(
						tx,
						item,
						'nib_material',
						'nib_material',
						rowData.nib.materialName,
						undefined,
						nib_materials
					);
					const nibShapeId = applyDecision(
						tx,
						item,
						'nib_shape',
						'nib_shape',
						rowData.nib.shapeName,
						undefined,
						nib_shapes
					);
					const nibFinishId = rowData.nib.finishName
						? applyDecision(
								tx,
								item,
								'nib_finish',
								'finish',
								rowData.nib.finishName,
								undefined,
								finishes
							)
						: null;
					const baseSizeId = findOrCreateExactMatchWithDecision(
						tx,
						item,
						'nib_base_size',
						nib_base_sizes,
						rowData.nib.baseSizeName
					);
					const purityId = rowData.nib.purityName
						? findOrCreateExactMatchWithDecision(
								tx,
								item,
								'nib_purity',
								nib_purities,
								rowData.nib.purityName
							)
						: null;
					// pointSize is never missing here — parseNibText only
					// reaches 'parsed' after an exact seed-list match.
					const pointSize = tx
						.select()
						.from(nib_point_sizes)
						.where(eq(nib_point_sizes.name, rowData.nib.pointSize))
						.get();

					// brand_id/manufacturer_id are null unless the point size
					// itself is one of a vertically-integrated maker's own
					// proprietary designs (Signature/CM = Pilot, Zoom/Music =
					// Sailor) — FPC's Nib column never records this any other
					// way, so reusing the pen's own brandId for a generic
					// grade would still be a guess, not a fact. See
					// docs/adr/2026-07-13-nib-manufacturer-and-brand-are-independent-fields.md.
					const nibBrandId = rowData.nib.brandName
						? applyDecision(
								tx,
								item,
								'nib_brand',
								'brand',
								rowData.nib.brandName,
								undefined,
								brands
							)
						: null;
					const nibManufacturerId = rowData.nib.manufacturerName
						? applyDecision(
								tx,
								item,
								'nib_manufacturer',
								'brand',
								rowData.nib.manufacturerName,
								undefined,
								brands
							)
						: null;
					// nibmeister_id is set the same way — genuinely known only
					// when the shape itself is a publicly-known nibmeister
					// grind (Journaler/Scribe/Imperial). Existing nib CRUD
					// (Phase 3/4) is still the only path for any other nib's
					// nibmeister to ever get recorded.
					const nibmeisterId = rowData.nib.nibmeisterName
						? applyDecision(
								tx,
								item,
								'nibmeister',
								'vendor',
								rowData.nib.nibmeisterName,
								undefined,
								vendors
							)
						: null;
					const nib = create(tx, nibs, {
						brand_id: nibBrandId,
						manufacturer_id: nibManufacturerId,
						material_id: nibMaterialId,
						purity_id: purityId,
						base_size_id: baseSizeId,
						point_size_id: pointSize!.id,
						shape_id: nibShapeId,
						finish_id: nibFinishId,
						nibmeister_id: nibmeisterId,
						custom_name: rowData.nib.customName,
						is_custom_grind: rowData.nib.isCustomGrind,
						is_flex: rowData.nib.isFlex
					});
					counters.onNibCreated();

					create(tx, pen_nibs, {
						pen_id: pen.id,
						nib_id: nib.id,
						installed_on: new Date(rowData.createdAt)
					});
				}
			} else {
				const brandId = applyDecision(
					tx,
					item,
					'brand',
					'brand',
					rowData.raw.Brand,
					undefined,
					brands
				);

				let lineId: number | null = null;
				if (rowData.raw.Line) {
					if (rowData.line) {
						lineId = applyDecision(tx, item, 'line', 'line', rowData.raw.Line, brandId, lines);
					} else {
						const resolved = resolveDeferredField(
							tx,
							item,
							'line',
							'line',
							rowData.raw.Line,
							brandId,
							lines,
							newFlags,
							rowData,
							'line flagged once brand context was known'
						);
						if (resolved === null) continue;
						lineId = resolved;
					}
				}

				const makerId = rowData.raw.Maker
					? applyDecision(tx, item, 'maker', 'brand', rowData.raw.Maker, undefined, brands)
					: null;

				// Same universal, authoritative check as the pen side — see
				// its comment above, including why it's skipped when
				// item.flag_type is already 'possible_duplicate'.
				if (item.flag_type !== 'possible_duplicate') {
					const commitGroupKey = [
						`id:${brandId}`,
						lineId !== null ? `id:${lineId}` : 'none',
						rowData.type
					].join('|');
					const commitDupMatches = findDuplicateMatches(
						commitGroupKey,
						rowData.name,
						loadExistingInkIdentities(tx)
					);
					if (commitDupMatches.length > 0) {
						newFlags.push({
							originalItemId: item.id,
							rowData,
							flagType: 'possible_duplicate',
							candidateInfo: { fields: {}, nibValueFlags: [], matches: commitDupMatches }
						});
						continue;
					}
				}

				create(tx, inks, {
					brand_id: brandId,
					line_id: lineId,
					maker_id: makerId,
					name: rowData.name,
					type: rowData.type as (typeof schema.INK_TYPES)[number],
					color_fpc: rowData.colorFpc,
					notes: rowData.notes,
					ownership_state: rowData.ownershipState,
					ownership_changed_on: rowData.ownershipChangedOn
						? new Date(rowData.ownershipChangedOn)
						: null,
					created_at: new Date(rowData.createdAt)
				});
				counters.onInkCreated();
			}
		}

		if (newFlags.length > 0) {
			// Rolls back every catalog write made so far this transaction —
			// the new flagged items themselves are recorded by the caller,
			// after this throw, using the outer (non-transactional) db handle,
			// since anything written here rolls back too.
			throw new CommitRefusedError(
				`${newFlags.length} row(s) needed a new decision after resolution — re-review and commit again`
			);
		}

		tx.update(import_attempts)
			.set({ status: 'committed', committed_at: new Date() })
			.where(eq(import_attempts.id, attemptId))
			.run();
	});
}
