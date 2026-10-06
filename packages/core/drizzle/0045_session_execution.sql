CREATE TABLE session_operations (
 id text PRIMARY KEY NOT NULL, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 queue_position integer NOT NULL DEFAULT 0, command_id text NOT NULL, kind text NOT NULL, fingerprint text NOT NULL, payload text NOT NULL,
 status text NOT NULL, event_id integer, error text, created_at integer NOT NULL DEFAULT (unixepoch()), updated_at integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX session_operations_command ON session_operations(session_id, command_id);
--> statement-breakpoint
CREATE INDEX session_operations_pending ON session_operations(session_id, status);
--> statement-breakpoint
CREATE TABLE session_turn_attempts (
 id text PRIMARY KEY NOT NULL, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 operation_id text NOT NULL REFERENCES session_operations(id) ON DELETE CASCADE,
 runtime_id text, provider_id text NOT NULL, native_session_id text, status text NOT NULL,
 dispatched_at integer, started_at integer, ended_at integer, created_at integer NOT NULL DEFAULT (unixepoch()), updated_at integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX session_turn_attempts_session ON session_turn_attempts(session_id);
--> statement-breakpoint
CREATE TABLE session_runtime_bindings (
 id text PRIMARY KEY NOT NULL, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 provider_id text NOT NULL, native_session_id text, connection_state text NOT NULL,
 capabilities text NOT NULL DEFAULT '{}', created_at integer NOT NULL DEFAULT (unixepoch()), updated_at integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE session_event_changes (
 sequence integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, event_id integer NOT NULL,
 created_at integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX session_event_changes_cursor ON session_event_changes(session_id, sequence);
--> statement-breakpoint
INSERT INTO session_event_changes(session_id, event_id, created_at) SELECT session_id, id, created_at FROM session_events ORDER BY id;
