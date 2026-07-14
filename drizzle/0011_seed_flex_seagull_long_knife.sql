-- Custom SQL migration file, put your code below! --
-- "Flex" is Noodler's own factory name/type for these nibs (Ken,
-- 2026-07-13), not a generic width grade — same mechanism as
-- Signature/Zoom/Music/CM, but with no implied brand/manufacturer/shape.
-- The actual behavior half lives on nibs.is_flex (see the ALTER TABLE in
-- migration 0010), set whenever the point size itself is "Flex".
INSERT INTO `nib_point_sizes` (`name`) VALUES ('Flex');--> statement-breakpoint
-- "Seagull"/"Long Knife" are real nib shapes. "Seagul" (as it actually
-- appears in Ken's data) aliases to the correctly-spelled "Seagull"; "Long
-- Blade" aliases to "Long Knife" — Ken confirmed the two are
-- interchangeable, an Architect-type shape. Unlike Journaler/Scribe/
-- Imperial, no nibmeister was named for Long Knife/Long Blade — it's an
-- ordinary shape, not a nibmeister-grind entry in nib-parser.ts.
INSERT INTO `nib_shapes` (`name`) VALUES ('Seagull'), ('Long Knife');--> statement-breakpoint
INSERT INTO `aliases` (`alias`, `aliasable_type`, `aliasable_id`) SELECT 'Seagul', 'nib_shape', `id` FROM `nib_shapes` WHERE `name` = 'Seagull';--> statement-breakpoint
INSERT INTO `aliases` (`alias`, `aliasable_type`, `aliasable_id`) SELECT 'Long Blade', 'nib_shape', `id` FROM `nib_shapes` WHERE `name` = 'Long Knife';
