CREATE TABLE "label_components" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_notes" (
	"label_id" text PRIMARY KEY NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_pack_items" (
	"pack_id" text NOT NULL,
	"kind" text NOT NULL,
	"item_id" text NOT NULL,
	"hash" text NOT NULL,
	"doc" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "label_pack_items_kind_item_id_pk" PRIMARY KEY("kind","item_id")
);
--> statement-breakpoint
CREATE TABLE "label_pack_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'url' NOT NULL,
	"input" text NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"token" text,
	"token_host" text DEFAULT '' NOT NULL,
	"index" jsonb,
	"last_fetched_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text,
	"url" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"homepage" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"selection" text[],
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_settings" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	CONSTRAINT "label_settings_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "label_text_styles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "label_notes" ADD CONSTRAINT "label_notes_label_id_label_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."label_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_pack_items" ADD CONSTRAINT "label_pack_items_pack_id_label_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."label_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_packs" ADD CONSTRAINT "label_packs_source_id_label_pack_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."label_pack_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "label_pack_items_pack_idx" ON "label_pack_items" USING btree ("pack_id");