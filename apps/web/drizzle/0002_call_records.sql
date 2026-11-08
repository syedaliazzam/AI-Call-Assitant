CREATE SEQUENCE "public"."call_record_rev_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "call_record" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"session_id" text,
	"rev" bigint DEFAULT nextval('call_record_rev_seq') NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"key_version" smallint,
	"content" text,
	"save_transcript" boolean,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_record_user_id_kind_id_pk" PRIMARY KEY("user_id","kind","id")
);
--> statement-breakpoint
ALTER TABLE "call_record" ADD CONSTRAINT "call_record_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_record_user_updated_idx" ON "call_record" USING btree ("user_id","updated_at","kind","id");--> statement-breakpoint
CREATE INDEX "call_record_user_session_idx" ON "call_record" USING btree ("user_id","session_id");