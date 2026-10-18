ALTER TABLE `webhook_delivery` ADD `payload` text;--> statement-breakpoint
-- An Application endpoint (owner = 'application') needs a CHECK across two columns, so webhook_endpoint is rebuilt.
-- D1 ignores `PRAGMA foreign_keys`; webhook_delivery rows point to the endpoints. The rows are copied aside, the table
-- is dropped and made again under its own name, and the insert into it clears the violations that the drop counted.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__old_webhook_endpoint` AS SELECT * FROM `webhook_endpoint`;--> statement-breakpoint
DROP TABLE `webhook_endpoint`;--> statement-breakpoint
CREATE TABLE `webhook_endpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text DEFAULT 'admin' NOT NULL,
	`application_id` integer,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`events` text NOT NULL,
	`include_internal` integer DEFAULT false NOT NULL,
	`secret` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`failing_since` integer,
	`failures` integer DEFAULT 0 NOT NULL,
	`disabled_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "webhook_endpoint_owner_application" CHECK((owner = 'application') = (application_id IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `webhook_endpoint`("id", "owner", "name", "url", "events", "include_internal", "secret", "enabled", "failing_since", "failures", "disabled_at", "created_at") SELECT "id", "owner", "name", "url", "events", "include_internal", "secret", "enabled", "failing_since", "failures", "disabled_at", "created_at" FROM `__old_webhook_endpoint`;--> statement-breakpoint
DROP TABLE `__old_webhook_endpoint`;--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_endpoint_application_unique` ON `webhook_endpoint` (`application_id`);
