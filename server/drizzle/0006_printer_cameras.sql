CREATE TABLE `printer_cameras` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`printer_id` integer NOT NULL,
	`name` text NOT NULL,
	`ha_connection_id` integer,
	`entity_id` text,
	`stream_url` text,
	`snapshot_url` text,
	`rotation` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ha_connection_id`) REFERENCES `ha_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
