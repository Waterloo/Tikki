-- Issue 37: one URL for each placement. `url` goes to `sidebar_url` or `tab_url` by `position`. No table has a foreign key to `ticket_app`.
CREATE TABLE `__new_ticket_app` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sidebar_url` text,
	`tab_url` text,
	`page_url` text,
	`ticket_type_ids` text,
	`sort_order` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`access` text DEFAULT 'read' NOT NULL,
	CONSTRAINT "ticket_app_one_url" CHECK(sidebar_url IS NOT NULL OR tab_url IS NOT NULL OR page_url IS NOT NULL)
);
--> statement-breakpoint
-- `position` has no CHECK. Any value but 'tab' becomes the sidebar, so every row keeps one URL.
INSERT INTO `__new_ticket_app`("id", "name", "sidebar_url", "tab_url", "page_url", "ticket_type_ids", "sort_order", "enabled", "created_at", "access") SELECT "id", "name", CASE WHEN "position" = 'tab' THEN NULL ELSE "url" END, CASE WHEN "position" = 'tab' THEN "url" END, NULL, "ticket_type_ids", "sort_order", "enabled", "created_at", "access" FROM `ticket_app`;--> statement-breakpoint
-- Keep the AUTOINCREMENT counter, so the id of a deleted app (in the audit log) is never used again.
DELETE FROM sqlite_sequence WHERE name = '__new_ticket_app';--> statement-breakpoint
INSERT INTO sqlite_sequence (name, seq) SELECT '__new_ticket_app', seq FROM sqlite_sequence WHERE name = 'ticket_app';--> statement-breakpoint
DROP TABLE `ticket_app`;--> statement-breakpoint
ALTER TABLE `__new_ticket_app` RENAME TO `ticket_app`;
