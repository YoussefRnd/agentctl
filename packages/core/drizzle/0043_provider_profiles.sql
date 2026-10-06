ALTER TABLE providers ADD COLUMN registry_agent_id text;
--> statement-breakpoint
ALTER TABLE providers ADD COLUMN protocol text NOT NULL DEFAULT 'auto';
--> statement-breakpoint
ALTER TABLE providers ADD COLUMN default_model text;
--> statement-breakpoint
ALTER TABLE providers ADD COLUMN default_thinking_effort text;
--> statement-breakpoint
CREATE TABLE native_session_imports (
 project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 provider_id text NOT NULL,
 native_session_id text NOT NULL,
 completed integer NOT NULL DEFAULT 0,
 session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX native_session_import_identity ON native_session_imports(project_id, provider_id, native_session_id);
