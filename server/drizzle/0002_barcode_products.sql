CREATE TABLE `filament_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`barcode` text NOT NULL,
	`type_id` integer NOT NULL,
	`manufacturer` text NOT NULL,
	`color_name` text NOT NULL,
	`color_hex` text DEFAULT '#cccccc' NOT NULL,
	`finish_id` integer,
	`diameter` real DEFAULT 1.75 NOT NULL,
	`weight_total_g` real DEFAULT 1000 NOT NULL,
	`price` real,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`type_id`) REFERENCES `filament_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`finish_id`) REFERENCES `finishes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filament_products_barcode_unique` ON `filament_products` (`barcode`);--> statement-breakpoint
ALTER TABLE `filament_spools` ADD `barcode` text;