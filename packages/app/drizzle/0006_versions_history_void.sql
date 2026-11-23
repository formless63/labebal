CREATE TABLE "label_template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"doc" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"auto" boolean DEFAULT true NOT NULL,
	"who" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "label_print_history" ADD COLUMN "outcome" jsonb;--> statement-breakpoint
ALTER TABLE "label_print_history" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "label_print_history" ADD COLUMN "void_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_print_history" ADD COLUMN "voided_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_template_versions" ADD CONSTRAINT "label_template_versions_template_id_label_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."label_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "label_template_versions_template_version_idx" ON "label_template_versions" USING btree ("template_id","version");