CREATE TABLE `import_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_type` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`committed_at` integer
);
--> statement-breakpoint
CREATE TABLE `import_flagged_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_attempt_id` integer NOT NULL,
	`row_data` text NOT NULL,
	`flag_type` text,
	`candidate_info` text,
	`decision` text,
	`decision_target_id` integer,
	`decided_at` integer,
	FOREIGN KEY (`import_attempt_id`) REFERENCES `import_attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`maker_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_inks`("id", "brand_id", "line_id", "maker_id", "name", "type", "color_fpc", "color_swatch", "color_colorimeter", "color_community", "color_override_source", "sheen", "shimmer", "shading", "permanence", "wetness", "flow", "notes", "ownership_state", "ownership_changed_on", "created_at", "updated_at") SELECT "id", "brand_id", "line_id", "maker_id", "name", "type", "color_fpc", "color_swatch", "color_colorimeter", "color_community", "color_override_source", "sheen", "shimmer", "shading", "permanence", "wetness", "flow", "notes", "ownership_state", "ownership_changed_on", "created_at", "updated_at" FROM `inks`;--> statement-breakpoint
DROP TABLE `inks`;--> statement-breakpoint
ALTER TABLE `__new_inks` RENAME TO `inks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_pens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`model_id` integer NOT NULL,
	`color` text NOT NULL,
	`material_id` integer NOT NULL,
	`trim_color_id` integer NOT NULL,
	`filling_system_id` integer NOT NULL,
	`size_category` text,
	`condition` text,
	`accessories_note` text,
	`notes` text,
	`ownership_state` text NOT NULL,
	`ownership_changed_on` integer,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `pen_materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trim_color_id`) REFERENCES `finishes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filling_system_id`) REFERENCES `filling_systems`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_pens`("id", "brand_id", "model_id", "color", "material_id", "trim_color_id", "filling_system_id", "size_category", "condition", "accessories_note", "notes", "ownership_state", "ownership_changed_on", "created_at", "updated_at") SELECT "id", "brand_id", "model_id", "color", "material_id", "trim_color_id", "filling_system_id", "size_category", "condition", "accessories_note", "notes", "ownership_state", "ownership_changed_on", "created_at", "updated_at" FROM `pens`;--> statement-breakpoint
DROP TABLE `pens`;--> statement-breakpoint
ALTER TABLE `__new_pens` RENAME TO `pens`;