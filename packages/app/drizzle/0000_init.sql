CREATE TABLE "label_labels" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"name" text NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overrides" jsonb,
	"invert" boolean,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "label_labels" ADD CONSTRAINT "label_labels_template_id_label_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."label_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "label_labels_template_idx" ON "label_labels" USING btree ("template_id");