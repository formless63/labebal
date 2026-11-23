CREATE TABLE "label_printer_calibrations" (
	"serial" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"offset_x" integer DEFAULT 0 NOT NULL,
	"offset_y" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'calibrated' NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
