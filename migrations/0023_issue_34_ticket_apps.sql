CREATE TABLE `ticket_app` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`position` text NOT NULL,
	`ticket_type_ids` text,
	`sort_order` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
