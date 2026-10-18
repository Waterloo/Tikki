-- Issue 42: a scope for each Application permission, and the Application that acted in a notice. Plain ADDs, no table rebuild.
ALTER TABLE `application` ADD `ticket_scopes` text DEFAULT '{"read":"own","update":"own","comment":"own"}' NOT NULL;--> statement-breakpoint
ALTER TABLE `application` ADD `include_restricted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `notification` ADD `application_id` integer REFERENCES application(id);
