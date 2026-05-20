CREATE TABLE `drivers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'not_found' NOT NULL,
	`command` text NOT NULL,
	`launch_args` text DEFAULT '[]' NOT NULL,
	`launch_env` text DEFAULT '{}' NOT NULL,
	`config_options` text DEFAULT '[]' NOT NULL,
	`auth_methods` text DEFAULT '[]' NOT NULL,
	`version` text,
	`description` text,
	`icon` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
