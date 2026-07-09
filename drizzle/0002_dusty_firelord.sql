CREATE TABLE `pen_nibs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pen_id` integer NOT NULL,
	`nib_id` integer NOT NULL,
	`installed_on` integer NOT NULL,
	`removed_on` integer,
	`notes` text,
	FOREIGN KEY (`pen_id`) REFERENCES `pens`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`nib_id`) REFERENCES `nibs`(`id`) ON UPDATE no action ON DELETE no action
);
