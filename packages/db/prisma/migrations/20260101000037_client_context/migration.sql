-- PRD B7 client context card (coaches only): why the client came, schedule limits, equipment and preferences, plus
-- notes pinned to the card. Erasure blanks the fields and deletes the notes with the rest of the client's data.

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "equipment_notes" TEXT,
ADD COLUMN     "motivation" TEXT,
ADD COLUMN     "preferences" TEXT,
ADD COLUMN     "schedule_notes" TEXT;

-- AlterTable
ALTER TABLE "internal_notes" ADD COLUMN     "pinned_at" TIMESTAMPTZ(3);

ALTER TABLE "clients" ADD CONSTRAINT "clients_context_length_check" CHECK (
  ("motivation" IS NULL OR char_length("motivation") <= 1000)
  AND ("schedule_notes" IS NULL OR char_length("schedule_notes") <= 1000)
  AND ("equipment_notes" IS NULL OR char_length("equipment_notes") <= 1000)
  AND ("preferences" IS NULL OR char_length("preferences") <= 1000)
);
