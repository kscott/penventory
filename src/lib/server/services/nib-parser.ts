import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { isNearDuplicate } from '../similarity';
import {
	aliases,
	finishes,
	nib_base_sizes,
	nib_materials,
	nib_purities,
	nib_shapes,
	NIB_POINT_SIZE_SEED
} from '../db/schema';
import type * as schema from '../db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type NibFieldFlag = {
	field: 'nib_base_size' | 'nib_purity';
	rawValue: string;
};

export type ParsedNibText =
	| { kind: 'blank' }
	| { kind: 'unparseable'; reason: string }
	| {
			kind: 'parsed';
			pointSize: string;
			baseSizeName: string;
			purityName: string | null;
			materialName: string;
			shapeName: string;
			finishName: string | null;
			customName: string | null;
			isCustomGrind: boolean;
			flags: NibFieldFlag[];
	  };

// One phrase per candidate name (canonical or alias), longest-word-count
// first — so "Cursive Smooth Italic" is tried before "Cursive Italic" before
// "Italic", never matching a shorter phrase that's actually a substring of a
// longer real one.
type Phrase = { words: string[]; canonicalName: string };

function loadVocabulary(
	db: Db,
	table: typeof nib_shapes | typeof nib_materials | typeof finishes,
	aliasableType: 'nib_shape' | 'nib_material' | 'finish'
): Phrase[] {
	const canonicalRows = db.select().from(table).all();
	const aliasRows = db
		.select()
		.from(aliases)
		.where(eq(aliases.aliasable_type, aliasableType))
		.all();

	const phrases: Phrase[] = canonicalRows.map((row) => ({
		words: row.name.split(/\s+/),
		canonicalName: row.name
	}));

	for (const alias of aliasRows) {
		const canonical = canonicalRows.find((row) => row.id === alias.aliasable_id);
		if (canonical) {
			phrases.push({ words: alias.alias.split(/\s+/), canonicalName: canonical.name });
		}
	}

	return phrases.sort((a, b) => b.words.length - a.words.length);
}

// Finds the first (longest-first) phrase from `vocabulary` that appears as a
// contiguous, case-insensitive run within `tokens`. Returns the matched
// canonical name and the tokens with that run removed.
function extractPhrase(
	tokens: string[],
	vocabulary: Phrase[]
): { canonicalName: string; remaining: string[] } | null {
	for (const phrase of vocabulary) {
		for (let start = 0; start <= tokens.length - phrase.words.length; start++) {
			const slice = tokens.slice(start, start + phrase.words.length);
			const matches = slice.every(
				(word, i) => word.toLowerCase() === phrase.words[i].toLowerCase()
			);
			if (matches) {
				return {
					canonicalName: phrase.canonicalName,
					remaining: [...tokens.slice(0, start), ...tokens.slice(start + phrase.words.length)]
				};
			}
		}
	}
	return null;
}

function findExactName(db: Db, table: typeof nib_base_sizes | typeof nib_purities, name: string) {
	return db.select().from(table).where(eq(table.name, name)).get();
}

// Confirmed against Ken's real FPC export — see phase1-plan.md step 6 and the
// step's implementation plan. Point size is the one fact a nib record can't
// safely proceed without: no default exists for it, unlike base size/
// material/shape (rules below), which fall back to the common case (#6/
// Steel/Round) whenever the text doesn't say otherwise.
export function parseNibText(db: Db, raw: string): ParsedNibText {
	const trimmed = raw.trim();
	if (trimmed === '') {
		return { kind: 'blank' };
	}

	let tokens = trimmed.split(/\s+/);

	const pointSizeIndex = tokens.findIndex((t) =>
		(NIB_POINT_SIZE_SEED as readonly string[]).includes(t)
	);
	if (pointSizeIndex === -1) {
		const nearMiss = tokens.find((t) =>
			NIB_POINT_SIZE_SEED.some((size) => isNearDuplicate(t.toLowerCase(), size.toLowerCase()))
		);
		return {
			kind: 'unparseable',
			reason: nearMiss
				? `no exact point size match, but "${nearMiss}" is close to a known one — likely a typo`
				: 'no point size found anywhere in the text'
		};
	}
	const pointSize = tokens[pointSizeIndex];
	tokens = [...tokens.slice(0, pointSizeIndex), ...tokens.slice(pointSizeIndex + 1)];

	const flags: NibFieldFlag[] = [];

	const baseSizeIndex = tokens.findIndex((t) => /^#\d+$/.test(t));
	let baseSizeName = '#6';
	if (baseSizeIndex !== -1) {
		baseSizeName = tokens[baseSizeIndex];
		tokens = [...tokens.slice(0, baseSizeIndex), ...tokens.slice(baseSizeIndex + 1)];
		if (!findExactName(db, nib_base_sizes, baseSizeName)) {
			flags.push({ field: 'nib_base_size', rawValue: baseSizeName });
		}
	}

	const purityIndex = tokens.findIndex((t) => /^\d+K$/i.test(t));
	let purityName: string | null = null;
	if (purityIndex !== -1) {
		purityName = tokens[purityIndex].toUpperCase();
		tokens = [...tokens.slice(0, purityIndex), ...tokens.slice(purityIndex + 1)];
		if (!findExactName(db, nib_purities, purityName)) {
			flags.push({ field: 'nib_purity', rawValue: purityName });
		}
	}

	const shapeVocabulary = loadVocabulary(db, nib_shapes, 'nib_shape');
	const shapeMatch = extractPhrase(tokens, shapeVocabulary);
	if (shapeMatch) tokens = shapeMatch.remaining;

	const materialVocabulary = loadVocabulary(db, nib_materials, 'nib_material');
	const materialMatch = extractPhrase(tokens, materialVocabulary);
	if (materialMatch) tokens = materialMatch.remaining;

	const finishVocabulary = loadVocabulary(db, finishes, 'finish');
	const finishMatch = extractPhrase(tokens, finishVocabulary);
	if (finishMatch) tokens = finishMatch.remaining;

	const shapeName = shapeMatch?.canonicalName ?? 'Round';
	const materialName = materialMatch?.canonicalName ?? (purityName ? 'Gold' : 'Steel');
	const finishName = finishMatch?.canonicalName ?? null;

	let customName: string | null = null;
	let isCustomGrind = false;
	if (tokens.length > 0) {
		const leftover = tokens.join(' ');
		const allKnownNames = [...shapeVocabulary, ...materialVocabulary, ...finishVocabulary].map(
			(p) => p.words.join(' ')
		);
		const looksLikeATypo = allKnownNames.some((name) =>
			isNearDuplicate(leftover.toLowerCase(), name.toLowerCase())
		);
		if (looksLikeATypo) {
			return {
				kind: 'unparseable',
				reason: `"${leftover}" is close to a known nib shape/material/finish but doesn't match exactly — likely a typo`
			};
		}
		customName = leftover;
		isCustomGrind = true;
	}

	return {
		kind: 'parsed',
		pointSize,
		baseSizeName,
		purityName,
		materialName,
		shapeName,
		finishName,
		customName,
		isCustomGrind,
		flags
	};
}
