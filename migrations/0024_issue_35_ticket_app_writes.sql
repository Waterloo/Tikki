ALTER TABLE `audit_log` ADD `ticket_app_id` integer;--> statement-breakpoint
ALTER TABLE `comment` ADD `ticket_app_id` integer;--> statement-breakpoint
ALTER TABLE `ticket_app` ADD `access` text DEFAULT 'read' NOT NULL;