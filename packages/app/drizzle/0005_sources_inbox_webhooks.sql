CREATE TABLE "label_data_sources" (
	"dataset_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"header_name" text,
	"header_value" text,
	"rows_path" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"key_column" text,
	"mode" text DEFAULT 'upsert' NOT NULL,
	"apply_labels" boolean DEFAULT false NOT NULL,
	"interval_minutes" integer,
	"last_sync_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"last_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_print_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"label_id" text,
	"template_id" text,
	"key" text,
	"name" text,
	"values" jsonb,
	"qty" integer DEFAULT 1 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"requested_by" text DEFAULT '' NOT NULL,
	"token_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_status" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "label_webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "label_data_sources" ADD CONSTRAINT "label_data_sources_dataset_id_label_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."label_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_webhook_deliveries" ADD CONSTRAINT "label_webhook_deliveries_webhook_id_label_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."label_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "label_print_requests_status_idx" ON "label_print_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "label_webhook_deliveries_due_idx" ON "label_webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "label_webhook_deliveries_hook_idx" ON "label_webhook_deliveries" USING btree ("webhook_id","created_at");