-- Automatic setup at server start (Mayur, 26-10-2026): src/server/db-setup.ts stores the hash of the last seed and
-- the build of the last startup engine run here, so that it seeds and runs the engine only after a change.

CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
