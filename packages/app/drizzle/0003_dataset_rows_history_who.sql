CREATE TABLE "label_dataset_rows" (
	"dataset_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"cells" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "label_dataset_rows_dataset_id_id_pk" PRIMARY KEY("dataset_id","id")
);
--> statement-breakpoint
ALTER TABLE "label_print_history" ADD COLUMN "who" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_dataset_rows" ADD CONSTRAINT "label_dataset_rows_dataset_id_label_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."label_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "label_dataset_rows_position_idx" ON "label_dataset_rows" USING btree ("dataset_id","position");--> statement-breakpoint
-- Move rows out of the JSONB array into the row table (hand-written; keeps row ids and order, first copy of a duplicated id wins).
INSERT INTO "label_dataset_rows" ("dataset_id", "id", "position", "cells")
SELECT DISTINCT ON (d."id", coalesce(nullif(r.value->>'id', ''), 'r-m' || r.ord))
	d."id", coalesce(nullif(r.value->>'id', ''), 'r-m' || r.ord), (r.ord - 1)::integer, coalesce(r.value->'values', '{}'::jsonb)
FROM "label_datasets" d
CROSS JOIN LATERAL jsonb_array_elements(d."rows") WITH ORDINALITY AS r(value, ord)
ORDER BY d."id", coalesce(nullif(r.value->>'id', ''), 'r-m' || r.ord), r.ord;--> statement-breakpoint
ALTER TABLE "label_datasets" DROP COLUMN "rows";