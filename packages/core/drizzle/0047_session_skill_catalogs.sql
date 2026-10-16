CREATE TABLE `session_skill_catalogs` (
	`session_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`native_session_id` text NOT NULL,
	`catalog_hash` text,
	`compaction_id` text,
	PRIMARY KEY(`session_id`, `provider_id`, `native_session_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
