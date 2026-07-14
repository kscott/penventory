import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../db/migrate';
import { aliases } from '../db/schema';
import { parseNibText } from './nib-parser';

describe('parseNibText', () => {
	let dir: string;
	let sqlite: Database.Database;
	let db: ReturnType<typeof migrateDatabase>;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'penventory-test-'));
		sqlite = new Database(join(dir, `${randomUUID()}.db`));
		sqlite.pragma('foreign_keys = ON');
		db = migrateDatabase(sqlite);
	});

	afterEach(() => {
		sqlite.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('a blank value means no nib for that pen', () => {
		expect(parseNibText(db, '')).toEqual({ kind: 'blank' });
		expect(parseNibText(db, '   ')).toEqual({ kind: 'blank' });
	});

	it('a bare point size alone defaults to Steel / #6 / Round, no purity, no custom name', () => {
		const result = parseNibText(db, 'M');
		expect(result).toEqual({
			kind: 'parsed',
			pointSize: 'M',
			baseSizeName: '#6',
			purityName: null,
			materialName: 'Steel',
			shapeName: 'Round',
			finishName: null,
			customName: null,
			isCustomGrind: false,
			flags: [],
			brandName: null,
			manufacturerName: null,
			nibmeisterName: null,
			isFlex: false
		});
	});

	it('a full compound entry extracts point size, base size, an explicit material, and a multi-word shape', () => {
		// Titanium/Cursive Smooth Italic are pre-seeded by migration now — see
		// the vocabulary-seeding ADR — no manual insert needed.
		const result = parseNibText(db, 'M #8 Titanium Cursive Smooth Italic');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'M',
			baseSizeName: '#8',
			purityName: null,
			materialName: 'Titanium',
			shapeName: 'Cursive Smooth Italic',
			finishName: null,
			customName: null,
			isCustomGrind: false
		});
	});

	it('purity implies Gold when no explicit material token is present', () => {
		const result = parseNibText(db, 'B 18K');
		expect(result).toMatchObject({
			pointSize: 'B',
			purityName: '18K',
			materialName: 'Gold'
		});
	});

	it('leftover text after known tokens are stripped becomes custom_name, and marks is_custom_grind', () => {
		const result = parseNibText(db, 'M Feathertip');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'M',
			customName: 'Feathertip',
			isCustomGrind: true
		});
	});

	it('the seeded "Journaler" alias resolves to canonical shape "Cursive Smooth Italic" out of the box, the same way brand aliases resolve — and is always a custom grind (Gena Saloreno)', () => {
		const result = parseNibText(db, 'M Journaler');
		expect(result).toMatchObject({
			kind: 'parsed',
			shapeName: 'Cursive Smooth Italic',
			customName: null,
			isCustomGrind: true,
			nibmeisterName: 'Gena Saloreno'
		});
	});

	it('a dangling alias (canonical row no longer exists) is skipped, not matched — aliases.aliasable_id has no DB-level FK', () => {
		// aliasable_id is intentionally unconstrained at the DB level for this
		// polymorphic table (see schema.ts) — a row referencing a deleted or
		// never-existing canonical id is a real, reachable case, not
		// hypothetical. It must be skipped, not crash or false-match.
		db.insert(aliases)
			.values({ alias: 'Ghostwriter', aliasable_type: 'nib_shape', aliasable_id: 999999 })
			.run();

		const result = parseNibText(db, 'M Ghostwriter');
		expect(result).toMatchObject({
			kind: 'parsed',
			shapeName: 'Round',
			customName: 'Ghostwriter',
			isCustomGrind: true
		});
	});

	it('finish (plating color) is extracted separately from material — confirmed real case', () => {
		// Rose Gold is pre-seeded by migration now — no manual insert needed.
		const result = parseNibText(db, 'F Rose Gold');
		expect(result).toMatchObject({
			pointSize: 'F',
			finishName: 'Rose Gold',
			materialName: 'Steel',
			customName: null
		});
	});

	it('a malformed token with no exact point size match is flagged, not guessed — the "sF" case', () => {
		// Confirmed via damerau-levenshtein directly: similarity("sf","f") is
		// 0.5, below the 0.7 threshold — "sF" is NOT actually a near-miss by
		// this function's own definition, it's just unrecognized. This still
		// correctly lands in 'unparseable' (no exact match either), but via
		// the generic "nothing found at all" reason, not the near-miss one —
		// see the "XXF" case right below for what actually exercises that
		// branch.
		const result = parseNibText(db, 'sF');
		expect(result).toMatchObject({
			kind: 'unparseable',
			reason: 'no point size found anywhere in the text'
		});
	});

	it('a token that IS a genuine near-miss of a real point size gets the specific typo-flagged reason — "XXF" vs "XXXF"', () => {
		// damerau-levenshtein("xxf","xxxf") = 0.75, clears the 0.7 threshold —
		// a real dropped-letter typo of Extra-Extra-Extra-Fine.
		const result = parseNibText(db, 'XXF');
		expect(result).toMatchObject({
			kind: 'unparseable',
			reason: 'no exact point size match, but "XXF" is close to a known one — likely a typo'
		});
	});

	it('a bare custom grind name with no point size anywhere is flagged, not defaulted', () => {
		const result = parseNibText(db, 'Windmill');
		expect(result.kind).toBe('unparseable');
	});

	it('bare "Journaler" with no point size given anywhere implies Medium, by definition — resolves instead of unparseable', () => {
		const result = parseNibText(db, 'Journaler');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'M',
			shapeName: 'Cursive Smooth Italic',
			customName: null,
			isCustomGrind: true,
			nibmeisterName: 'Gena Saloreno'
		});
	});

	it('bare "Scribe" with no point size given anywhere implies Broad, by definition (Joshua Lax)', () => {
		const result = parseNibText(db, 'Scribe');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'B',
			shapeName: 'Scribe',
			customName: null,
			isCustomGrind: true,
			nibmeisterName: 'Joshua Lax'
		});
	});

	it('"Imperial" has no implied point size of its own — bare "Imperial" still correctly stays unparseable', () => {
		const result = parseNibText(db, 'Imperial');
		expect(result.kind).toBe('unparseable');
	});

	it('"Imperial" with an explicit point size resolves with its shape and nibmeister (Kirk Speer), still a custom grind', () => {
		const result = parseNibText(db, 'M Imperial');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'M',
			shapeName: 'Imperial',
			customName: null,
			isCustomGrind: true,
			nibmeisterName: 'Kirk Speer',
			brandName: null,
			manufacturerName: null
		});
	});

	it('"Seagul" has no implied point size of its own either — bare stays unparseable', () => {
		const result = parseNibText(db, 'Seagul');
		expect(result.kind).toBe('unparseable');
	});

	it('"Seagul" with an explicit point size resolves via alias to "Seagull", with its nibmeister (Monty Winnfield)', () => {
		const result = parseNibText(db, 'M Seagul');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'M',
			shapeName: 'Seagull',
			customName: null,
			isCustomGrind: true,
			nibmeisterName: 'Monty Winnfield',
			brandName: null,
			manufacturerName: null
		});
	});

	it('text with no point size and no recognizable vocabulary at all is flagged', () => {
		const result = parseNibText(db, 'Long Knife');
		expect(result.kind).toBe('unparseable');
	});

	it('"Long Knife" with an explicit point size is an ordinary shape — no nibmeister named, not a custom grind', () => {
		const result = parseNibText(db, 'M Long Knife');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'M',
			shapeName: 'Long Knife',
			customName: null,
			isCustomGrind: false,
			nibmeisterName: null
		});
	});

	it('"Long Blade" resolves via alias to canonical shape "Long Knife" — confirmed interchangeable', () => {
		const result = parseNibText(db, 'M Long Blade');
		expect(result).toMatchObject({
			kind: 'parsed',
			shapeName: 'Long Knife',
			isCustomGrind: false,
			nibmeisterName: null
		});
	});

	it('"Flex" is Noodler\'s own factory point size, not a generic width — sets is_flex, no brand/manufacturer implied', () => {
		const result = parseNibText(db, 'Flex');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'Flex',
			shapeName: 'Round',
			customName: null,
			isCustomGrind: false,
			isFlex: true,
			brandName: null,
			manufacturerName: null,
			nibmeisterName: null
		});
	});

	it('a point size other than "Flex" never sets is_flex', () => {
		const result = parseNibText(db, 'M');
		expect(result).toMatchObject({ isFlex: false });
	});

	it('a leftover word naming a real nib brand ("Hongdian") sets brandName instead of falling through to custom_name', () => {
		const result = parseNibText(db, 'F Hongdian');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'F',
			shapeName: 'Round',
			customName: null,
			isCustomGrind: false,
			brandName: 'Hongdian',
			manufacturerName: null,
			nibmeisterName: null
		});
	});

	it('a leftover brand word is matched case-insensitively, same as every other leftover-word lookup', () => {
		const result = parseNibText(db, 'F hongdian');
		expect(result).toMatchObject({ brandName: 'Hongdian', customName: null, isCustomGrind: false });
	});

	it('a leftover token that near-matches a known shape/material/finish is flagged rather than treated as a custom name', () => {
		// Cursive Italic is pre-seeded by migration now — no manual insert needed.
		const result = parseNibText(db, 'F Cursive Itallic');
		expect(result.kind).toBe('unparseable');
	});

	it('an unrecognized base size (#N not yet in nib_base_sizes) flags nib_base_size rather than silently creating it', () => {
		const result = parseNibText(db, 'M #7');
		expect(result).toMatchObject({
			kind: 'parsed',
			baseSizeName: '#7',
			flags: [{ field: 'nib_base_size', rawValue: '#7' }]
		});
	});

	it('an unrecognized purity (NK not yet in nib_purities) flags nib_purity rather than silently creating it', () => {
		const result = parseNibText(db, 'M 24K');
		expect(result).toMatchObject({
			kind: 'parsed',
			purityName: '24K',
			materialName: 'Gold',
			flags: [{ field: 'nib_purity', rawValue: '24K' }]
		});
	});

	it('a known base size does not flag', () => {
		const result = parseNibText(db, 'M #6');
		expect(result).toMatchObject({ kind: 'parsed', baseSizeName: '#6', flags: [] });
	});

	it('"Signature" is Pilot\'s own proprietary round nib — a real point size, not a custom grind', () => {
		const result = parseNibText(db, 'Signature 14K');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'Signature',
			purityName: '14K',
			shapeName: 'Round',
			brandName: 'Pilot',
			manufacturerName: 'Pilot',
			customName: null,
			isCustomGrind: false
		});
	});

	it('"Zoom" is Sailor\'s own proprietary architect-style nib — implies Architect shape, not the Round default', () => {
		const result = parseNibText(db, 'Zoom 21K');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'Zoom',
			shapeName: 'Architect',
			brandName: 'Sailor',
			manufacturerName: 'Sailor'
		});
	});

	it('an explicit shape token still overrides "Zoom"\'s implied Architect default', () => {
		// Cursive Italic is pre-seeded by migration now — no manual insert needed.
		const result = parseNibText(db, 'Zoom 21K Cursive Italic');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'Zoom',
			shapeName: 'Cursive Italic',
			brandName: 'Sailor',
			manufacturerName: 'Sailor'
		});
	});

	it('"Music" is Sailor\'s own proprietary nib — round, no shape override needed', () => {
		const result = parseNibText(db, 'Music 21K');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'Music',
			shapeName: 'Round',
			brandName: 'Sailor',
			manufacturerName: 'Sailor'
		});
	});

	it('"C" (Coarse) is a real, generic vintage point size, not brand-specific — no maker implied', () => {
		const result = parseNibText(db, 'C 14K');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'C',
			shapeName: 'Round',
			brandName: null,
			manufacturerName: null
		});
	});

	it('a bare point size not in POINT_SIZE_MAKER has no brand/manufacturer implied', () => {
		const result = parseNibText(db, 'B');
		expect(result).toMatchObject({ brandName: null, manufacturerName: null });
	});

	it('"CM" is Pilot\'s own proprietary Calligraphy Medium — a 1mm stub, not round', () => {
		const result = parseNibText(db, 'CM');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'CM',
			shapeName: 'Stub',
			brandName: 'Pilot',
			manufacturerName: 'Pilot'
		});
	});

	it('"OM" decomposes into point size M and the Oblique shape — not its own atomic grade', () => {
		const result = parseNibText(db, 'OM 14K');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'M',
			purityName: '14K',
			shapeName: 'Oblique',
			brandName: null,
			manufacturerName: null,
			customName: null,
			isCustomGrind: false
		});
	});

	it('the Oblique decomposition generalizes to any known width, not just M — "OBB"', () => {
		const result = parseNibText(db, 'OBB 18K');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'BB',
			shapeName: 'Oblique'
		});
	});

	it('an explicit shape token still overrides the Oblique decomposition', () => {
		// Cursive Italic is pre-seeded by migration now — no manual insert needed.
		const result = parseNibText(db, 'OM Cursive Italic');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'M',
			shapeName: 'Cursive Italic'
		});
	});

	it('a bare "O" alone is not treated as an Oblique-prefixed width — no known size remains after stripping it', () => {
		const result = parseNibText(db, 'O');
		expect(result.kind).toBe('unparseable');
	});

	it('point size matching is case-insensitive but always records the seed\'s canonical casing — lowercase "flex" still resolves to "Flex"', () => {
		const result = parseNibText(db, 'flex');
		expect(result).toMatchObject({ kind: 'parsed', pointSize: 'Flex', isFlex: true });
	});

	it('the Oblique-prefix decomposition is case-insensitive on both the "o" prefix and the remaining width', () => {
		const result = parseNibText(db, 'om 14K');
		expect(result).toMatchObject({ kind: 'parsed', pointSize: 'M', shapeName: 'Oblique' });
	});
});
