CREATE TABLE "dealer_reward_choice_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"dealer_code" text NOT NULL,
	"scheme_tag" text NOT NULL,
	"choice" text NOT NULL,
	"destination" text,
	"source" text NOT NULL,
	"chosen_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dealer_reward_choice" ADD COLUMN "destination" text;--> statement-breakpoint
ALTER TABLE "dealer_reward_choice" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "dealer_reward_choice" ADD COLUMN "chosen_by" text;--> statement-breakpoint
CREATE INDEX "dealer_reward_choice_log_dealer_idx" ON "dealer_reward_choice_log" USING btree ("dealer_code","scheme_tag");