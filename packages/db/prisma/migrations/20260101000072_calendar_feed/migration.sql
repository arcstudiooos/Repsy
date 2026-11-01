-- PRD L7: a client's private calendar feed (ICS). Calendar apps can't sign in, so the link carries a secret token;
-- only its sha256 is stored. Making a new link replaces it (the old one stops working).
ALTER TABLE "clients" ADD COLUMN "calendar_token_hash" TEXT;
CREATE UNIQUE INDEX "clients_calendar_token_hash_key" ON "clients"("calendar_token_hash");
