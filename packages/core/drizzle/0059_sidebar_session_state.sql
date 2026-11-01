ALTER TABLE `sessions` ADD `pinned_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_read_event_id` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE sessions SET last_read_event_id = coalesce((SELECT max(id) FROM session_events WHERE session_id = sessions.id), 0);
