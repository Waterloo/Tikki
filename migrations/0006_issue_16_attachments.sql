CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_number` integer,
	`uploader_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_number`) REFERENCES `ticket`(`number`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploader_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachment_ticket_idx` ON `attachment` (`ticket_number`);