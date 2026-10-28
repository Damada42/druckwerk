ALTER TABLE `projects` ADD `price_auto` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- Bestehende Projekte mit eingetragenem Preis behalten ihn (kein Automatikbetrieb)
UPDATE `projects` SET `price_auto` = false WHERE `price` IS NOT NULL;
