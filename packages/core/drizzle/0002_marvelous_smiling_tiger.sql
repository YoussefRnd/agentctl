ALTER TABLE `projects` ADD `repo_root` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `subdir` text DEFAULT '' NOT NULL;