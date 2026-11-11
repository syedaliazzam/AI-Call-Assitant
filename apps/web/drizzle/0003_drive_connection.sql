CREATE TABLE "drive_notification" (
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"status" text NOT NULL,
	"key_version" smallint NOT NULL,
	"content" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_notification_user_id_session_id_pk" PRIMARY KEY("user_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "google_drive" (
	"user_id" text PRIMARY KEY NOT NULL,
	"key_version" smallint NOT NULL,
	"refresh_token" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"folder_id" text,
	"folder_name" text,
	"drive_id" text,
	"save_enabled" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"also_notify" text[] DEFAULT '{}'::text[] NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drive_notification" ADD CONSTRAINT "drive_notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_drive" ADD CONSTRAINT "google_drive_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drive_notification_user_created_idx" ON "drive_notification" USING btree ("user_id","created_at");