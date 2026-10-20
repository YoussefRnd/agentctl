CREATE TABLE `session_event_change_counts` (
	`session_id` text PRIMARY KEY NOT NULL,
	`retained_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "session_event_change_counts_nonnegative" CHECK("session_event_change_counts"."retained_count" >= 0)
);
--> statement-breakpoint
-- Backfill once; hot writes never count or walk the retained journal.
INSERT INTO session_event_change_counts (session_id, retained_count)
SELECT session_id, count(*) FROM session_event_changes GROUP BY session_id;
--> statement-breakpoint
-- Counts follow every append/delete, including repository-independent writes and cascades.
-- Keep these custom triggers when rebuilding session_event_changes in future migrations.
CREATE TRIGGER session_event_changes_count_insert
AFTER INSERT ON session_event_changes
BEGIN
  INSERT INTO session_event_change_counts (session_id, retained_count)
  VALUES (NEW.session_id, 1)
  ON CONFLICT(session_id) DO UPDATE SET retained_count = retained_count + 1;
END;
--> statement-breakpoint
CREATE TRIGGER session_event_changes_count_delete
AFTER DELETE ON session_event_changes
BEGIN
  UPDATE session_event_change_counts SET retained_count = retained_count - 1
  WHERE session_id = OLD.session_id;
END;
