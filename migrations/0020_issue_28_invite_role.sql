CREATE TABLE `invite_team` (
	`invite_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	PRIMARY KEY(`invite_id`, `team_id`),
	FOREIGN KEY (`invite_id`) REFERENCES `invite`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `invite` ADD `role` text DEFAULT 'requester' NOT NULL;