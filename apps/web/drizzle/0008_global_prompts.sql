-- ADR-0089: one admin-edited global prompt per block. Additive only (ADR-0050): two nullable columns on
-- ai_instructions_version (global_prompt: null = the code's default prompt; note) with size checks, and the
-- ai_quality_check table (scores and scenario ids only). Existing rows are unchanged.
CREATE TABLE "ai_quality_check" (
	"id" text PRIMARY KEY NOT NULL,
	"block" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"score" real NOT NULL,
	"failed" integer NOT NULL,
	"results" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_quality_check_block_check" CHECK ("ai_quality_check"."block" in ('live', 'notes', 'ask')),
	CONSTRAINT "ai_quality_check_results_check" CHECK (char_length("ai_quality_check"."results") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "ai_instructions_version" ADD COLUMN "global_prompt" text;--> statement-breakpoint
ALTER TABLE "ai_instructions_version" ADD COLUMN "note" text;--> statement-breakpoint
CREATE INDEX "ai_quality_check_prompt_idx" ON "ai_quality_check" USING btree ("block","prompt_hash","created_at");--> statement-breakpoint
ALTER TABLE "ai_instructions_version" ADD CONSTRAINT "ai_instructions_version_global_prompt_check" CHECK ("ai_instructions_version"."global_prompt" is null or char_length("ai_instructions_version"."global_prompt") <= 30000);--> statement-breakpoint
ALTER TABLE "ai_instructions_version" ADD CONSTRAINT "ai_instructions_version_note_check" CHECK ("ai_instructions_version"."note" is null or char_length("ai_instructions_version"."note") <= 200);