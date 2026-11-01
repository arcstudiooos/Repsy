-- PRD H3: a message can be about a workout or a check-in, shown as a chip ("Re: Upper A, Tue 3 Nov") linking back.
-- The label is captured when the message is sent: messages are immutable, and so is what they were about.
ALTER TABLE "messages" ADD COLUMN "anchor_type" TEXT;
ALTER TABLE "messages" ADD COLUMN "anchor_id" UUID;
ALTER TABLE "messages" ADD COLUMN "anchor_label" TEXT;
ALTER TABLE "messages" ADD CONSTRAINT "messages_anchor_check" CHECK (
  ("anchor_type" IS NULL AND "anchor_id" IS NULL AND "anchor_label" IS NULL)
  OR ("anchor_type" IN ('session', 'checkin') AND "anchor_id" IS NOT NULL
      AND char_length("anchor_label") BETWEEN 1 AND 160)
);
