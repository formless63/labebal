CREATE TABLE "label_api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "label_datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"link" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_print_history" (
	"id" text PRIMARY KEY NOT NULL,
	"printed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"printer" text NOT NULL,
	"size_id" text NOT NULL,
	"size_name" text NOT NULL,
	"material" text NOT NULL,
	"ribbon" text NOT NULL,
	"density" integer,
	"invert_all" boolean DEFAULT false NOT NULL,
	"total_qty" integer NOT NULL,
	"items" jsonb NOT NULL,
	"client" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "label_api_tokens_hash_idx" ON "label_api_tokens" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "label_print_history_printed_idx" ON "label_print_history" USING btree ("printed_at");