PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_number` integer,
	`subject_type` text,
	`subject_id` text,
	`principal_id` text NOT NULL,
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
	FOREIGN KEY (`comment_id`) REFERENCES `comment`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_log_one_subject" CHECK(("ticket_number" IS NOT NULL AND "subject_type" IS NULL AND "subject_id" IS NULL)
    OR ("ticket_number" IS NULL AND "subject_type" IS NOT NULL AND "subject_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_audit_log`("id", "ticket_number", "principal_id", "channel", "action", "field_key", "comment_id", "reverts_id", "before", "after", "created_at") SELECT "id", "ticket_number", "principal_id", "channel", "action", "field_key", "comment_id", "reverts_id", "before", "after", "created_at" FROM `audit_log`;--> statement-breakpoint
DROP TABLE `audit_log`;--> statement-breakpoint
ALTER TABLE `__new_audit_log` RENAME TO `audit_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `audit_log_ticket_idx` ON `audit_log` (`ticket_number`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_subject_idx` ON `audit_log` (`subject_type`,`subject_id`,`id`);