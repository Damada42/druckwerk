-- „Gleiche Spule nochmal anlegen“ hat die AMS-Zuordnung mitkopiert. Je Slot bleibt nur die
-- zuerst angelegte Spule zugeordnet.
UPDATE `filament_spools` SET `ha_tray_entity` = NULL
WHERE `ha_tray_entity` IS NOT NULL
  AND `id` > (
    SELECT min(s.`id`) FROM `filament_spools` s
    WHERE s.`ha_tray_entity` = `filament_spools`.`ha_tray_entity`
  );
