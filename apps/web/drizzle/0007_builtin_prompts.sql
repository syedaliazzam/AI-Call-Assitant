-- ADR-0087: the built-in prompts the app has run with (ai_builtin_prompt), and for each custom prompt the
-- hash of the built-in prompt it was written against (base_hash). Additive only (ADR-0050).
CREATE TABLE "ai_builtin_prompt" (
	"block" text NOT NULL,
	"hash" text NOT NULL,
	"prompt" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_builtin_prompt_block_hash_pk" PRIMARY KEY("block","hash"),
	CONSTRAINT "ai_builtin_prompt_block_check" CHECK ("ai_builtin_prompt"."block" in ('live', 'notes', 'ask')),
	CONSTRAINT "ai_builtin_prompt_prompt_check" CHECK (char_length("ai_builtin_prompt"."prompt") <= 130000)
);
--> statement-breakpoint
ALTER TABLE "ai_instructions_version" ADD COLUMN "base_hash" text;