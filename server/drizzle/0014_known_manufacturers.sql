-- Gängige Hersteller in die Liste aufnehmen (ohne Doppelte in anderer Schreibweise)
INSERT INTO `manufacturers` (`name`)
SELECT `name` FROM (
	SELECT 'Anycubic' AS `name` UNION ALL SELECT 'AzureFilm' UNION ALL SELECT 'Bambu Lab'
	UNION ALL SELECT 'ColorFabb' UNION ALL SELECT 'Creality' UNION ALL SELECT 'Das Filament'
	UNION ALL SELECT 'Devil Design' UNION ALL SELECT 'Elegoo' UNION ALL SELECT 'Eryone'
	UNION ALL SELECT 'eSun' UNION ALL SELECT 'EVO-tech' UNION ALL SELECT 'Extrudr'
	UNION ALL SELECT 'Fiberlogy' UNION ALL SELECT 'Fillamentum' UNION ALL SELECT 'Formfutura'
	UNION ALL SELECT 'Geeetech' UNION ALL SELECT 'Herz GmbH' UNION ALL SELECT 'Jayo'
	UNION ALL SELECT 'nobufil' UNION ALL SELECT 'Overture' UNION ALL SELECT 'Polymaker'
	UNION ALL SELECT 'Prusament' UNION ALL SELECT 'Rosa3D' UNION ALL SELECT 'Spectrum'
	UNION ALL SELECT 'Sunlu'
) AS `known`
WHERE NOT EXISTS (SELECT 1 FROM `manufacturers` m WHERE lower(m.`name`) = lower(`known`.`name`));
--> statement-breakpoint
-- Weitere Filamenttypen für bestehende Installationen (neue bekommen sie über seed.ts)
INSERT INTO `filament_types` (`name`, `description`)
SELECT `name`, `description` FROM (
	SELECT 'PCTG' AS `name`, 'Wie PETG, zäher und klarer' AS `description`
	UNION ALL SELECT 'PVB', 'Mit Isopropanol glättbar'
	UNION ALL SELECT 'PP', 'Polypropylen, leicht und chemikalienbeständig'
	UNION ALL SELECT 'TPE', 'Weich-elastisch, noch flexibler als TPU'
) AS `extra`
WHERE EXISTS (SELECT 1 FROM `filament_types`)
	AND NOT EXISTS (SELECT 1 FROM `filament_types` t WHERE lower(t.`name`) = lower(`extra`.`name`));
