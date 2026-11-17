-- ADR-0099: how many of each day's requests went to Google's Gemini and to OpenAI, for Admin → Usage. Additive
-- only (ADR-0050): two columns with default 0, so every existing row reads 0 and older code keeps working.
ALTER TABLE "usage_day" ADD COLUMN "gemini_requests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_day" ADD COLUMN "openai_requests" integer DEFAULT 0 NOT NULL;
