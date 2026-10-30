ALTER TABLE `code_review_findings` ADD `fingerprint` text;--> statement-breakpoint
ALTER TABLE `code_review_findings` ADD `continuity` text;--> statement-breakpoint
ALTER TABLE `code_reviews` ADD `captured_files` text;--> statement-breakpoint
ALTER TABLE `code_reviews` ADD `continuity` text;