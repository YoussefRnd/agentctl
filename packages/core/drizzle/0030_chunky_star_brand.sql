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
	`selected_model` text DEFAULT 'sonnet-4' NOT NULL,
	`selected_thinking_effort` text DEFAULT 'medium' NOT NULL,
	`mode` text DEFAULT 'local' NOT NULL,
	`approval_mode` text DEFAULT 'review' NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`context_limit` integer DEFAULT 128000 NOT NULL,
	`estimated_cost` real DEFAULT 0 NOT NULL,
	`last_heartbeat` integer,
	`closed_at` integer,
	`available_commands` text DEFAULT '[]' NOT NULL,
	`plan` text DEFAULT '[]' NOT NULL,
	`session_config_options` text DEFAULT '[]' NOT NULL,
	`session_metrics` text DEFAULT '{}' NOT NULL,
	`agent_persona` text,
	`available_agent_personas` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "project_id", "branch", "worktree_path", "task_slug", "title", "base_commit", "base_branch", "agent", "agent_session_id", "selected_provider", "selected_model", "selected_thinking_effort", "mode", "approval_mode", "status", "total_tokens", "context_limit", "estimated_cost", "last_heartbeat", "closed_at", "available_commands", "plan", "session_config_options", "session_metrics", "agent_persona", "available_agent_personas", "created_at", "updated_at") SELECT "id", "project_id", "branch", "worktree_path", "task_slug", "title", "base_commit", "base_branch", "agent", "agent_session_id", "selected_provider", "selected_model", "selected_thinking_effort", "mode", "approval_mode", "status", "total_tokens", "context_limit", "estimated_cost", "last_heartbeat", "closed_at", "available_commands", "plan", "session_config_options", "session_metrics", "agent_persona", "available_agent_personas", "created_at", "updated_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `providers` ADD `install_error` text;