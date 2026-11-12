CREATE TABLE "drive_company" (
	"id" text PRIMARY KEY NOT NULL,
	"key_version" smallint NOT NULL,
	"refresh_token" text NOT NULL,
	"account_email" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"folder_id" text,
	"folder_name" text,
	"drive_id" text,
	"connected_by" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_member" (
	"user_id" text PRIMARY KEY NOT NULL,
	"save_enabled" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"also_notify" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drive_company" ADD CONSTRAINT "drive_company_connected_by_user_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_member" ADD CONSTRAINT "drive_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- ADR-0074: each person keeps their Drive switches and team list (no token): copied once from the
-- per-person google_drive rows, which are no longer read.
INSERT INTO "drive_member" ("user_id", "save_enabled", "email_enabled", "also_notify") SELECT "user_id", "save_enabled", "email_enabled", "also_notify" FROM "google_drive" ON CONFLICT ("user_id") DO NOTHING;
