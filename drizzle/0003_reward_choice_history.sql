-- Reward choice history (Mayur, 22-10-2026): one row per file upload, and on each log row who sent the change
-- (actor: admin user or API client_id) and the upload that made it. Existing log rows keep NULL in both columns.

CREATE TABLE "reward_choice_upload" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"changed" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"refused" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dealer_reward_choice_log" ADD COLUMN "actor" text;--> statement-breakpoint
ALTER TABLE "dealer_reward_choice_log" ADD COLUMN "upload_id" integer;--> statement-breakpoint
CREATE INDEX "reward_choice_upload_at_idx" ON "reward_choice_upload" USING btree ("uploaded_at");--> statement-breakpoint
ALTER TABLE "dealer_reward_choice_log" ADD CONSTRAINT "dealer_reward_choice_log_upload_id_reward_choice_upload_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."reward_choice_upload"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dealer_reward_choice_log_changed_idx" ON "dealer_reward_choice_log" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "dealer_reward_choice_log_upload_idx" ON "dealer_reward_choice_log" USING btree ("upload_id");