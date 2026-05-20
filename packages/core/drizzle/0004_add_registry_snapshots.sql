CREATE TABLE `registry_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`data` text NOT NULL,
	`etag` text,
	`last_modified` text,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL
);
