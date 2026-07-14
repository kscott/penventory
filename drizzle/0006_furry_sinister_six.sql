PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alias` text NOT NULL,
	`aliasable_type` text NOT NULL,
	`aliasable_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_aliases`("id", "alias", "aliasable_type", "aliasable_id", "created_at", "updated_at") SELECT "id", "alias", "aliasable_type", "aliasable_id", "created_at", "updated_at" FROM `aliases`;--> statement-breakpoint
DROP TABLE `aliases`;--> statement-breakpoint
ALTER TABLE `__new_aliases` RENAME TO `aliases`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `aliases_alias_aliasable_type_unique` ON `aliases` (`alias`,`aliasable_type`);--> statement-breakpoint
CREATE TABLE `__new_brands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_brands`("id", "name", "created_at", "updated_at") SELECT "id", "name", "created_at", "updated_at" FROM `brands`;--> statement-breakpoint
DROP TABLE `brands`;--> statement-breakpoint
ALTER TABLE `__new_brands` RENAME TO `brands`;--> statement-breakpoint
CREATE UNIQUE INDEX `brands_name_unique` ON `brands` (`name`);--> statement-breakpoint
CREATE TABLE `__new_filling_systems` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_filling_systems`("id", "name", "created_at", "updated_at") SELECT "id", "name", "created_at", "updated_at" FROM `filling_systems`;--> statement-breakpoint
DROP TABLE `filling_systems`;--> statement-breakpoint
ALTER TABLE `__new_filling_systems` RENAME TO `filling_systems`;--> statement-breakpoint
CREATE UNIQUE INDEX `filling_systems_name_unique` ON `filling_systems` (`name`);--> statement-breakpoint
CREATE TABLE `__new_finishes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_finishes`("id", "name", "created_at", "updated_at") SELECT "id", "name", "created_at", "updated_at" FROM `finishes`;--> statement-breakpoint
DROP TABLE `finishes`;--> statement-breakpoint
ALTER TABLE `__new_finishes` RENAME TO `finishes`;--> statement-breakpoint
CREATE UNIQUE INDEX `finishes_name_unique` ON `finishes` (`name`);--> statement-breakpoint
CREATE TABLE `__new_import_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_type` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`committed_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_import_attempts`("id", "operation_type", "status", "created_at", "committed_at") SELECT "id", "operation_type", "status", "created_at", "committed_at" FROM `import_attempts`;--> statement-breakpoint
DROP TABLE `import_attempts`;--> statement-breakpoint
ALTER TABLE `__new_import_attempts` RENAME TO `import_attempts`;--> statement-breakpoint
CREATE TABLE `__new_import_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_type` text NOT NULL,
	`mode` text NOT NULL,
	`report_summary` text,
	`run_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_import_runs`("id", "operation_type", "mode", "report_summary", "run_at") SELECT "id", "operation_type", "mode", "report_summary", "run_at" FROM `import_runs`;--> statement-breakpoint
