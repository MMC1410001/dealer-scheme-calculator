CREATE TABLE "dealer" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text,
	"zone" text,
	"region_code" text,
	"region_name" text,
	"territory_name" text,
	"depot_code" text,
	"parent_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dealer_metric" (
	"dealer_code" text NOT NULL,
	"scheme_tag" text NOT NULL,
	"metric" text NOT NULL,
	"month" text NOT NULL,
	"value" numeric(18, 3) NOT NULL,
	"sync_run_id" integer,
	CONSTRAINT "dealer_metric_dealer_code_scheme_tag_metric_month_pk" PRIMARY KEY("dealer_code","scheme_tag","metric","month")
);
--> statement-breakpoint
CREATE TABLE "dealer_od_status" (
	"dealer_code" text NOT NULL,
	"as_of_date" date NOT NULL,
	"has_od" boolean NOT NULL,
	"od_amount" numeric(16, 2),
	"source" text,
	CONSTRAINT "dealer_od_status_dealer_code_as_of_date_pk" PRIMARY KEY("dealer_code","as_of_date")
);
--> statement-breakpoint
CREATE TABLE "dealer_reward_choice" (
	"dealer_code" text NOT NULL,
	"scheme_tag" text NOT NULL,
	"choice" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealer_reward_choice_dealer_code_scheme_tag_pk" PRIMARY KEY("dealer_code","scheme_tag")
);
--> statement-breakpoint
CREATE TABLE "dealer_scheme_enrolment" (
	"dealer_code" text PRIMARY KEY NOT NULL,
	"scheme_tag" text NOT NULL,
	"source" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dealer_scheme_result" (
	"dealer_code" text NOT NULL,
	"scheme_tag" text NOT NULL,
	"participation" text NOT NULL,
	"reason_code" text,
	"current_slab_no" integer,
	"benefit_blocked" boolean DEFAULT false NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"status" jsonb NOT NULL,
	"sync_run_id" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealer_scheme_result_dealer_code_scheme_tag_pk" PRIMARY KEY("dealer_code","scheme_tag")
);
--> statement-breakpoint
CREATE TABLE "sp_product_category" (
	"scheme_tag" text NOT NULL,
	"product_code" text NOT NULL,
	"product_name" text NOT NULL,
	"product_category" text,
	"brand" text,
	"star_category" text NOT NULL,
	"channel12_eligible" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sp_product_category_scheme_tag_product_code_pk" PRIMARY KEY("scheme_tag","product_code")
);
--> statement-breakpoint
CREATE TABLE "scheme" (
	"tag" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"circular_ref" text,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"base_from_date" date NOT NULL,
	"base_to_date" date NOT NULL,
	"od_check_date" date NOT NULL,
	"final_on" date NOT NULL,
	"exclusivity_group" text NOT NULL,
	"config" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheme_scope_rule" (
	"id" serial PRIMARY KEY NOT NULL,
	"scheme_tag" text NOT NULL,
	"rule_type" text NOT NULL,
	"channel" text,
	"zone" text,
	"region" text,
	"area" text,
	"depot" text,
	"product_code" text,
	"sku_code" text,
	"product_category" text,
	"product_group" text,
	"applies_to" text DEFAULT 'QUALIFICATION_AND_BENEFIT' NOT NULL,
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "scheme_slab" (
	"scheme_tag" text NOT NULL,
	"slab_no" integer NOT NULL,
	"label" text NOT NULL,
	"period_gsr_required" numeric(16, 2),
	"min_first_month_gsr" numeric(16, 2),
	"growth_pct" numeric(6, 2),
	"points_required" numeric(16, 2),
	"gift_description" text NOT NULL,
	"gift_value" numeric(16, 2),
	"cn_alternative" numeric(16, 2) NOT NULL,
	CONSTRAINT "scheme_slab_scheme_tag_slab_no_pk" PRIMARY KEY("scheme_tag","slab_no")
);
--> statement-breakpoint
CREATE TABLE "sync_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"data_as_of" timestamp with time zone,
	"row_count" integer,
	"bytes_processed" numeric(20, 0),
	"message" text
);
--> statement-breakpoint
ALTER TABLE "sp_product_category" ADD CONSTRAINT "sp_product_category_scheme_tag_scheme_tag_fk" FOREIGN KEY ("scheme_tag") REFERENCES "public"."scheme"("tag") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_scope_rule" ADD CONSTRAINT "scheme_scope_rule_scheme_tag_scheme_tag_fk" FOREIGN KEY ("scheme_tag") REFERENCES "public"."scheme"("tag") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_slab" ADD CONSTRAINT "scheme_slab_scheme_tag_scheme_tag_fk" FOREIGN KEY ("scheme_tag") REFERENCES "public"."scheme"("tag") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dealer_metric_scheme_idx" ON "dealer_metric" USING btree ("scheme_tag");--> statement-breakpoint
CREATE INDEX "dealer_scheme_result_scheme_idx" ON "dealer_scheme_result" USING btree ("scheme_tag","current_slab_no");--> statement-breakpoint
CREATE INDEX "scheme_scope_rule_tag_idx" ON "scheme_scope_rule" USING btree ("scheme_tag");