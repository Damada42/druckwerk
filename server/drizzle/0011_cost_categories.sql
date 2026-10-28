CREATE TABLE `cost_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`unit` text DEFAULT 'Stück' NOT NULL,
	`default_price` real,
	`position` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cost_categories_key_unique` ON `cost_categories` (`key`);--> statement-breakpoint
ALTER TABLE `project_costs` ADD `unit` text DEFAULT 'Stück' NOT NULL;--> statement-breakpoint
INSERT INTO `cost_categories` (`key`, `name`, `unit`, `position`) VALUES
  ('electronics', 'Elektronik', 'Stück', 1),
  ('wood', 'Holz', 'Stück', 2),
  ('metal', 'Metall', 'Stück', 3),
  ('led', 'LEDs', 'Stück', 4),
  ('hardware', 'Schrauben & Kleinteile', 'Packung', 5),
  ('other', 'Sonstiges', 'Stück', 6);
