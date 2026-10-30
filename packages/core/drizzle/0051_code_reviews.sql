CREATE TABLE `code_review_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`severity` text NOT NULL,
	`path` text NOT NULL,
	`line` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text,
	FOREIGN KEY (`review_id`) REFERENCES `code_reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `code_review_findings_review_idx` ON `code_review_findings` (`review_id`);--> statement-breakpoint
CREATE TABLE `code_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`scope` text NOT NULL,
	`from_revision` text NOT NULL,
	`to_revision` text NOT NULL,
	`status` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `code_reviews_session_idx` ON `code_reviews` (`session_id`,`started_at`);