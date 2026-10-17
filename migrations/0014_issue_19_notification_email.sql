CREATE TABLE `mail_status` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_error` text,
	`last_error_at` integer
);
--> statement-breakpoint
CREATE TABLE `notification_mail` (
	`notification_id` integer PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`notification_id`) REFERENCES `notification`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Older notices were never emailed and must not be sent now.
INSERT INTO `notification_mail` (`notification_id`, `at`) SELECT `id`, `created_at` FROM `notification`;
