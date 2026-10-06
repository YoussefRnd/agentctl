ALTER TABLE sessions ADD COLUMN plan_artifacts text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE providers ADD COLUMN custom_models text NOT NULL DEFAULT '[]';
