CREATE TABLE `review_fix_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`finding_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`prompt` text NOT NULL,
	`request_revision` text NOT NULL,
	`before_check_id` text,
	`runs` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`finding_id`) REFERENCES `code_review_findings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`before_check_id`) REFERENCES `review_checks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `review_fix_attempts_finding_idx` ON `review_fix_attempts` (`finding_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `code_reviews` ADD `purpose` text DEFAULT 'review' NOT NULL;