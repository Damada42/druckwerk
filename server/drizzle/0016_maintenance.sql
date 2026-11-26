CREATE TABLE `maintenance_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`printer_id` integer NOT NULL,
	`done_at` text NOT NULL,
	`printer_hours` real NOT NULL,
	`note` text,
	`items` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `maintenance_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`printer_id` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'replace' NOT NULL,
	`part_id` integer,
	`part_qty` integer DEFAULT 1 NOT NULL,
	`interval_hours` real,
	`interval_months` real,
	`warn_hours` real,
	`base_hours` real DEFAULT 0 NOT NULL,
	`last_done_at` text,
	`notified_level` text,
	`notes` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `spare_parts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `spare_parts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`manufacturer` text,
	`part_number` text,
	`shop_url` text,
	`price` real,
	`stock_qty` integer DEFAULT 0 NOT NULL,
	`min_stock` integer DEFAULT 0 NOT NULL,
	`storage_location_id` integer,
	`printer_model` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`storage_location_id`) REFERENCES `storage_locations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `printers` ADD `operating_hours` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `printers` ADD `operating_hours_at` text;