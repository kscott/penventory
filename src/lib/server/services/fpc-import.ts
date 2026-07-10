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
	type ImportFlagType
} from '../db/schema';
import type * as schema from '../db/schema';
import {
	applyDecision,
	CommitRefusedError,
	findOrCreateExactMatchWithDecision,
	settleField,
	type FieldDecisions,
	type NeedsConfirmationCandidateInfo
} from './decision-resolution';
import {
	findDuplicateMatches,
	type DuplicateCandidate,
	type DuplicateMatch
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
// missing it falls back to the DB's own CURRENT_TIMESTAMP default rather
// than blocking the row; losing the acquisition date is real but recoverable,
// unlike losing what the pen even is.
const PEN_REQUIRED_FIELDS = ['Brand', 'Model', 'Color', 'Material', 'Trim Color', 'Filling System'];

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
	compositeKey: string;
	color: string;
	notes: string | null;
	ownershipState: 'active' | 'retired';
	ownershipChangedOn: string | null;
	createdAt: string;
	brand: ResolveResult;
	model: ResolveResult | null; // null when brand isn't a settled id yet — resolved at commit
	material: ResolveResult;
	trimColor: ResolveResult;
	fillingSystem: ResolveResult;
	nib: ParsedNibText;
	nibMaterial: ResolveResult | null;
	nibShape: ResolveResult | null;
	nibFinish: ResolveResult | null;
};

