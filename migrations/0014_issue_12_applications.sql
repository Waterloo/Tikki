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
-- A User or an Application acts (audit_log, comment, attachment), and a ticket's Requester is a User or a Contact.
-- Dropping NOT NULL needs a table rebuild in SQLite. D1 ignores `PRAGMA foreign_keys`; deferring the checks to the
-- end of the migration lets the other tables keep their references to the rebuilt tables. `comment` and `ticket` have
-- rows in other tables that point to them: they are copied aside, dropped, and filled again under their own name,
-- because only an insert into the parent table clears the deferred violations that the drop counted.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_number` integer,
	`subject_type` text,
	`subject_id` text,
	`principal_id` text,
	`application_id` integer,
	`channel` text NOT NULL,
	`action` text NOT NULL,
	`field_key` text,
	`comment_id` text,
	`reverts_id` integer,
	`before` text,
	`after` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_number`) REFERENCES `ticket`(`number`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`principal_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`comment_id`) REFERENCES `comment`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_log_one_subject" CHECK((ticket_number IS NOT NULL AND subject_type IS NULL AND subject_id IS NULL)
    OR (ticket_number IS NULL AND subject_type IS NOT NULL AND subject_id IS NOT NULL)),
	CONSTRAINT "audit_log_one_principal" CHECK((principal_id IS NULL) <> (application_id IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_audit_log`("id", "ticket_number", "subject_type", "subject_id", "principal_id", "application_id", "channel", "action", "field_key", "comment_id", "reverts_id", "before", "after", "created_at") SELECT "id", "ticket_number", "subject_type", "subject_id", "principal_id", NULL, "channel", "action", "field_key", "comment_id", "reverts_id", "before", "after", "created_at" FROM `audit_log`;--> statement-breakpoint
-- Keep the AUTOINCREMENT counter, so no number is used twice (4.9), also when the newest rows were deleted.
DELETE FROM sqlite_sequence WHERE name = '__new_audit_log';--> statement-breakpoint
INSERT INTO sqlite_sequence (name, seq) SELECT '__new_audit_log', seq FROM sqlite_sequence WHERE name = 'audit_log';--> statement-breakpoint
DROP TABLE `audit_log`;--> statement-breakpoint
ALTER TABLE `__new_audit_log` RENAME TO `audit_log`;--> statement-breakpoint
CREATE INDEX `audit_log_ticket_idx` ON `audit_log` (`ticket_number`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_subject_idx` ON `audit_log` (`subject_type`,`subject_id`,`id`);--> statement-breakpoint
CREATE TABLE `__new_attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_number` integer,
	`uploader_id` text,
	`application_id` integer,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_number`) REFERENCES `ticket`(`number`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploader_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attachment_one_uploader" CHECK((uploader_id IS NULL) <> (application_id IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_attachment`("id", "ticket_number", "uploader_id", "application_id", "filename", "content_type", "size", "created_at") SELECT "id", "ticket_number", "uploader_id", NULL, "filename", "content_type", "size", "created_at" FROM `attachment`;--> statement-breakpoint
DROP TABLE `attachment`;--> statement-breakpoint
ALTER TABLE `__new_attachment` RENAME TO `attachment`;--> statement-breakpoint
CREATE INDEX `attachment_ticket_idx` ON `attachment` (`ticket_number`);--> statement-breakpoint
CREATE TABLE `__old_comment` AS SELECT * FROM `comment`;--> statement-breakpoint
DROP TABLE `comment`;--> statement-breakpoint
CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_number` integer NOT NULL,
	`author_id` text,
	`application_id` integer,
	`channel` text NOT NULL,
	`visibility` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_number`) REFERENCES `ticket`(`number`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "comment_one_author" CHECK((author_id IS NULL) <> (application_id IS NULL))
);
--> statement-breakpoint
INSERT INTO `comment`("id", "ticket_number", "author_id", "application_id", "channel", "visibility", "body", "created_at") SELECT "id", "ticket_number", "author_id", NULL, "channel", "visibility", "body", "created_at" FROM `__old_comment`;--> statement-breakpoint
DROP TABLE `__old_comment`;--> statement-breakpoint
CREATE INDEX `comment_ticket_idx` ON `comment` (`ticket_number`,`created_at`);--> statement-breakpoint
CREATE TABLE `__old_ticket` AS SELECT * FROM `ticket`;--> statement-breakpoint
-- DROP TABLE removes the AUTOINCREMENT counter. Keep it, so no Ticket Number is used twice (4.9), also after a delete.
CREATE TABLE `__old_ticket_seq` AS SELECT seq FROM sqlite_sequence WHERE name = 'ticket';--> statement-breakpoint
DROP TABLE `ticket`;--> statement-breakpoint
CREATE TABLE `ticket` (
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
	`reopened_from` integer,
	FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status`) REFERENCES `status`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reopened_from`) REFERENCES `ticket`(`number`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ticket_one_requester" CHECK((requester_id IS NULL) <> (contact_id IS NULL))
);
--> statement-breakpoint
INSERT INTO `ticket`("number", "ticket_type_id", "schema_version", "title", "description", "priority", "fields", "requester_id", "contact_id", "channel", "status", "assignee_id", "created_at", "updated_at", "reopened_from") SELECT "number", "ticket_type_id", "schema_version", "title", "description", "priority", "fields", "requester_id", NULL, "channel", "status", "assignee_id", "created_at", "updated_at", "reopened_from" FROM `__old_ticket`;--> statement-breakpoint
DELETE FROM sqlite_sequence WHERE name = 'ticket';--> statement-breakpoint
INSERT INTO sqlite_sequence (name, seq) SELECT 'ticket', seq FROM `__old_ticket_seq`;--> statement-breakpoint
DROP TABLE `__old_ticket_seq`;--> statement-breakpoint
DROP TABLE `__old_ticket`;--> statement-breakpoint
CREATE INDEX `ticket_requester_idx` ON `ticket` (`requester_id`);--> statement-breakpoint
CREATE INDEX `ticket_status_updated_idx` ON `ticket` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ticket_type_idx` ON `ticket` (`ticket_type_id`);--> statement-breakpoint
CREATE INDEX `ticket_assignee_idx` ON `ticket` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `ticket_contact_idx` ON `ticket` (`contact_id`);