-- Issue 39: "Show the page to Requesters". A plain ADD, no table rebuild.
ALTER TABLE `ticket_app` ADD `page_for_requesters` integer DEFAULT 0 NOT NULL;
