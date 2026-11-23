CREATE TABLE "label_boards" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"tiles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
