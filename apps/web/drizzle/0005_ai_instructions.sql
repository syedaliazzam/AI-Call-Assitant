-- ADR-0083: company AI instructions. Additive only (ADR-0050): two new tables, no change to existing ones.
-- ai_instructions_version keeps every saved version (never changed or deleted); ai_instructions_active
-- points at the version in force per block.
CREATE TABLE "ai_instructions_active" (
	"block" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_instructions_version" (
	"id" text PRIMARY KEY NOT NULL,
	"block" text NOT NULL,
	"text" text NOT NULL,
	"author_id" text,
	"restored_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_instructions_version_block_check" CHECK ("ai_instructions_version"."block" in ('live', 'notes', 'ask')),
	CONSTRAINT "ai_instructions_version_text_check" CHECK (char_length("ai_instructions_version"."text") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "ai_instructions_active" ADD CONSTRAINT "ai_instructions_active_version_id_ai_instructions_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."ai_instructions_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_instructions_version" ADD CONSTRAINT "ai_instructions_version_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_instructions_version_block_created_idx" ON "ai_instructions_version" USING btree ("block","created_at");