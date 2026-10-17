CREATE INDEX `ticket_status_updated_idx` ON `ticket` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ticket_type_idx` ON `ticket` (`ticket_type_id`);--> statement-breakpoint
CREATE INDEX `ticket_assignee_idx` ON `ticket` (`assignee_id`);