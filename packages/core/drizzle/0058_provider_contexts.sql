CREATE TABLE `session_provider_contexts` (
	`session_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`native_session_id` text NOT NULL,
	`through_sequence` integer DEFAULT 0 NOT NULL,
	`used_tokens` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	PRIMARY KEY(`session_id`, `provider_id`, `native_session_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