type InkRowData = {
	entityType: 'ink';
	raw: RawCsvRow;
	sourceLine: number;
	compositeKey: string;
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

// --- Composite keys for duplicate detection ---------------------------------
// Built from the *raw* CSV field values for batch rows — a real near-dupe
// typo shows up in the raw text. For already-committed catalog rows there's
// no raw text to recover (pens/inks store ids, not the original strings), so
// existing-side keys are reconstructed from the resolved names instead —
// close enough in shape for fuzzy comparison to still catch real near-dupes.

// Nib is deliberately excluded from both sides — an already-committed pen's
// nib is parsed into structured fields (nibs table), not retained as raw
// text, so there's nothing to reconstruct it from. Every other field here
// IS reconstructible via joins, and both sides must use the exact same
// field set/order or the two composite keys can never look similar to each
// other even for a genuinely identical pen (a real bug caught in review —
// the original existing-side formula silently dropped Model and Trim Color
// too, and inks silently dropped Line, making existing-catalog duplicate
// detection non-functional despite being covered "in principle" by
// findDuplicateMatches — see the completeness review, 2026-07-10).

function penCompositeKey(raw: RawCsvRow): string {
	return [raw.Brand, raw.Model, raw.Color, raw.Material, raw['Trim Color']].join('|');
}

function inkCompositeKey(raw: RawCsvRow): string {
	return [raw.Brand, raw.Line, raw.Name, raw.Type].join('|');
}

function loadExistingPenKeys(db: Db): DuplicateCandidate[] {
	const rows = db
		.select({
			id: pens.id,
			brandName: brands.name,
			modelName: models.name,
			color: pens.color,
			materialName: pen_materials.name,
			trimColorName: finishes.name
		})
		.from(pens)
		.innerJoin(brands, eq(pens.brand_id, brands.id))
		.innerJoin(models, eq(pens.model_id, models.id))
		.innerJoin(pen_materials, eq(pens.material_id, pen_materials.id))
		.innerJoin(finishes, eq(pens.trim_color_id, finishes.id))
		.all();

	return rows.map((row) => ({
		id: row.id,
		compositeKey: [
			row.brandName,
			row.modelName,
			row.color,
			row.materialName,
			row.trimColorName
		].join('|')
	}));
}

function loadExistingInkKeys(db: Db): DuplicateCandidate[] {
	const rows = db
		.select({
			id: inks.id,
			brandName: brands.name,
			lineName: lines.name,
			name: inks.name,
			type: inks.type
		})
		.from(inks)
		.innerJoin(brands, eq(inks.brand_id, brands.id))
		.leftJoin(lines, eq(inks.line_id, lines.id))
		.all();

	return rows.map((row) => ({
		id: row.id,
		compositeKey: [row.brandName, row.lineName ?? '', row.name, row.type].join('|')
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
	trimColor: ResolveResult;
	fillingSystem: ResolveResult;
	nib: ParsedNibText;
	nibMaterial: ResolveResult | null;
	nibShape: ResolveResult | null;
	nibFinish: ResolveResult | null;
};

function resolvePenFields(db: Db, raw: RawCsvRow): PenFieldResolution {
	const brand = resolveOrFlag(db, 'brand', raw.Brand);
	const material = resolveOrFlag(db, 'pen_material', raw.Material);
	const trimColor = resolveOrFlag(db, 'finish', raw['Trim Color']);
	const fillingSystem = resolveOrFlag(db, 'filling_system', raw['Filling System']);
	const model =
		brand.outcome === 'resolved' ? resolveOrFlag(db, 'model', raw.Model, brand.id) : null;

	const nib = parseNibText(db, raw.Nib);
	let nibMaterial: ResolveResult | null = null;
	let nibShape: ResolveResult | null = null;
	let nibFinish: ResolveResult | null = null;
	if (nib.kind === 'parsed') {
		nibMaterial = resolveOrFlag(db, 'nib_material', nib.materialName);
		nibShape = resolveOrFlag(db, 'nib_shape', nib.shapeName);
		if (nib.finishName) nibFinish = resolveOrFlag(db, 'finish', nib.finishName);
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
		nibFinish
	};
}

function penFlaggableResolutions(
	resolution: PenFieldResolution
): { field: string; result: ResolveResult }[] {
	return [
		{ field: 'brand', result: resolution.brand },
		...(resolution.model ? [{ field: 'model', result: resolution.model }] : []),
		{ field: 'pen_material', result: resolution.material },
		{ field: 'trim_color', result: resolution.trimColor },
		{ field: 'filling_system', result: resolution.fillingSystem },
		...(resolution.nibMaterial ? [{ field: 'nib_material', result: resolution.nibMaterial }] : []),
		...(resolution.nibShape ? [{ field: 'nib_shape', result: resolution.nibShape }] : []),
		...(resolution.nibFinish ? [{ field: 'nib_finish', result: resolution.nibFinish }] : [])
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
		compositeKey: penCompositeKey(raw),
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

function determineFlag(
	dupMatches: DuplicateMatch[],
	nib: ParsedNibText | null,
	flaggedFields: Record<string, ResolveResult>
): Flag | null {
	if (dupMatches.length > 0) {
		return { flagType: 'possible_duplicate', candidateInfo: { matches: dupMatches } };
	}
	if (nib?.kind === 'unparseable') {
		return { flagType: 'unparseable_nib', candidateInfo: { reason: nib.reason } };
	}
	const nibValueFlags = nib?.kind === 'parsed' ? nib.flags : [];
	if (Object.keys(flaggedFields).length > 0 || nibValueFlags.length > 0) {
		// Every flagged field (there can be more than one — e.g. a typo on
		// Brand *and* on Material at once) is independently decidable via
		// field_decisions at commit — see docs/adr/2026-07-10-per-field-
		// decisions-not-per-row.md. No single "decidedField" here anymore.
		const info: NeedsConfirmationCandidateInfo = { fields: flaggedFields, nibValueFlags };
		return { flagType: 'needs_confirmation', candidateInfo: info };
	}
	return null;
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

	const existingPenKeys = loadExistingPenKeys(db);
	const existingInkKeys = loadExistingInkKeys(db);
	const batchPenKeys: DuplicateCandidate[] = [];
	const batchInkKeys: DuplicateCandidate[] = [];

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

		const compositeKey = penCompositeKey(raw);
		const dupMatches = findDuplicateMatches(compositeKey, existingPenKeys, batchPenKeys);
		batchPenKeys.push({ id: index, compositeKey });

		const resolution = resolvePenFields(db, raw);
		const rowData = buildPenRowData(raw, sourceLine, resolution);
		const flaggedFields = fieldsNeedingConfirmation(penFlaggableResolutions(resolution));
		const flag = determineFlag(dupMatches, resolution.nib, flaggedFields);
		writeFlaggedItem(db, attempt.id, rowData, flag);
		if (flag) flaggedCount++;
	}

	for (const [index, raw] of inksRaw.entries()) {
		const sourceLine = index + 2;
		const compositeKey = inkCompositeKey(raw);
		const dupMatches = findDuplicateMatches(compositeKey, existingInkKeys, batchInkKeys);
		batchInkKeys.push({ id: index, compositeKey });

		const brand = resolveOrFlag(db, 'brand', raw.Brand);
		const line = raw.Line
			? brand.outcome === 'resolved'
				? resolveOrFlag(db, 'line', raw.Line, brand.id)
				: null
			: null;
		const maker = raw.Maker ? resolveOrFlag(db, 'brand', raw.Maker) : null;

		const notesParts = [raw.Comment, raw['Private Comment']].filter((v) => v && v.trim() !== '');

		const rowData: InkRowData = {
			entityType: 'ink',
			raw,
			sourceLine,
			compositeKey,
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

// Every ambiguous field named in candidate_info (fields + nibValueFlags)
// must have its own entry in field_decisions before a needs_confirmation row
// is considered decided — not just the first one found during parse. See
// docs/adr/2026-07-10-per-field-decisions-not-per-row.md.
function isItemFullyDecided(item: FlaggedItemRow): boolean {
	if (item.decision === 'skip') return true;
	if (item.flag_type === 'needs_confirmation') {
		const info = item.candidate_info as NeedsConfirmationCandidateInfo | null;
		const requiredFields = [
			...Object.keys(info?.fields ?? {}),
			...(info?.nibValueFlags ?? []).map((f) => f.field)
		];
		const decisions = (item.field_decisions as FieldDecisions | null) ?? {};
		return requiredFields.every((field) => decisions[field] !== undefined);
	}
	return item.decision !== null;
}

type PendingFlag = {
	rowData: RowData;
	flagType: ImportFlagType;
	candidateInfo: Record<string, unknown> | null;
};

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
		const flaggedFields = fieldsNeedingConfirmation(penFlaggableResolutions(resolution));
		const flag = determineFlag([], resolution.nib, flaggedFields);
		if (flag) {
			newFlags.push({
				rowData: newRowData,
				flagType: flag.flagType,
				candidateInfo: flag.candidateInfo
			});
			return null;
		}
		return newRowData;
	}

	if (rowData.entityType === 'pen' && item.flag_type === 'unparseable_nib') {
		if (item.decision !== 'import') {
			throw new CommitRefusedError(
				`row ${item.id} (line ${rowData.sourceLine}): unparseable_nib can only be 'import' (corrected, re-resolve) or 'skip'`
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
		if (nib.kind === 'parsed') {
			nibMaterial = resolveOrFlag(tx, 'nib_material', nib.materialName);
			nibShape = resolveOrFlag(tx, 'nib_shape', nib.shapeName);
			if (nib.finishName) nibFinish = resolveOrFlag(tx, 'finish', nib.finishName);
		}
		const updatedRowData: PenRowData = { ...rowData, nib, nibMaterial, nibShape, nibFinish };
		const flaggedFields = fieldsNeedingConfirmation([
			...(nibMaterial ? [{ field: 'nib_material', result: nibMaterial }] : []),
			...(nibShape ? [{ field: 'nib_shape', result: nibShape }] : []),
			...(nibFinish ? [{ field: 'nib_finish', result: nibFinish }] : [])
		]);
		const flag = determineFlag([], nib, flaggedFields);
		if (flag) {
			newFlags.push({
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
			// attempt to record these — insert them now, outside the rolled-
			// back transaction, so Ken actually sees what needs a second
			// decision instead of the refusal just vanishing.
			for (const { rowData, flagType, candidateInfo } of newFlags) {
				db.insert(import_flagged_items)
					.values({
						import_attempt_id: attemptId,
						row_data: rowData,
						flag_type: flagType,
						candidate_info: candidateInfo,
						decision: null
					})
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
					const modelResult = resolveOrFlag(tx, 'model', rowData.raw.Model, brandId);
					if (modelResult.outcome === 'flagged') {
						newFlags.push({
							rowData,
							flagType: 'needs_confirmation',
							candidateInfo: {
								fields: { model: modelResult },
								nibValueFlags: [],
								reason: 'model flagged once brand context was known'
							}
						});
						continue;
					}
					modelId = settleField(tx, 'model', rowData.raw.Model, brandId, models);
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
				const trimColorId = applyDecision(
					tx,
					item,
					'trim_color',
					'finish',
					rowData.raw['Trim Color'],
					undefined,
					finishes
				);
				const fillingSystemId = applyDecision(
					tx,
					item,
					'filling_system',
					'filling_system',
					rowData.raw['Filling System'],
					undefined,
					filling_systems
				);

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

					// brand_id is deliberately null here, always — FPC's Nib
					// column never records the nib's manufacturer separately
					// from the pen's own brand (confirmed: no such column
					// exists in the real export), so reusing the pen's brandId
					// would be a guess, not a fact. Same "genuinely not
					// recorded" reasoning as the bare-point-size case, just
					// applied uniformly rather than only to that one case.
					const nib = create(tx, nibs, {
						brand_id: null,
						material_id: nibMaterialId,
						purity_id: purityId,
						base_size_id: baseSizeId,
						point_size_id: pointSize!.id,
						shape_id: nibShapeId,
						finish_id: nibFinishId,
						custom_name: rowData.nib.customName,
						is_custom_grind: rowData.nib.isCustomGrind
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
						const lineResult = resolveOrFlag(tx, 'line', rowData.raw.Line, brandId);
						if (lineResult.outcome === 'flagged') {
							newFlags.push({
								rowData,
								flagType: 'needs_confirmation',
								candidateInfo: {
									fields: { line: lineResult },
									nibValueFlags: [],
									reason: 'line flagged once brand context was known'
								}
							});
							continue;
						}
						lineId = settleField(tx, 'line', rowData.raw.Line, brandId, lines);
					}
				}

				const makerId = rowData.raw.Maker
					? applyDecision(tx, item, 'maker', 'brand', rowData.raw.Maker, undefined, brands)
					: null;

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
