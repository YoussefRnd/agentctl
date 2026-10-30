CREATE TABLE `review_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`command_redacted` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`timeout_ms` integer NOT NULL,
	`cwd` text NOT NULL,
	`expected_revision` text NOT NULL,
	`checked_revision` text,
	`after_revision` text,
	`revision_state` text DEFAULT 'unknown' NOT NULL,
	`exit_code` integer,
	`signal` text,
	`error` text,
	`stdout` text DEFAULT '' NOT NULL,
	`stderr` text DEFAULT '' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`output_truncated` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `code_reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_checks_review_idx` ON `review_checks` (`review_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `review_finding_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`finding_id` text NOT NULL,
	`check_id` text,
	`state` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`finding_id`) REFERENCES `code_review_findings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`check_id`) REFERENCES `review_checks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `review_finding_evidence_finding_idx` ON `review_finding_evidence` (`finding_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `code_reviews` ADD `evidence_check_ids` text;