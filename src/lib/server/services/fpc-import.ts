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
import { applyDecision, CommitRefusedError, settleField } from './decision-resolution';
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

// --- Row snapshots persisted in import_flagged_items.row_data --------------
// Everything commit needs to write the row, whether or not it needed a
// decision — see the schema comment on import_flagged_items for why this
// holds every row, not only flagged ones (there's nowhere else the parsed
// data could live between parse and commit, given the no-file rule).

type PenRowData = {
	entityType: 'pen';
	raw: RawCsvRow;
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

type RowData = PenRowData | InkRowData;

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

function determineFlag(
	dupMatches: DuplicateMatch[],
	nib: ParsedNibText | null,
	flaggedFields: Record<string, ResolveResult>
): { flagType: ImportFlagType; candidateInfo: Record<string, unknown> | null } | null {
	if (dupMatches.length > 0) {
		return { flagType: 'possible_duplicate', candidateInfo: { matches: dupMatches } };
	}
	if (nib?.kind === 'unparseable') {
		return { flagType: 'unparseable_nib', candidateInfo: null };
	}
	const nibValueFlags = nib?.kind === 'parsed' ? nib.flags : [];
	const flaggedKeys = Object.keys(flaggedFields);
	if (flaggedKeys.length > 0 || nibValueFlags.length > 0) {
		// decision/decision_target_id on a flagged item is single-valued, but a
		// row can (rarely) have more than one ambiguous field. The first
		// flagged field (fixed, deterministic order — see the caller) is the
		// one Ken's decision actually resolves; any other simultaneously-
		// flagged field on the same row still can't be silently created —
		// applyDecision refuses instead (see its comment) rather than picking
		// a near-duplicate quietly. Rare in practice; not exhaustively solved
		// in Phase 1, per the standing "starting list, not exhaustive" note.
		return {
			flagType: 'needs_confirmation',
			candidateInfo: {
				fields: flaggedFields,
				nibValueFlags,
				decidedField: flaggedKeys[0] ?? null
			}
		};
	}
	return null;
}

function writeFlaggedItem(
	db: Db,
	attemptId: number,
	rowData: RowData,
	flag: { flagType: ImportFlagType; candidateInfo: Record<string, unknown> | null } | null
) {
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
		const compositeKey = penCompositeKey(raw);
		const dupMatches = findDuplicateMatches(compositeKey, existingPenKeys, batchPenKeys);
		batchPenKeys.push({ id: index, compositeKey });

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

		const rowData: PenRowData = {
			entityType: 'pen',
			raw,
			compositeKey,
			color: raw.Color,
			notes: raw.Comment || null,
			ownershipState: raw.Archived === 'true' ? 'retired' : 'active',
			ownershipChangedOn: raw.Archived === 'true' ? raw['Archived On'] || null : null,
			createdAt: raw['Date Added'],
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

		const flaggedFields = fieldsNeedingConfirmation([
			{ field: 'brand', result: brand },
			...(model ? [{ field: 'model', result: model }] : []),
			{ field: 'pen_material', result: material },
			{ field: 'trim_color', result: trimColor },
			{ field: 'filling_system', result: fillingSystem },
			...(nibMaterial ? [{ field: 'nib_material', result: nibMaterial }] : []),
			...(nibShape ? [{ field: 'nib_shape', result: nibShape }] : []),
			...(nibFinish ? [{ field: 'nib_finish', result: nibFinish }] : [])
		]);
		const flag = determineFlag(dupMatches, nib, flaggedFields);
		writeFlaggedItem(db, attempt.id, rowData, flag);
		if (flag) flaggedCount++;
	}

	for (const [index, raw] of inksRaw.entries()) {
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
// alias_to/import, decided-field vs not, contains vs fuzzy-only) can be
// tested directly and exhaustively, independent of the full CSV pipeline.

export type CommitResult = {
	committed: true;
	pensCreated: number;
	inksCreated: number;
	nibsCreated: number;
};

function findOrCreateExactMatch(
	db: Db,
	table: typeof nib_base_sizes | typeof nib_purities,
	name: string
): number {
	const existing = db.select().from(table).where(eq(table.name, name)).get();
	if (existing) return existing.id;
	return db.insert(table).values({ name }).returning().get().id;
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
	if (items.some((item) => item.decision === null)) {
		throw new CommitRefusedError(
			`import attempt ${attemptId} still has undecided flagged items — commit refused`
		);
	}

	await backupDatabase(sqlite, backupDir);

	let pensCreated = 0;
	let inksCreated = 0;
	let nibsCreated = 0;
	const newFlags: RowData[] = [];

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
			for (const rowData of newFlags) {
				db.insert(import_flagged_items)
					.values({
						import_attempt_id: attemptId,
						row_data: rowData,
						flag_type: 'needs_confirmation',
						candidate_info: { reason: 'model/line flagged once brand context was known' },
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
	newFlags: RowData[],
	counters: { onPenCreated: () => void; onInkCreated: () => void; onNibCreated: () => void }
) {
	db.transaction((tx) => {
		for (const item of items) {
			if (item.decision === 'skip') continue;

			const rowData = item.row_data as unknown as RowData;

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
						newFlags.push(rowData);
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
					// base_size/purity are exact-match-only lookup tables (never
					// fuzzy-matched — see nib-parser.ts and the nib-value-
					// lookup-tables-not-enums ADR), so a value nib-parser
					// couldn't find gets created here, not merged/aliased —
					// there's no candidate list to pick from, the raw text IS
					// the correct value. This is why nib-parser flags them as
					// needs_confirmation on the row (Ken reviews the row before
					// it commits) rather than requiring a merge_into/alias_to-
					// style decision that doesn't apply to this kind of table.
					const baseSizeId = findOrCreateExactMatch(tx, nib_base_sizes, rowData.nib.baseSizeName);
					const purityId = rowData.nib.purityName
						? findOrCreateExactMatch(tx, nib_purities, rowData.nib.purityName)
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
							newFlags.push(rowData);
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
				`${newFlags.length} row(s) needed a new decision once brand context was resolved — re-review and commit again`
			);
		}

		tx.update(import_attempts)
			.set({ status: 'committed', committed_at: new Date() })
			.where(eq(import_attempts.id, attemptId))
			.run();
	});
}
