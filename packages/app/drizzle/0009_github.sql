CREATE TABLE "label_github_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"github_id" bigint NOT NULL,
	"login" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"avatar_url" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"token" text NOT NULL,
	"commit_email" text,
	"default_repo" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "label_github_published" (
	"id" text PRIMARY KEY NOT NULL,
	"pack_id" text NOT NULL,
	"account_id" text,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"branch" text NOT NULL,
	"dir" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"folder" text DEFAULT '' NOT NULL,
	"version" text NOT NULL,
	"template_ids" text[] DEFAULT '{}' NOT NULL,
	"label_ids" text[] DEFAULT '{}' NOT NULL,
	"datasets" boolean DEFAULT false NOT NULL,
	"items" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"commit_sha" text DEFAULT '' NOT NULL,
	"commit_url" text DEFAULT '' NOT NULL,
	"published_by" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_pack_source_github" (
	"source_id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"ref" text DEFAULT 'HEAD' NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"sha" text,
	"etag" text,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "label_pack_update_skips" (
	"pack_id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"skipped_by" text DEFAULT '' NOT NULL,
	"skipped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "label_github_published" ADD CONSTRAINT "label_github_published_account_id_label_github_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."label_github_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_pack_source_github" ADD CONSTRAINT "label_pack_source_github_source_id_label_pack_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."label_pack_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_pack_source_github" ADD CONSTRAINT "label_pack_source_github_account_id_label_github_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."label_github_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "label_github_accounts_scope_user_idx" ON "label_github_accounts" USING btree ("scope","github_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "label_github_published_repo_idx" ON "label_github_published" USING btree ("owner","repo","dir");