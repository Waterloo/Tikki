CREATE TABLE `notification` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ticket_number` integer,
	`comment_id` text,
	`actor_id` text,
	`data` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_number`) REFERENCES `ticket`(`number`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`comment_id`) REFERENCES `comment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notification_user_read_idx` ON `notification` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notification_user_id_idx` ON `notification` (`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `notification_preference` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`enabled` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preference_user_key_unique` ON `notification_preference` (`user_id`,`key`);