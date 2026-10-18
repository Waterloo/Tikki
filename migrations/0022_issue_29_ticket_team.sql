ALTER TABLE `ticket` ADD `team_id` integer REFERENCES team(id);--> statement-breakpoint
-- Every existing ticket starts in the Team of its type (4.13a).
UPDATE `ticket` SET `team_id` = (SELECT `team_id` FROM `ticket_type` WHERE `ticket_type`.`id` = `ticket`.`ticket_type_id`);--> statement-breakpoint
CREATE INDEX `ticket_team_idx` ON `ticket` (`team_id`);
