ALTER TABLE `providers` ADD `install_state` text DEFAULT 'not_installed' NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `auth_state` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `hidden` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE providers SET install_state = 'installed_local', auth_state = 'authenticated' WHERE status = 'ready';--> statement-breakpoint
UPDATE providers SET install_state = 'installed_local', auth_state = 'needs_auth' WHERE status = 'needs_auth';--> statement-breakpoint
UPDATE providers SET install_state = 'installed_local', auth_state = 'error' WHERE status = 'error';--> statement-breakpoint
UPDATE providers SET install_state = 'installed_local', auth_state = 'unknown' WHERE status = 'inactive';--> statement-breakpoint
UPDATE providers SET install_state = 'system_available', auth_state = 'unknown' WHERE status = 'not_found' AND (command = 'npx' OR command = 'uvx');--> statement-breakpoint
UPDATE providers SET install_state = 'not_installed', auth_state = 'unknown' WHERE status = 'not_found' AND command != 'npx' AND command != 'uvx';