DROP TABLE `import_runs`;--> statement-breakpoint
ALTER TABLE `__new_import_runs` RENAME TO `import_runs`;--> statement-breakpoint
CREATE TABLE `__new_inks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`line_id` integer,
	`maker_id` integer,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`color_fpc` text NOT NULL,
	`color_swatch` text,
	`color_colorimeter` text,
	`color_community` text,
	`color_override_source` text,
	`sheen` text,
	`shimmer` integer DEFAULT false NOT NULL,
	`shading` text,
	`permanence` integer DEFAULT false NOT NULL,
	`wetness` text,
	`flow` text,
	`notes` text,
	`ownership_state` text NOT NULL,
	`ownership_changed_on` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`maker_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_inks`("id", "brand_id", "line_id", "maker_id", "name", "type", "color_fpc", "color_swatch", "color_colorimeter", "color_community", "color_override_source", "sheen", "shimmer", "shading", "permanence", "wetness", "flow", "notes", "ownership_state", "ownership_changed_on", "created_at", "updated_at") SELECT "id", "brand_id", "line_id", "maker_id", "name", "type", "color_fpc", "color_swatch", "color_colorimeter", "color_community", "color_override_source", "sheen", "shimmer", "shading", "permanence", "wetness", "flow", "notes", "ownership_state", "ownership_changed_on", "created_at", "updated_at" FROM `inks`;--> statement-breakpoint
DROP TABLE `inks`;--> statement-breakpoint
ALTER TABLE `__new_inks` RENAME TO `inks`;--> statement-breakpoint
CREATE TABLE `__new_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_lines`("id", "brand_id", "name", "created_at", "updated_at") SELECT "id", "brand_id", "name", "created_at", "updated_at" FROM `lines`;--> statement-breakpoint
DROP TABLE `lines`;--> statement-breakpoint
ALTER TABLE `__new_lines` RENAME TO `lines`;--> statement-breakpoint
CREATE UNIQUE INDEX `lines_brand_id_name_unique` ON `lines` (`brand_id`,`name`);--> statement-breakpoint
CREATE TABLE `__new_models` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_models`("id", "brand_id", "name", "created_at", "updated_at") SELECT "id", "brand_id", "name", "created_at", "updated_at" FROM `models`;--> statement-breakpoint
DROP TABLE `models`;--> statement-breakpoint
ALTER TABLE `__new_models` RENAME TO `models`;--> statement-breakpoint
CREATE UNIQUE INDEX `models_brand_id_name_unique` ON `models` (`brand_id`,`name`);--> statement-breakpoint
CREATE TABLE `__new_nib_base_sizes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_nib_base_sizes`("id", "name", "created_at", "updated_at") SELECT "id", "name", "created_at", "updated_at" FROM `nib_base_sizes`;--> statement-breakpoint
DROP TABLE `nib_base_sizes`;--> statement-breakpoint
ALTER TABLE `__new_nib_base_sizes` RENAME TO `nib_base_sizes`;--> statement-breakpoint
CREATE UNIQUE INDEX `nib_base_sizes_name_unique` ON `nib_base_sizes` (`name`);--> statement-breakpoint
CREATE TABLE `__new_nib_materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_nib_materials`("id", "name", "created_at", "updated_at") SELECT "id", "name", "created_at", "updated_at" FROM `nib_materials`;--> statement-breakpoint
DROP TABLE `nib_materials`;--> statement-breakpoint
ALTER TABLE `__new_nib_materials` RENAME TO `nib_materials`;--> statement-breakpoint
CREATE UNIQUE INDEX `nib_materials_name_unique` ON `nib_materials` (`name`);--> statement-breakpoint
CREATE TABLE `__new_nib_point_sizes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_nib_point_sizes`("id", "name", "created_at", "updated_at") SELECT "id", "name", "created_at", "updated_at" FROM `nib_point_sizes`;--> statement-breakpoint
DROP TABLE `nib_point_sizes`;--> statement-breakpoint
ALTER TABLE `__new_nib_point_sizes` RENAME TO `nib_point_sizes`;--> statement-breakpoint
CREATE UNIQUE INDEX `nib_point_sizes_name_unique` ON `nib_point_sizes` (`name`);--> statement-breakpoint
CREATE TABLE `__new_nib_purities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_nib_purities`("id", "name", "created_at", "updated_at") SELECT "id", "name", "created_at", "updated_at" FROM `nib_purities`;--> statement-breakpoint
DROP TABLE `nib_purities`;--> statement-breakpoint
ALTER TABLE `__new_nib_purities` RENAME TO `nib_purities`;--> statement-breakpoint
CREATE UNIQUE INDEX `nib_purities_name_unique` ON `nib_purities` (`name`);--> statement-breakpoint
CREATE TABLE `__new_nib_shapes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_nib_shapes`("id", "name", "created_at", "updated_at") SELECT "id", "name", "created_at", "updated_at" FROM `nib_shapes`;--> statement-breakpoint
DROP TABLE `nib_shapes`;--> statement-breakpoint
ALTER TABLE `__new_nib_shapes` RENAME TO `nib_shapes`;--> statement-breakpoint
CREATE UNIQUE INDEX `nib_shapes_name_unique` ON `nib_shapes` (`name`);--> statement-breakpoint
CREATE TABLE `__new_nibs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer,
	`material_id` integer NOT NULL,
	`purity_id` integer,
	`base_size_id` integer NOT NULL,
	`point_size_id` integer NOT NULL,
	`shape_id` integer NOT NULL,
	`finish_id` integer,
	`custom_name` text,
	`is_custom_grind` integer DEFAULT false NOT NULL,
	`grind_description` text,
	`nibmeister_id` integer,
	`ground_on` integer,
	`feedback` text,
	`wetness` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `nib_materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purity_id`) REFERENCES `nib_purities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_size_id`) REFERENCES `nib_base_sizes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`point_size_id`) REFERENCES `nib_point_sizes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shape_id`) REFERENCES `nib_shapes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`finish_id`) REFERENCES `finishes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`nibmeister_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_nibs`("id", "brand_id", "material_id", "purity_id", "base_size_id", "point_size_id", "shape_id", "finish_id", "custom_name", "is_custom_grind", "grind_description", "nibmeister_id", "ground_on", "feedback", "wetness", "notes", "created_at", "updated_at") SELECT "id", "brand_id", "material_id", "purity_id", "base_size_id", "point_size_id", "shape_id", "finish_id", "custom_name", "is_custom_grind", "grind_description", "nibmeister_id", "ground_on", "feedback", "wetness", "notes", "created_at", "updated_at" FROM `nibs`;--> statement-breakpoint
