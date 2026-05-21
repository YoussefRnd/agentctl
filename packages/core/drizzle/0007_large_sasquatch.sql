PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`branch` text NOT NULL,
	`worktree_path` text NOT NULL,
	`task_slug` text NOT NULL,
	`title` text DEFAULT 'new session' NOT NULL,
	`base_commit` text NOT NULL,
	`agent` text NOT NULL,
	`agent_session_id` text,
	`selected_driver` text DEFAULT 'claude-acp' NOT NULL,
	`selected_model` text DEFAULT 'sonnet-4' NOT NULL,
	`selected_thinking_effort` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`context_limit` integer DEFAULT 128000 NOT NULL,
	`estimated_cost` real DEFAULT 0 NOT NULL,
	`last_heartbeat` integer,
	`closed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "project_id", "branch", "worktree_path", "task_slug", "title", "base_commit", "agent", "agent_session_id", "selected_driver", "selected_model", "selected_thinking_effort", "status", "total_tokens", "context_limit", "estimated_cost", "last_heartbeat", "closed_at", "created_at", "updated_at") SELECT "id", "project_id", "branch", "worktree_path", "task_slug", "title", "base_commit", CASE WHEN "agent" = 'claude-code' THEN 'claude-acp' ELSE "agent" END, "agent_session_id", CASE WHEN "selected_driver" = 'claude-code' THEN 'claude-acp' ELSE "selected_driver" END, "selected_model", "selected_thinking_effort", "status", "total_tokens", "context_limit", "estimated_cost", "last_heartbeat", "closed_at", "created_at", "updated_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `drivers` ADD `supports_dynamic_model` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `drivers` ADD `supports_dynamic_config` integer DEFAULT false NOT NULL;