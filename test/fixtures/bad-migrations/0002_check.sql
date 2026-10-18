CREATE TABLE `__new_item` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT "name_set" CHECK(length("__new_item"."name") > 0)
);
