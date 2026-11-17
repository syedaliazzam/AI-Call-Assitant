-- ADR-0095: how many of each day's requests went to Groq, for Admin → Usage. Additive only (ADR-0050): one
-- column with default 0, so every existing row reads 0 and older code keeps working.
ALTER TABLE "usage_day" ADD COLUMN "groq_requests" integer DEFAULT 0 NOT NULL;