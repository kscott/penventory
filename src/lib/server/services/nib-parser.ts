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
			brandName: string | null;
			manufacturerName: string | null;
			nibmeisterName: string | null;
	  };

// A handful of point sizes are a specific vertically-integrated maker's own
// proprietary nib design, not a generic width grade — confirmed against
// Ken's real collection (2026-07-13): Pilot's Signature (round) and CM
// ("Calligraphy Medium" — Stub-class, not round), Sailor's Zoom
// (architect-style) and Music (round, 3-tine). brand and manufacturer are
// the same maker for all four seen so far — see
// docs/adr/2026-07-13-nib-manufacturer-and-brand-are-independent-fields.md.
// `shape` overrides the Round default only when the maker's own design isn't
// round (Zoom, CM); an explicit shape token in the text still wins over this.
const POINT_SIZE_MAKER: Record<string, { brand: string; manufacturer: string; shape?: string }> = {
	Signature: { brand: 'Pilot', manufacturer: 'Pilot' },
	CM: { brand: 'Pilot', manufacturer: 'Pilot', shape: 'Stub' },
	Zoom: { brand: 'Sailor', manufacturer: 'Sailor', shape: 'Architect' },
	Music: { brand: 'Sailor', manufacturer: 'Sailor' }
};

// Some shape words are themselves the name of a publicly-known, popularized
// nibmeister grind — not a manufacturer's own stock shape, even though
// (like any other shape word) they resolve via alias/exact-match to a
// canonical nib_shapes entry. Confirmed public, industry-known terminology
// popularized through Esterbrook (Ken, 2026-07-13): "Journaler" (Gena
// Saloreno, implies Medium), "Scribe" (Joshua Lax, implies Broad), and
// "Imperial" (Kirk Speer — a Stub variant, half-round and flat on top,
// distinct enough from plain Stub to be its own seeded shape rather than an
// alias to it) — Imperial has no implied point size of its own, unlike the
// other two; bare "Imperial" with no width given anywhere still correctly
// stays unparseable, needing a real correction, not a guess. The
// nibmeister fact applies whenever the word appears at all, not only when
// its point size is the implied one — "M Journaler" is still Gena
// Saloreno's grind. Distinct from POINT_SIZE_MAKER's manufacturer-branded
// point sizes (Signature/Zoom/Music/CM — a maker's own stock design:
// brand_id/manufacturer_id set, never is_custom_grind): these are a
// nibmeister's aftermarket modification of someone else's blank —
// nibmeister_id set instead, is_custom_grind always true, brand_id/
// manufacturer_id stay unknown/null.
const NIBMEISTER_GRIND: Record<string, { impliedPointSize?: string; nibmeister: string }> = {
	Journaler: { impliedPointSize: 'M', nibmeister: 'Gena Saloreno' },
	Scribe: { impliedPointSize: 'B', nibmeister: 'Joshua Lax' },
	Imperial: { nibmeister: 'Kirk Speer' }
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

type Category = 'shape' | 'material' | 'finish';

// Shape/material/finish are extracted together, longest phrase first across
// all three vocabularies at once — not as three separate sequential passes
// (shape, then material, then finish). A sequential pass lets a shorter
// phrase from an earlier category steal a word that would otherwise form a
// longer, more specific phrase in a later category: with "Gold" seeded as a
// nib_material, a strictly-sequential material pass matches "Gold" inside
// "Rose Gold" before the finish pass ever runs, leaving "Rose" as orphaned
// leftover text and silently dropping the real finish. Confirmed reachable
// with real data, not hypothetical: any bare-purity nib ("B 18K") defaults
// materialName to "Gold", which becomes a real nib_materials row on first
// commit — every later "Rose Gold" finish would break the same way.
function extractCategorizedPhrases(
	tokens: string[],
	vocabularies: Record<Category, Phrase[]>
): {
	tokens: string[];
	matches: Record<Category, string | null>;
} {
	const combined = (
		[
			...vocabularies.shape.map((p) => ({ ...p, category: 'shape' as const })),
			...vocabularies.material.map((p) => ({ ...p, category: 'material' as const })),
			...vocabularies.finish.map((p) => ({ ...p, category: 'finish' as const }))
		] as (Phrase & { category: Category })[]
	).sort((a, b) => b.words.length - a.words.length);

	let remaining = tokens;
	const matches: Record<Category, string | null> = { shape: null, material: null, finish: null };
	for (const phrase of combined) {
		if (matches[phrase.category]) continue;
		const match = extractPhrase(remaining, [phrase]);
		if (!match) continue;
		remaining = match.remaining;
		matches[phrase.category] = match.canonicalName;
	}
	return { tokens: remaining, matches };
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

	// Checked up front, against the original token list — a nibmeister grind
	// word's nibmeister fact applies whenever it appears at all, whether or
	// not its own point size happens to be given explicitly elsewhere
	// ("M Journaler" is still Gena Saloreno's grind, not just bare
	// "Journaler"). See NIBMEISTER_GRIND above.
	const nibmeisterEntry = Object.entries(NIBMEISTER_GRIND).find(([shape]) =>
		tokens.some((t) => t.toLowerCase() === shape.toLowerCase())
	);
	const nibmeisterName = nibmeisterEntry?.[1].nibmeister ?? null;

	// "Oblique" is a real nib shape, but unlike every other shape word it's
	// never written as its own separate token — it's glued directly onto a
	// width code with no space ("OM" = Oblique + Medium; also seen combined
	// with B/BB/BBB). Confirmed universal (Ken, 2026-07-13). Checked only
	// after a direct match fails, so it can never shadow a genuine seeded
	// code that happens to start with "O" (there isn't one today, but this
	// keeps a direct match authoritative if one's ever added).
	let pointSizeIndex = tokens.findIndex((t) =>
		(NIB_POINT_SIZE_SEED as readonly string[]).includes(t)
	);
	let isOblique = false;
	if (pointSizeIndex === -1) {
		pointSizeIndex = tokens.findIndex(
			(t) =>
				t.length > 1 &&
				t.startsWith('O') &&
				(NIB_POINT_SIZE_SEED as readonly string[]).includes(t.slice(1))
		);
		isOblique = pointSizeIndex !== -1;
	}
	// A nibmeister grind word carries its own implied point size, by
	// definition, when no separate width is given anywhere in the text.
	// Checked only after both real point-size checks above fail, and
	// doesn't consume the token — it's left in place so the shape-matching
	// step below still finds and resolves it via alias/exact-match, the
	// same as when a width is given explicitly.
	const impliedPointSize =
		pointSizeIndex === -1 ? (nibmeisterEntry?.[1].impliedPointSize ?? null) : null;
	if (pointSizeIndex === -1 && !impliedPointSize) {
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
	let pointSize: string;
	if (pointSizeIndex === -1) {
		// impliedPointSize — no token to remove; the shape word that implied
		// it stays in tokens for the shape-matching step below.
		pointSize = impliedPointSize!;
	} else {
		pointSize = isOblique ? tokens[pointSizeIndex].slice(1) : tokens[pointSizeIndex];
		tokens = [...tokens.slice(0, pointSizeIndex), ...tokens.slice(pointSizeIndex + 1)];
	}

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
	const materialVocabulary = loadVocabulary(db, nib_materials, 'nib_material');
	const finishVocabulary = loadVocabulary(db, finishes, 'finish');
	const extracted = extractCategorizedPhrases(tokens, {
		shape: shapeVocabulary,
		material: materialVocabulary,
		finish: finishVocabulary
	});
	tokens = extracted.tokens;

	const maker = POINT_SIZE_MAKER[pointSize];
	const shapeName = extracted.matches.shape ?? (isOblique ? 'Oblique' : maker?.shape) ?? 'Round';
	const materialName = extracted.matches.material ?? (purityName ? 'Gold' : 'Steel');
	const finishName = extracted.matches.finish ?? null;

	let customName: string | null = null;
	// A nibmeister grind is always a custom grind, even though its shape
	// resolves via known vocabulary just like a manufacturer's stock
	// shape — it's still an aftermarket modification, not how the nib
	// came from the factory.
	let isCustomGrind = nibmeisterName !== null;
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
		flags,
		brandName: maker?.brand ?? null,
		manufacturerName: maker?.manufacturer ?? null,
		nibmeisterName
	};
}
