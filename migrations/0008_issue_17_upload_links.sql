CREATE TABLE `upload_link` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`ticket_number` integer NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_number`) REFERENCES `ticket`(`number`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
