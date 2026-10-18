CREATE TABLE `rate_counter` (
	`key` text NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`key`, `window`)
);
--> statement-breakpoint
ALTER TABLE `application` ADD `rate_limit` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `application` ADD `create_limit` integer DEFAULT 10 NOT NULL;