CREATE TABLE `printer_models` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manufacturer_id` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`manufacturer_id`) REFERENCES `manufacturers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `printer_models_manufacturer_name` ON `printer_models` (`manufacturer_id`,`name`);--> statement-breakpoint
CREATE TABLE `spare_part_models` (
	`part_id` integer NOT NULL,
	`model_id` integer NOT NULL,
	PRIMARY KEY(`part_id`, `model_id`),
	FOREIGN KEY (`part_id`) REFERENCES `spare_parts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `printer_models`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `maintenance_tasks` ADD `notified_at` text;--> statement-breakpoint
ALTER TABLE `printers` ADD `model_id` integer REFERENCES printer_models(id) ON DELETE set null;
--> statement-breakpoint
-- Hersteller der Modellliste ergänzen (ohne Doppelte in anderer Schreibweise)
INSERT INTO `manufacturers` (`name`)
SELECT `name` FROM (
	SELECT 'Bambu Lab' AS `name`
	UNION ALL SELECT 'Prusa'
	UNION ALL SELECT 'Anycubic'
	UNION ALL SELECT 'Geeetech'
	UNION ALL SELECT 'Creality'
	UNION ALL SELECT 'Elegoo'
	UNION ALL SELECT 'QIDI'
	UNION ALL SELECT 'Flashforge'
	UNION ALL SELECT 'Snapmaker'
	UNION ALL SELECT 'Sovol'
	UNION ALL SELECT 'AtomForm'
) AS `known`
WHERE NOT EXISTS (SELECT 1 FROM `manufacturers` m WHERE lower(m.`name`) = lower(`known`.`name`));
--> statement-breakpoint
-- Druckermodelle (Stand 11/2026)
INSERT INTO `printer_models` (`manufacturer_id`, `name`)
SELECT m.`id`, l.`model` FROM (
	SELECT 'Bambu Lab' AS `maker`, 'A1 mini' AS `model`
	UNION ALL SELECT 'Bambu Lab', 'A1'
	UNION ALL SELECT 'Bambu Lab', 'A2L'
	UNION ALL SELECT 'Bambu Lab', 'P1S'
	UNION ALL SELECT 'Bambu Lab', 'P2S'
	UNION ALL SELECT 'Bambu Lab', 'P3C'
	UNION ALL SELECT 'Bambu Lab', 'X2D'
	UNION ALL SELECT 'Bambu Lab', 'H2S'
	UNION ALL SELECT 'Bambu Lab', 'H2D'
	UNION ALL SELECT 'Bambu Lab', 'H2D Pro'
	UNION ALL SELECT 'Bambu Lab', 'H2C'
	UNION ALL SELECT 'Bambu Lab', 'H3C'
	UNION ALL SELECT 'Prusa', 'MK4S'
	UNION ALL SELECT 'Prusa', 'CORE One+ (Gen 2)'
	UNION ALL SELECT 'Prusa', 'CORE One L+'
	UNION ALL SELECT 'Prusa', 'XL+'
	UNION ALL SELECT 'Anycubic', 'Kobra 4'
	UNION ALL SELECT 'Anycubic', 'Kobra 4 Combo'
	UNION ALL SELECT 'Anycubic', 'Kobra X'
	UNION ALL SELECT 'Anycubic', 'Kobra X Combo'
	UNION ALL SELECT 'Anycubic', 'Kobra S1 ACE 2 Pro Combo'
	UNION ALL SELECT 'Anycubic', 'Kobra S1 Max'
	UNION ALL SELECT 'Anycubic', 'Kobra S1 Max Combo'
	UNION ALL SELECT 'Anycubic', 'Kobra 3 Max V2'
	UNION ALL SELECT 'Anycubic', 'Kobra 3 Max V2 Combo'
	UNION ALL SELECT 'Anycubic', 'Photon P1'
	UNION ALL SELECT 'Anycubic', 'Photon P1 Max'
	UNION ALL SELECT 'Anycubic', 'Photon Mono M7'
	UNION ALL SELECT 'Anycubic', 'Photon Mono M7 Pro'
	UNION ALL SELECT 'Anycubic', 'Photon Mono M7 Max'
	UNION ALL SELECT 'Anycubic', 'Photon Mono 4 Ultra'
	UNION ALL SELECT 'Geeetech', 'M1'
	UNION ALL SELECT 'Geeetech', 'Mizar M'
	UNION ALL SELECT 'Geeetech', 'Mizar S'
	UNION ALL SELECT 'Geeetech', 'Mizar Pro'
	UNION ALL SELECT 'Geeetech', 'Mizar Max'
	UNION ALL SELECT 'Geeetech', 'Thunder'
	UNION ALL SELECT 'Geeetech', 'A30 Pro'
	UNION ALL SELECT 'Creality', 'K3'
	UNION ALL SELECT 'Creality', 'K2 Plus'
	UNION ALL SELECT 'Creality', 'K2 Pro'
	UNION ALL SELECT 'Creality', 'K2'
	UNION ALL SELECT 'Creality', 'K2 SE'
	UNION ALL SELECT 'Creality', 'SPARKX i7'
	UNION ALL SELECT 'Creality', 'SPARKX i8'
	UNION ALL SELECT 'Creality', 'Hi'
	UNION ALL SELECT 'Creality', 'Ender-3 V4'
	UNION ALL SELECT 'Creality', 'Ender-3 V3 Mega'
	UNION ALL SELECT 'Creality', 'Ender-5 Max'
	UNION ALL SELECT 'Creality', 'K1C'
	UNION ALL SELECT 'Creality', 'K1 Max'
	UNION ALL SELECT 'Elegoo', 'Centauri Carbon 2'
	UNION ALL SELECT 'Elegoo', 'Centauri Carbon 2 Combo'
	UNION ALL SELECT 'Elegoo', 'Centauri 2'
	UNION ALL SELECT 'Elegoo', 'Centauri 2 Combo'
	UNION ALL SELECT 'Elegoo', 'OrangeStorm Giga'
	UNION ALL SELECT 'Elegoo', 'Jupiter 2'
	UNION ALL SELECT 'Elegoo', 'Saturn 4 Ultra 16K'
	UNION ALL SELECT 'QIDI', 'Q2C'
	UNION ALL SELECT 'QIDI', 'Q2'
	UNION ALL SELECT 'QIDI', 'Q1 Pro'
	UNION ALL SELECT 'QIDI', 'Plus4'
	UNION ALL SELECT 'QIDI', 'Plus5'
	UNION ALL SELECT 'QIDI', 'Max4'
	UNION ALL SELECT 'Flashforge', 'Creator 5'
	UNION ALL SELECT 'Flashforge', 'Creator 5 Pro'
	UNION ALL SELECT 'Flashforge', 'AD5X'
	UNION ALL SELECT 'Flashforge', 'Adventurer 5M'
	UNION ALL SELECT 'Flashforge', 'Adventurer 5M Pro'
	UNION ALL SELECT 'Flashforge', 'Guider 3 Ultra'
	UNION ALL SELECT 'Snapmaker', 'U1'
	UNION ALL SELECT 'Sovol', 'M1D'
	UNION ALL SELECT 'AtomForm', 'Palette 300'
) AS l
JOIN `manufacturers` m ON lower(m.`name`) = lower(l.`maker`);
--> statement-breakpoint
-- Bestehende Drucker ihrem Modell zuordnen („Bambu Lab P1S“ oder nur „P1S“)
UPDATE `printers` SET `model_id` = (
	SELECT pm.`id` FROM `printer_models` pm JOIN `manufacturers` m ON m.`id` = pm.`manufacturer_id`
	WHERE lower(trim(`printers`.`model`)) IN (lower(m.`name` || ' ' || pm.`name`), lower(pm.`name`))
	ORDER BY pm.`id` LIMIT 1
);
--> statement-breakpoint
-- Ersatzteile: „Passt für (Modell)“ in die Zuordnung übernehmen
INSERT OR IGNORE INTO `spare_part_models` (`part_id`, `model_id`)
SELECT sp.`id`, pm.`id` FROM `spare_parts` sp
JOIN `printer_models` pm JOIN `manufacturers` m ON m.`id` = pm.`manufacturer_id`
WHERE lower(trim(sp.`printer_model`)) IN (lower(m.`name` || ' ' || pm.`name`), lower(pm.`name`));
--> statement-breakpoint
-- Nicht zuordenbare Angaben bleiben als Notiz erhalten
UPDATE `spare_parts` SET `notes` = coalesce(`notes` || char(10), '') || 'Passt für: ' || trim(`printer_model`)
WHERE trim(coalesce(`printer_model`, '')) <> ''
	AND NOT EXISTS (SELECT 1 FROM `spare_part_models` spm WHERE spm.`part_id` = `spare_parts`.`id`);
