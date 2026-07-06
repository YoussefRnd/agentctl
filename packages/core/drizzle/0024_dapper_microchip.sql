ALTER TABLE `mcp_servers` ADD `approval_policy` text DEFAULT 'always_prompt' NOT NULL;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `tool_permissions` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE mcp_servers SET approval_policy = 'auto_approve_all' WHERE auto_approve = 1;