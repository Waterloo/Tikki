CREATE TABLE `organization` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`subtitle` text DEFAULT '' NOT NULL,
	`logo` blob,
	`logo_version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Seed: the same values the app showed before settings existed. A migration runs once for each database.
INSERT INTO `organization` (`id`, `name`, `subtitle`) VALUES (1, 'Ticketing', 'Support desk');
