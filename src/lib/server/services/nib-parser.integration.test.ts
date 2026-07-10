import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../db/migrate';
import { aliases, finishes, nib_materials, nib_shapes } from '../db/schema';
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
			flags: []
		});
	});

	it('a full compound entry extracts point size, base size, an explicit material, and a multi-word shape', () => {
		db.insert(nib_shapes).values({ name: 'Cursive Smooth Italic' }).run();
		db.insert(nib_materials).values({ name: 'Titanium' }).run();

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
		const result = parseNibText(db, 'M Journaler');
		expect(result).toMatchObject({
			kind: 'parsed',
			pointSize: 'M',
			customName: 'Journaler',
			isCustomGrind: true
		});
	});

	it('a known alias resolves to its canonical shape, the same way brand aliases resolve', () => {
		const shape = db.insert(nib_shapes).values({ name: 'Cursive Italic' }).returning().get();
		db.insert(aliases)
			.values({ alias: 'Journaler', aliasable_type: 'nib_shape', aliasable_id: shape.id })
			.run();

		const result = parseNibText(db, 'M Journaler');
		expect(result).toMatchObject({
			kind: 'parsed',
			shapeName: 'Cursive Italic',
			customName: null,
			isCustomGrind: false
		});
	});

	it('finish (plating color) is extracted separately from material — confirmed real case', () => {
		db.insert(finishes).values({ name: 'Rose Gold' }).run();

		const result = parseNibText(db, 'F Rose Gold');
		expect(result).toMatchObject({
			pointSize: 'F',
			finishName: 'Rose Gold',
			materialName: 'Steel',
			customName: null
		});
	});

	it('a malformed token that is a near-miss of a real point size is flagged, not guessed — the "sF" case', () => {
		const result = parseNibText(db, 'sF');
		expect(result.kind).toBe('unparseable');
	});

	it('a bare custom grind name with no point size anywhere is flagged, not defaulted', () => {
		const result = parseNibText(db, 'Journaler');
		expect(result.kind).toBe('unparseable');
	});

	it('text with no point size and no recognizable vocabulary at all is flagged', () => {
		const result = parseNibText(db, 'Long Knife');
		expect(result.kind).toBe('unparseable');
	});

	it('a leftover token that near-matches a known shape/material/finish is flagged rather than treated as a custom name', () => {
		db.insert(nib_shapes).values({ name: 'Cursive Italic' }).returning().get();
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
});
