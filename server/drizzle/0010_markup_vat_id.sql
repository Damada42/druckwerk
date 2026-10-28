ALTER TABLE `project_documents` ADD `show_vat_id` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `markup_percent` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `show_vat_id` integer DEFAULT true NOT NULL;