ALTER TABLE `acp_events` ADD `parent_event_id` integer REFERENCES acp_events(id);--> statement-breakpoint
ALTER TABLE `acp_events` ADD `metadata` text;