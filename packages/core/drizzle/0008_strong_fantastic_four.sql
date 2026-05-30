ALTER TABLE `drivers` RENAME TO `providers`;--> statement-breakpoint
ALTER TABLE `sessions` RENAME COLUMN "selected_driver" TO "selected_provider";