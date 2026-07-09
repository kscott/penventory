CREATE TABLE `inks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`line_id` integer NOT NULL,
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
CREATE TABLE `nib_base_sizes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nib_base_sizes_name_unique` ON `nib_base_sizes` (`name`);--> statement-breakpoint
CREATE TABLE `nib_point_sizes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nib_point_sizes_name_unique` ON `nib_point_sizes` (`name`);--> statement-breakpoint
CREATE TABLE `nib_purities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nib_purities_name_unique` ON `nib_purities` (`name`);--> statement-breakpoint
CREATE TABLE `nibs` (
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
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
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
CREATE TABLE `pens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`model_id` integer NOT NULL,
	`color` text NOT NULL,
	`material_id` integer NOT NULL,
	`trim_color_id` integer NOT NULL,
	`filling_system_id` integer NOT NULL,
	`size_category` text NOT NULL,
	`condition` text NOT NULL,
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
CREATE TABLE `taggables` (
	`tag_id` integer NOT NULL,
	`taggable_type` text NOT NULL,
	`taggable_id` integer NOT NULL,
	PRIMARY KEY(`tag_id`, `taggable_type`, `taggable_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
-- Seed data, not schema: the known real-world purity/base_size/point_size
-- values as of this migration (NIB_PURITY_SEED/NIB_BASE_SIZE_SEED/
-- NIB_POINT_SIZE_SEED in schema.ts). A genuinely new value later is a data
-- operation (an insert), not a further migration — see ARCHITECTURE.md.
INSERT INTO `nib_purities` (`name`) VALUES ('9K'), ('14K'), ('18K'), ('21K'), ('22K');--> statement-breakpoint
INSERT INTO `nib_base_sizes` (`name`) VALUES ('#5'), ('#6'), ('#8');--> statement-breakpoint
INSERT INTO `nib_point_sizes` (`name`) VALUES
	('EF'), ('F'), ('FM'), ('MF'), ('F/M'), ('M'), ('OM'), ('CM'), ('B'), ('BB'), ('BBB'), ('XXXF'),
	('1.0'), ('1.1'), ('1.4'), ('1.5');