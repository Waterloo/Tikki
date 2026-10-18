CREATE TABLE `outbox_event` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`ticket_number` integer,
	`internal` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `outbox_event_created_idx` ON `outbox_event` (`created_at`);--> statement-breakpoint
CREATE TABLE `webhook_delivery` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`endpoint_id` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_attempt_at` integer,
	`response_status` integer,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `outbox_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoint`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_delivery_event_endpoint_unique` ON `webhook_delivery` (`event_id`,`endpoint_id`);--> statement-breakpoint
CREATE INDEX `webhook_delivery_due_idx` ON `webhook_delivery` (`state`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `webhook_delivery_endpoint_idx` ON `webhook_delivery` (`endpoint_id`,`id`);--> statement-breakpoint
CREATE TABLE `webhook_endpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text DEFAULT 'admin' NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`events` text NOT NULL,
	`include_internal` integer DEFAULT false NOT NULL,
	`secret` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`failing_since` integer,
	`failures` integer DEFAULT 0 NOT NULL,
	`disabled_at` integer,
	`created_at` integer NOT NULL
);
