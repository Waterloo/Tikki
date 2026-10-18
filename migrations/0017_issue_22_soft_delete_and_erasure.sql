ALTER TABLE `attachment` ADD `erased_at` integer;--> statement-breakpoint
ALTER TABLE `contact` ADD `erased_at` integer;--> statement-breakpoint
ALTER TABLE `ticket` ADD `deleted_at` integer;