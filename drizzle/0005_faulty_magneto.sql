PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
ALTER TABLE `__new_pens` RENAME TO `pens`;--> statement-breakpoint
PRAGMA foreign_keys=ON;