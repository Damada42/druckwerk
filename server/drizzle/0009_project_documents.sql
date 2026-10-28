CREATE TABLE `project_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`number` text NOT NULL,
	`date` text NOT NULL,
	`service_date` text,
	`due_date` text,
	`recipient` text NOT NULL,
	`intro` text,
	`notes` text,
	`items` text NOT NULL,
	`small_business` integer NOT NULL,
	`vat_rate` real NOT NULL,
	`net` real NOT NULL,
	`vat` real NOT NULL,
	`gross` real NOT NULL,
	`file_path` text NOT NULL,
	`invoice_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_documents_number_unique` ON `project_documents` (`number`);