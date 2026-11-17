-- ADR-0098: one live lock per session of an account (a call runs on one device at a time). Additive only
-- (ADR-0050): one new table; nothing existing changes. Ids and times only, never call content.
CREATE TABLE "live_call_lock" (
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"call_id" text NOT NULL,
	"device_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"replaced_call_id" text,
	CONSTRAINT "live_call_lock_user_id_session_id_pk" PRIMARY KEY("user_id","session_id")
);
--> statement-breakpoint
ALTER TABLE "live_call_lock" ADD CONSTRAINT "live_call_lock_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;