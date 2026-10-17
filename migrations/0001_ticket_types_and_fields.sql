CREATE TABLE `schema_version` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_type_id` integer NOT NULL,
	`version` integer NOT NULL,
	`fields` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_type`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schema_version_type_version_unique` ON `schema_version` (`ticket_type_id`,`version`);--> statement-breakpoint
CREATE TABLE `team` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_name_unique` ON `team` (`name`);--> statement-breakpoint
ALTER TABLE `ticket` ADD `schema_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `ticket` ADD `priority` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `ticket` ADD `fields` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `ticket_type` ADD `icon` text DEFAULT 'i-lucide-ticket' NOT NULL;--> statement-breakpoint
ALTER TABLE `ticket_type` ADD `color` text DEFAULT '#4B5563' NOT NULL;--> statement-breakpoint
ALTER TABLE `ticket_type` ADD `team_id` integer REFERENCES team(id);--> statement-breakpoint
ALTER TABLE `ticket_type` ADD `visible_to_all` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Seed (13.4). A migration runs once for each database, so the seed never comes back after an Admin edits or archives these.
INSERT INTO `team` (`name`, `created_at`) VALUES ('Support', cast(unixepoch('subsecond') * 1000 as integer));--> statement-breakpoint
UPDATE `ticket_type` SET `description` = 'Something is broken or gives an error.', `icon` = 'i-lucide-bug', `color` = '#C2362F', `team_id` = (SELECT `id` FROM `team` WHERE `name` = 'Support') WHERE `prefix` = 'BUG';--> statement-breakpoint
INSERT INTO `ticket_type` (`name`, `prefix`, `description`, `icon`, `color`, `team_id`, `created_at`) VALUES
  ('Data request', 'DATA', 'You need a report, an extract or access.', 'i-lucide-database', '#0E7377', (SELECT `id` FROM `team` WHERE `name` = 'Support'), cast(unixepoch('subsecond') * 1000 as integer)),
  ('General request', 'GEN', 'Anything else the team can help with.', 'i-lucide-life-buoy', '#4B5563', (SELECT `id` FROM `team` WHERE `name` = 'Support'), cast(unixepoch('subsecond') * 1000 as integer));--> statement-breakpoint
INSERT INTO `schema_version` (`ticket_type_id`, `version`, `fields`, `created_at`) SELECT `id`, 1, '[{"key":"page_or_feature","label":"Page or feature","type":"short_text","required":true,"help":"Where you saw the problem, for example: Reports."},{"key":"steps_to_reproduce","label":"Steps to reproduce","type":"long_text","required":false,"help":"What you did, what happened, and what you expected."},{"key":"frequency","label":"How often does it happen?","type":"single_select","required":false,"help":"Choose the closest answer.","options":[{"value":"Every time"},{"value":"Sometimes"},{"value":"Once"}]}]', cast(unixepoch('subsecond') * 1000 as integer) FROM `ticket_type` WHERE `prefix` = 'BUG';--> statement-breakpoint
INSERT INTO `schema_version` (`ticket_type_id`, `version`, `fields`, `created_at`) SELECT `id`, 1, '[{"key":"dataset","label":"Dataset or report","type":"short_text","required":true,"help":"For example: churn by region."},{"key":"needed_by","label":"Needed by","type":"date","required":false,"help":"The last date on which the data is useful to you."},{"key":"purpose","label":"What will you use it for?","type":"long_text","required":false,"help":"This helps the team choose the correct source."}]', cast(unixepoch('subsecond') * 1000 as integer) FROM `ticket_type` WHERE `prefix` = 'DATA';--> statement-breakpoint
INSERT INTO `schema_version` (`ticket_type_id`, `version`, `fields`, `created_at`) SELECT `id`, 1, '[{"key":"related_link","label":"Related link","type":"url","required":false,"help":"A page or document about the request, if there is one."},{"key":"needed_by","label":"Needed by","type":"date","required":false,"help":"Keep it empty if there is no deadline."}]', cast(unixepoch('subsecond') * 1000 as integer) FROM `ticket_type` WHERE `prefix` = 'GEN';
