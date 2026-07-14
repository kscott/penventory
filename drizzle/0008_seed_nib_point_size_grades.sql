-- Custom SQL migration file, put your code below! --
INSERT INTO `nib_point_sizes` (`name`) VALUES ('C'), ('Signature'), ('Zoom'), ('Music');--> statement-breakpoint
-- 'OM' isn't its own grade — it's "Oblique" (a shape) glued onto "M" with no
-- separating space. parseNibText now decomposes any O-prefixed width code
-- into point_size + shape('Oblique') instead of matching it atomically. See
-- the NIB_POINT_SIZE_SEED comment in schema.ts.
DELETE FROM `nib_point_sizes` WHERE `name` = 'OM';
