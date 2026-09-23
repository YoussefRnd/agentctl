ALTER TABLE `providers` ADD `install_stage` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `install_source` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `installed_version` text;--> statement-breakpoint
UPDATE `providers`
SET `install_source` = CASE
	WHEN `install_state` = 'installed_local' THEN 'managed'
	WHEN `command` = 'npx' THEN 'npx'
	WHEN `command` = 'uvx' THEN 'uvx'
	WHEN `install_state` = 'system_available' THEN 'system'
	ELSE NULL
END;--> statement-breakpoint
UPDATE `providers`
SET `installed_version` = `version`
WHERE `install_state` = 'installed_local' OR `command` IN ('npx', 'uvx');
