ALTER TABLE `sessions` ADD `title` text DEFAULT 'new session' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `selected_driver` text DEFAULT 'claude-code' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `selected_model` text DEFAULT 'sonnet-4' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `selected_thinking_effort` text DEFAULT 'medium' NOT NULL;