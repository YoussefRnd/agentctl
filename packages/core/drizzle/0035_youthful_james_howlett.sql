PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`branch` text NOT NULL,
	`worktree_path` text NOT NULL,
	`task_slug` text NOT NULL,
	`title` text DEFAULT 'new session' NOT NULL,
	`base_commit` text NOT NULL,
	`base_branch` text,
	`agent` text NOT NULL,
	`agent_session_id` text,
	`selected_provider` text NOT NULL,
	`selected_model` text DEFAULT 'default' NOT NULL,
	`selected_thinking_effort` text DEFAULT 'medium' NOT NULL,
	`mode` text DEFAULT 'local' NOT NULL,
	`approval_mode` text DEFAULT 'review' NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`context_limit` integer DEFAULT 0 NOT NULL,
	`estimated_cost` real DEFAULT 0 NOT NULL,
	`last_heartbeat` integer,
	`closed_at` integer,
	`available_commands` text DEFAULT '[]' NOT NULL,
	`plan` text DEFAULT '[]' NOT NULL,
	`session_config_options` text DEFAULT '[]' NOT NULL,
	`session_metrics` text DEFAULT '{}' NOT NULL,
	`agent_persona` text,
	`available_agent_personas` text DEFAULT '[]' NOT NULL,
	`last_activity_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sessions` (
	`id`, `project_id`, `branch`, `worktree_path`, `task_slug`, `title`, `base_commit`,
	`base_branch`, `agent`, `agent_session_id`, `selected_provider`, `selected_model`,
	`selected_thinking_effort`, `mode`, `approval_mode`, `status`, `total_tokens`,
	`context_limit`, `estimated_cost`, `last_heartbeat`, `closed_at`, `available_commands`,
	`plan`, `session_config_options`, `session_metrics`, `agent_persona`,
	`available_agent_personas`, `last_activity_at`, `created_at`, `updated_at`
)
SELECT
	s.`id`, s.`project_id`, s.`branch`, s.`worktree_path`, s.`task_slug`, s.`title`,
	s.`base_commit`, s.`base_branch`, s.`agent`, s.`agent_session_id`, s.`selected_provider`,
	s.`selected_model`, s.`selected_thinking_effort`, s.`mode`, s.`approval_mode`, s.`status`,
	s.`total_tokens`, s.`context_limit`, s.`estimated_cost`, s.`last_heartbeat`, s.`closed_at`,
	s.`available_commands`, s.`plan`, s.`session_config_options`, s.`session_metrics`,
	s.`agent_persona`, s.`available_agent_personas`,
	COALESCE(
		(SELECT MAX(e.`created_at`) FROM `session_events` e WHERE e.`session_id` = s.`id` AND e.`type` = 'text'),
		s.`created_at`
	),
	s.`created_at`, s.`updated_at`
FROM `sessions` s;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