DROP TABLE `nibs`;--> statement-breakpoint
ALTER TABLE `__new_nibs` RENAME TO `nibs`;--> statement-breakpoint
CREATE TABLE `__new_pen_materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_pen_materials`("id", "name", "created_at", "updated_at") SELECT "id", "name", "created_at", "updated_at" FROM `pen_materials`;--> statement-breakpoint
DROP TABLE `pen_materials`;--> statement-breakpoint
ALTER TABLE `__new_pen_materials` RENAME TO `pen_materials`;--> statement-breakpoint
CREATE UNIQUE INDEX `pen_materials_name_unique` ON `pen_materials` (`name`);--> statement-breakpoint
CREATE TABLE `__new_pens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`model_id` integer NOT NULL,
	`color` text NOT NULL,
	`material_id` integer NOT NULL,
	`trim_color_id` integer,
	`filling_system_id` integer NOT NULL,
	`size_category` text,
	`condition` text,
	`accessories_note` text,
	`notes` text,
	`ownership_state` text NOT NULL,
	`ownership_changed_on` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `pen_materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trim_color_id`) REFERENCES `finishes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filling_system_id`) REFERENCES `filling_systems`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_pens`("id", "brand_id", "model_id", "color", "material_id", "trim_color_id", "filling_system_id", "size_category", "condition", "accessories_note", "notes", "ownership_state", "ownership_changed_on", "created_at", "updated_at") SELECT "id", "brand_id", "model_id", "color", "material_id", "trim_color_id", "filling_system_id", "size_category", "condition", "accessories_note", "notes", "ownership_state", "ownership_changed_on", "created_at", "updated_at" FROM `pens`;--> statement-breakpoint
DROP TABLE `pens`;--> statement-breakpoint
ALTER TABLE `__new_pens` RENAME TO `pens`;--> statement-breakpoint
CREATE TABLE `__new_vendors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_vendors`("id", "name", "created_at", "updated_at") SELECT "id", "name", "created_at", "updated_at" FROM `vendors`;--> statement-breakpoint
DROP TABLE `vendors`;--> statement-breakpoint
ALTER TABLE `__new_vendors` RENAME TO `vendors`;--> statement-breakpoint
CREATE UNIQUE INDEX `vendors_name_unique` ON `vendors` (`name`);