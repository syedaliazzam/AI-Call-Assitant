-- ADR-0086: a custom full system prompt per version of the company AI instructions. Additive only (ADR-0050):
-- one new nullable column (null = the built-in prompt) and its size check; existing rows are unchanged.
ALTER TABLE "ai_instructions_version" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "ai_instructions_version" ADD CONSTRAINT "ai_instructions_version_prompt_check" CHECK ("ai_instructions_version"."prompt" is null or char_length("ai_instructions_version"."prompt") <= 130000);