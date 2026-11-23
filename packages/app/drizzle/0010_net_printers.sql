CREATE TABLE "label_net_printers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 9100 NOT NULL,
	"language" text DEFAULT 'zpl' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"dpi" integer NOT NULL,
	"head_dots" integer NOT NULL,
	"thermal" text DEFAULT 'both' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL
);
