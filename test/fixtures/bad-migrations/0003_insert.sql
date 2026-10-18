CREATE TABLE `item_copy` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `item_copy`(`id`, `name`) SELECT `id`, `missing_col` FROM `item`;
