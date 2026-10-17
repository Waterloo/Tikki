CREATE TABLE `ticket_type_old_prefix` (
	`prefix` text PRIMARY KEY NOT NULL,
	`ticket_type_id` integer NOT NULL,
	`replaced_at` integer NOT NULL,
	FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_type`(`id`) ON UPDATE no action ON DELETE no action
);
