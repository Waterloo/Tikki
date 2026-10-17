CREATE TABLE `status` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `ticket` ADD `status` text REFERENCES status(key);--> statement-breakpoint
ALTER TABLE `ticket` ADD `assignee_id` text REFERENCES user(id);--> statement-breakpoint
-- DEFAULT 0 only lets SQLite add a NOT NULL column to a table with rows. The UPDATE below sets the real value, and the code always sets it.
ALTER TABLE `ticket` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Seed (4.10). A migration runs once for each database, so the rows never come back after a later change.
INSERT INTO `status` (`key`, `name`, `category`, `position`) VALUES
  ('open', 'Open', 'open', 1),
  ('in_progress', 'In progress', 'active', 2),
  ('waiting', 'Waiting on requester', 'waiting', 3),
  ('resolved', 'Resolved', 'done', 4),
  ('closed', 'Closed', 'done', 5);--> statement-breakpoint
UPDATE `ticket` SET `status` = 'open', `updated_at` = `created_at`;
