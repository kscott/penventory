-- Custom SQL migration file, put your code below! --
-- Unlike nib_purities/nib_base_sizes/nib_point_sizes, nib_shapes/nib_materials/
-- finishes were never seeded — they're resolveOrFlag-style controlled lists,
-- open-ended by design. But parseNibText does its own phrase-matching
-- against these tables *before* a value ever reaches resolveOrFlag: an
-- unmatched word silently falls into custom_name with a defaulted
-- material/shape, instead of ever being offered as a "new value" candidate.
-- On a genuinely empty database (Ken's real first import), that meant most
-- of the descriptive words in his real Nib column would never be recognized
-- as structured data at all. Seeded here with what's already confirmed in
-- his real collected_pens.csv, so first occurrence resolves correctly. See
-- docs/adr/2026-07-13-nib-manufacturer-and-brand-are-independent-fields.md.
INSERT INTO `nib_shapes` (`name`) VALUES ('Round'), ('Stub'), ('Cursive Italic'), ('Cursive Smooth Italic'), ('Architect'), ('Italic'), ('Oblique');--> statement-breakpoint
-- "Journaler" is, by definition, a Medium Cursive Smooth Italic (Ken,
-- 2026-07-13) — the shape alias target, corrected from an earlier guess of
-- plain "Cursive Italic". The implied-Medium half of that definition lives
-- in nib-parser.ts's SHAPE_IMPLIED_POINT_SIZE, not here.
INSERT INTO `aliases` (`alias`, `aliasable_type`, `aliasable_id`) SELECT 'Journaler', 'nib_shape', `id` FROM `nib_shapes` WHERE `name` = 'Cursive Smooth Italic';--> statement-breakpoint
INSERT INTO `nib_materials` (`name`) VALUES ('Steel'), ('Gold'), ('Titanium');--> statement-breakpoint
-- Gold/Silver are seeded as "Gold Tone"/"Silver Tone" — Ken's real trim
-- colors are almost always describing the visual tone of the plating, not
-- literal precious-metal composition (that's tracked separately, on
-- pens.material_id, e.g. "Sterling Silver"). Raw "Gold"/"Silver" text still
-- resolves automatically via alias. Copper/Bronze are deliberately left as
-- literal, unaliased names — Ken has a couple of pens with genuine
-- copper-metal trim mixed in among copper-*toned* ones, indistinguishable
-- from the raw text alone; forcing them through a blanket Tone alias would
-- silently mislabel the real-metal exceptions with no chance to catch it.
-- Gunmetal is its own specific named finish (same bucket as Rhodium/
-- Ruthenium/Rose Gold), not a generic tone. Ken confirmed all of this
-- 2026-07-13.
INSERT INTO `finishes` (`name`) VALUES ('Black'), ('Rose Gold'), ('Ruthenium'), ('Gunmetal'), ('Bronze'), ('Copper'), ('Blue'), ('Brown'), ('Clear'), ('Raven'), ('Stainless Steel'), ('Titanium'), ('Black/Gunmetal'), ('Black/silver'), ('Copper/Gold'), ('Gold/Brass'), ('Gold Tone'), ('Silver Tone');--> statement-breakpoint
INSERT INTO `aliases` (`alias`, `aliasable_type`, `aliasable_id`) SELECT 'Gold', 'finish', `id` FROM `finishes` WHERE `name` = 'Gold Tone';--> statement-breakpoint
INSERT INTO `aliases` (`alias`, `aliasable_type`, `aliasable_id`) SELECT 'Silver', 'finish', `id` FROM `finishes` WHERE `name` = 'Silver Tone';
