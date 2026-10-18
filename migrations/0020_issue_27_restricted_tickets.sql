CREATE TABLE `ticket_participant` (
	`ticket_number` integer NOT NULL,
	`user_id` text NOT NULL,
	`added_by` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`ticket_number`, `user_id`),
	FOREIGN KEY (`ticket_number`) REFERENCES `ticket`(`number`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ticket_participant_user_idx` ON `ticket_participant` (`user_id`);--> statement-breakpoint
ALTER TABLE `ticket_type` ADD `visibility` text DEFAULT 'requester' NOT NULL;--> statement-breakpoint
-- Hand-written: keep each type's visibility. true was "visible to all internal Users".
UPDATE `ticket_type` SET `visibility` = CASE WHEN `visible_to_all` THEN 'internal' ELSE 'requester' END;--> statement-breakpoint
ALTER TABLE `ticket_type` DROP COLUMN `visible_to_all`;