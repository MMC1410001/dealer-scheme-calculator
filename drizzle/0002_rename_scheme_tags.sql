-- Rename the scheme tags (Mayur, 22-10-2026): ABC1 -> FB-PAN, ABC2 -> FB-TNHPJK, ABC3 -> SP-Q3.
-- Data only, no schema change. All rows that carry a tag move to the new tag, so saved reward choices, their log,
-- the dealer totals and the results are kept. A database without the old tags is not changed.
-- After this migration: npm run db:seed (config and cache version), then npm run engine:run.

-- 1. New scheme rows, copied from the old ones (children reference scheme.tag without ON UPDATE CASCADE).
INSERT INTO "scheme" ("tag", "type", "name", "circular_ref", "from_date", "to_date", "base_from_date", "base_to_date",
  "od_check_date", "final_on", "exclusivity_group", "config", "active", "updated_at")
SELECT m.new_tag, s."type", s."name", s."circular_ref", s."from_date", s."to_date", s."base_from_date", s."base_to_date",
  s."od_check_date", s."final_on", s."exclusivity_group", jsonb_set(s."config", '{tag}', to_jsonb(m.new_tag)), s."active", now()
FROM "scheme" s
JOIN (VALUES ('ABC1', 'FB-PAN'), ('ABC2', 'FB-TNHPJK'), ('ABC3', 'SP-Q3')) AS m(old_tag, new_tag) ON m.old_tag = s."tag"
WHERE NOT EXISTS (SELECT 1 FROM "scheme" x WHERE x."tag" = m.new_tag);
--> statement-breakpoint

-- 2. Child and data tables.
UPDATE "scheme_slab" t SET "scheme_tag" = m.new_tag
FROM (VALUES ('ABC1', 'FB-PAN'), ('ABC2', 'FB-TNHPJK'), ('ABC3', 'SP-Q3')) AS m(old_tag, new_tag) WHERE t."scheme_tag" = m.old_tag;
--> statement-breakpoint
UPDATE "scheme_scope_rule" t SET "scheme_tag" = m.new_tag
FROM (VALUES ('ABC1', 'FB-PAN'), ('ABC2', 'FB-TNHPJK'), ('ABC3', 'SP-Q3')) AS m(old_tag, new_tag) WHERE t."scheme_tag" = m.old_tag;
--> statement-breakpoint
UPDATE "sp_product_category" t SET "scheme_tag" = m.new_tag
FROM (VALUES ('ABC1', 'FB-PAN'), ('ABC2', 'FB-TNHPJK'), ('ABC3', 'SP-Q3')) AS m(old_tag, new_tag) WHERE t."scheme_tag" = m.old_tag;
--> statement-breakpoint
UPDATE "dealer_scheme_enrolment" t SET "scheme_tag" = m.new_tag
FROM (VALUES ('ABC1', 'FB-PAN'), ('ABC2', 'FB-TNHPJK'), ('ABC3', 'SP-Q3')) AS m(old_tag, new_tag) WHERE t."scheme_tag" = m.old_tag;
--> statement-breakpoint
UPDATE "dealer_reward_choice" t SET "scheme_tag" = m.new_tag
FROM (VALUES ('ABC1', 'FB-PAN'), ('ABC2', 'FB-TNHPJK'), ('ABC3', 'SP-Q3')) AS m(old_tag, new_tag) WHERE t."scheme_tag" = m.old_tag;
--> statement-breakpoint
UPDATE "dealer_reward_choice_log" t SET "scheme_tag" = m.new_tag
FROM (VALUES ('ABC1', 'FB-PAN'), ('ABC2', 'FB-TNHPJK'), ('ABC3', 'SP-Q3')) AS m(old_tag, new_tag) WHERE t."scheme_tag" = m.old_tag;
--> statement-breakpoint
UPDATE "dealer_metric" t SET "scheme_tag" = m.new_tag
FROM (VALUES ('ABC1', 'FB-PAN'), ('ABC2', 'FB-TNHPJK'), ('ABC3', 'SP-Q3')) AS m(old_tag, new_tag) WHERE t."scheme_tag" = m.old_tag;
--> statement-breakpoint
UPDATE "dealer_scheme_result" t SET "scheme_tag" = m.new_tag, "status" = jsonb_set(t."status", '{scheme_tag}', to_jsonb(m.new_tag))
FROM (VALUES ('ABC1', 'FB-PAN'), ('ABC2', 'FB-TNHPJK'), ('ABC3', 'SP-Q3')) AS m(old_tag, new_tag) WHERE t."scheme_tag" = m.old_tag;
--> statement-breakpoint

-- 3. Old scheme rows (no child row refers to them any more).
DELETE FROM "scheme" WHERE "tag" IN ('ABC1', 'ABC2', 'ABC3');
