CREATE TABLE `part_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`position` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `part_categories_key_unique` ON `part_categories` (`key`);--> statement-breakpoint
ALTER TABLE `spare_parts` ADD `category_id` integer REFERENCES part_categories(id) ON DELETE set null;--> statement-breakpoint
INSERT INTO `part_categories` (`key`, `name`, `position`) VALUES
  ('hotend', 'Hotend', 1),
  ('nozzle', 'Düsen', 2),
  ('extruder', 'Extruder', 3),
  ('feed', 'Filamentführung', 4),
  ('ams', 'AMS / MMU', 5),
  ('bed', 'Druckbett', 6),
  ('axes', 'Achsen & Führungen', 7),
  ('drive', 'Antrieb & Motoren', 8),
  ('cooling', 'Kühlung', 9),
  ('electronics', 'Elektronik', 10),
  ('control', 'Steuerung', 11),
  ('enclosure', 'Gehäuse', 12),
  ('consumables', 'Wartung & Verbrauchsmaterial', 13),
  ('other', 'Sonstiges', 14);
--> statement-breakpoint
UPDATE `spare_parts` SET `category_id` = (
  SELECT `id` FROM `part_categories` WHERE `key` = CASE
    WHEN (' ' || lower(`spare_parts`.`name`)) LIKE '%wischer%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%wiper%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%fett%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%grease%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%schmier%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%lube%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%kleber%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%glue%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%reinigung%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%schraube%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%screw%' THEN 'consumables'
    WHEN (' ' || lower(`spare_parts`.`name`)) LIKE '% ams%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '% mmu%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%happy hare%' THEN 'ams'
    WHEN (' ' || lower(`spare_parts`.`name`)) LIKE '%bett%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '% bed%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%platte%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%build plate%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%plate%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%pei%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%magnetfolie%' THEN 'bed'
    WHEN (' ' || lower(`spare_parts`.`name`)) LIKE '%düse%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%nozzle%' THEN 'nozzle'
    WHEN (' ' || lower(`spare_parts`.`name`)) LIKE '%hotend%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%hot end%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%heizblock%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%heater%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%heizpatrone%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%thermistor%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%silikon%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%silicone%' THEN 'hotend'
    WHEN (' ' || lower(`spare_parts`.`name`)) LIKE '%extruder%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%cutter%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%schneid%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%zahnrad%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%gear%' THEN 'extruder'
    WHEN (' ' || lower(`spare_parts`.`name`)) LIKE '%ptfe%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%bowden%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%schlauch%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%tube%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%kupplung%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%coupler%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%puffer%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%buffer%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%spulenhalter%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%spool holder%' THEN 'feed'
    WHEN (' ' || lower(`spare_parts`.`name`)) LIKE '%lüfter%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '% fan%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%kühl%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%cooling%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%heatsink%' THEN 'cooling'
    WHEN (' ' || lower(`spare_parts`.`name`)) LIKE '%riemen%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%belt%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%motor%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%spindel%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%lead screw%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%pulley%' THEN 'drive'
    WHEN (' ' || lower(`spare_parts`.`name`)) LIKE '%stange%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '% rod%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%linear%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%schiene%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%rail%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%lager%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%bearing%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%achse%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%welle%' THEN 'axes'
    WHEN (' ' || lower(`spare_parts`.`name`)) LIKE '%mainboard%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%board%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%display%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%screen%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%platine%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%touch%' THEN 'control'
    WHEN (' ' || lower(`spare_parts`.`name`)) LIKE '%netzteil%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%kabel%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%cable%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%sensor%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%kamera%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%camera%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '% led%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%licht%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%power supply%' THEN 'electronics'
    WHEN (' ' || lower(`spare_parts`.`name`)) LIKE '%gehäuse%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%tür%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%door%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%deckel%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '% lid%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%aktivkohle%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%carbon filter%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%dichtung%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%scharnier%' OR (' ' || lower(`spare_parts`.`name`)) LIKE '%glas%' THEN 'enclosure'
    ELSE 'other'
  END
);
