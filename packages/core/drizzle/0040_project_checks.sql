CREATE TABLE `check_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`check_id` text NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`status` text NOT NULL,
	`output` text DEFAULT '' NOT NULL,
	`exit_code` integer,
	`fingerprint` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`output_truncated` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `check_runs_session_id_idx` ON `check_runs` (`session_id`);--> statement-breakpoint
CREATE TABLE `project_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`timeout_ms` integer DEFAULT 300000 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_checks_project_id_idx` ON `project_checks` (`project_id`);