ALTER TABLE `session_events` ADD `client_message_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `session_events_client_message_idx` ON `session_events` (`session_id`,`client_message_id`);