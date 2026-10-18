ALTER TABLE `ticket_app` ADD `icon_name` text DEFAULT 'i-lucide-app-window' NOT NULL;--> statement-breakpoint
ALTER TABLE `ticket_app` ADD `icon_color` text DEFAULT '#4B5563' NOT NULL;--> statement-breakpoint
ALTER TABLE `ticket_app` ADD `icon_light_type` text;--> statement-breakpoint
ALTER TABLE `ticket_app` ADD `icon_dark_type` text;--> statement-breakpoint
ALTER TABLE `ticket_app` ADD `icon_version` integer DEFAULT 0 NOT NULL;