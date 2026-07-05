ALTER TABLE `providers` ADD `modes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `agent_persona` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `available_agent_personas` text DEFAULT '[]' NOT NULL;