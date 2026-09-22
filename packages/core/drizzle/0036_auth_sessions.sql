CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`client_label` text NOT NULL,
	`ip` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_active_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_at_idx` ON `auth_sessions` (`expires_at`);