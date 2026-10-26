CREATE TABLE `ha_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`token` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `ha_connections` (`name`, `url`, `token`)
SELECT 'Zuhause', u.`value`, t.`value` FROM `settings` u, `settings` t
WHERE u.`key` = 'ha.url' AND t.`key` = 'ha.token';
--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('ha.url', 'ha.token');
