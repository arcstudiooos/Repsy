-- PRD I7: when a client stopped being coached, and why (a short fixed list, never free text). `archived_at` follows
-- the status in a trigger, so every path that archives or restores a client keeps it right.
ALTER TABLE "clients" ADD COLUMN "archived_at" TIMESTAMPTZ(3);
ALTER TABLE "clients" ADD COLUMN "churn_reason" TEXT;
ALTER TABLE "clients" ADD CONSTRAINT "clients_churn_reason_check" CHECK (
  "churn_reason" IS NULL OR "churn_reason" IN ('goal_reached', 'cost', 'time', 'results', 'moved_on', 'health', 'other')
);
UPDATE "clients" SET "archived_at" = "updated_at" WHERE "status" = 'archived';

CREATE FUNCTION clients_track_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived' THEN
    NEW.archived_at := COALESCE(NEW.archived_at, now());
  ELSIF NEW.status <> 'archived' AND OLD.status = 'archived' THEN
    NEW.archived_at := NULL;
    NEW.churn_reason := NULL;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER clients_track_archive BEFORE UPDATE OF status ON "clients"
  FOR EACH ROW EXECUTE FUNCTION clients_track_archive();
