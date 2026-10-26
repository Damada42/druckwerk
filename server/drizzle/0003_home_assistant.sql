CREATE TABLE `filament_bookings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`spool_id` integer NOT NULL,
	`printer_id` integer,
	`grams` real NOT NULL,
	`job_name` text,
	`job_key` text NOT NULL,
	`estimated` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`spool_id`) REFERENCES `filament_spools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filament_bookings_job_spool` ON `filament_bookings` (`job_key`,`spool_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `printers` ADD `ha_device_id` text;