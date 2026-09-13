ALTER TABLE `acp_events` RENAME TO `session_events`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`parent_event_id` integer,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_session_events`("id", "session_id", "parent_event_id", "type", "data", "metadata", "created_at") SELECT "id", "session_id", "parent_event_id", "type", "data", "metadata", "created_at" FROM `session_events`;--> statement-breakpoint
DROP TABLE `session_events`;--> statement-breakpoint
ALTER TABLE `__new_session_events` RENAME TO `session_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `session_events_session_id_idx` ON `session_events` (`session_id`);