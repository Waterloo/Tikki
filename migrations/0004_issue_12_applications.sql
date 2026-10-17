CREATE TABLE `api_key` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_key_key_hash_unique` ON `api_key` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_key_application_idx` ON `api_key` (`application_id`);--> statement-breakpoint
CREATE TABLE `application` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`ticket_type_ids` text DEFAULT '[]' NOT NULL,
	`disabled_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_name_unique` ON `application` (`name`);--> statement-breakpoint
CREATE TABLE `contact` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_application_external_unique` ON `contact` (`application_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `idempotency_key` (
	`application_id` integer NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`ticket_number` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`application_id`, `key`),
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_number`) REFERENCES `ticket`(`number`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idempotency_key_created_idx` ON `idempotency_key` (`application_id`,`created_at`);--> statement-breakpoint
-- The Requester becomes a User or a Contact, so `requester_id` loses NOT NULL. SQLite needs a table rebuild for that.
-- D1 ignores `PRAGMA foreign_keys`; deferring the checks to the end of the migration lets other tables keep their references to `ticket`.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_ticket` (
	`number` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_type_id` integer NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	`requester_id` text,
	`contact_id` integer,
	`channel` text NOT NULL,
	`status` text,
	`assignee_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status`) REFERENCES `status`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ticket_one_requester" CHECK((requester_id IS NULL) <> (contact_id IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_ticket`("number", "ticket_type_id", "schema_version", "title", "description", "priority", "fields", "requester_id", "contact_id", "channel", "status", "assignee_id", "created_at", "updated_at") SELECT "number", "ticket_type_id", "schema_version", "title", "description", "priority", "fields", "requester_id", NULL, "channel", "status", "assignee_id", "created_at", "updated_at" FROM `ticket`;--> statement-breakpoint
-- Keep the global counter, so no Ticket Number is used twice (4.9).
UPDATE sqlite_sequence SET seq = (SELECT seq FROM sqlite_sequence WHERE name = 'ticket') WHERE name = '__new_ticket' AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'ticket');--> statement-breakpoint
DROP TABLE `ticket`;--> statement-breakpoint
ALTER TABLE `__new_ticket` RENAME TO `ticket`;--> statement-breakpoint
CREATE INDEX `ticket_requester_idx` ON `ticket` (`requester_id`);--> statement-breakpoint
CREATE INDEX `ticket_contact_idx` ON `ticket` (`contact_id`);