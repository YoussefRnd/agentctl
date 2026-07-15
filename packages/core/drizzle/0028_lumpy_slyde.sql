PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`install_state` text DEFAULT 'not_installed' NOT NULL,
	`auth_state` text DEFAULT 'unknown' NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`distribution` text DEFAULT '{}' NOT NULL,
	`command` text NOT NULL,
	`launch_args` text DEFAULT '[]' NOT NULL,
	`launch_env` text DEFAULT '{}' NOT NULL,
	`config_options` text DEFAULT '[]' NOT NULL,
	`auth_methods` text DEFAULT '[]' NOT NULL,
	`version` text,
	`description` text,
	`icon` text,
	`custom_env` text DEFAULT '{}' NOT NULL,
	`supports_dynamic_model` integer DEFAULT false NOT NULL,
	`supports_dynamic_config` integer DEFAULT false NOT NULL,
	`supports_logout` integer DEFAULT false NOT NULL,
	`natively_loads_skills` integer DEFAULT false NOT NULL,
	`modes` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_providers`("id", "name", "install_state", "auth_state", "hidden", "distribution", "command", "launch_args", "launch_env", "config_options", "auth_methods", "version", "description", "icon", "custom_env", "supports_dynamic_model", "supports_dynamic_config", "supports_logout", "natively_loads_skills", "modes", "created_at", "updated_at") SELECT "id", "name", "install_state", "auth_state", "hidden", "distribution", "command", "launch_args", "launch_env", "config_options", "auth_methods", "version", "description", "icon", "custom_env", "supports_dynamic_model", "supports_dynamic_config", "supports_logout", "natively_loads_skills", "modes", "created_at", "updated_at" FROM `providers`;--> statement-breakpoint
DROP TABLE `providers`;--> statement-breakpoint
ALTER TABLE `__new_providers` RENAME TO `providers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;