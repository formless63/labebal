CREATE TABLE "label_counter_log" (
	"id" text PRIMARY KEY NOT NULL,
	"counter_id" text NOT NULL,
	"scope_key" text DEFAULT '' NOT NULL,
	"first" integer NOT NULL,
	"last" integer NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_counter_values" (
	"counter_id" text NOT NULL,
	"scope_key" text DEFAULT '' NOT NULL,
	"next" integer NOT NULL,
	"period" text DEFAULT '' NOT NULL,
	"watched" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "label_counter_values_counter_id_scope_key_pk" PRIMARY KEY("counter_id","scope_key")
);
--> statement-breakpoint
CREATE TABLE "label_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"key_field" text,
	"reset" text DEFAULT 'never' NOT NULL,
	"watch_field" text,
	"start" integer DEFAULT 1 NOT NULL,
	"format" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "label_print_history" ADD COLUMN "counters" jsonb;--> statement-breakpoint
ALTER TABLE "label_print_history" ADD COLUMN "print_values" jsonb;--> statement-breakpoint
ALTER TABLE "label_counter_log" ADD CONSTRAINT "label_counter_log_counter_id_label_counters_id_fk" FOREIGN KEY ("counter_id") REFERENCES "public"."label_counters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_counter_values" ADD CONSTRAINT "label_counter_values_counter_id_label_counters_id_fk" FOREIGN KEY ("counter_id") REFERENCES "public"."label_counters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "label_counter_log_counter_idx" ON "label_counter_log" USING btree ("counter_id","at");