CREATE TABLE `manufacturers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manufacturers_name_unique` ON `manufacturers` (`name`);--> statement-breakpoint
ALTER TABLE `filament_spools` ADD `min_stock_g` real;--> statement-breakpoint
ALTER TABLE `filament_types` ADD `min_stock_g` real DEFAULT 200 NOT NULL;--> statement-breakpoint
-- Herstellerliste aus den bisherigen Spulen und gemerkten Sorten; gleiche Namen in anderer Schreibweise nur einmal
INSERT OR IGNORE INTO `manufacturers` (`name`)
SELECT min(`name`) FROM (
	SELECT trim(`manufacturer`) AS `name` FROM `filament_spools`
	UNION SELECT trim(`manufacturer`) FROM `filament_products`
) WHERE `name` <> '' GROUP BY lower(`name`) ORDER BY lower(`name`);
