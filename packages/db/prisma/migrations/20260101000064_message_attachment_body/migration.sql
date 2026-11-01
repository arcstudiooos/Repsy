-- PRD H2: a photo or PDF can be sent on its own, so the body may be empty when there is an attachment.
ALTER TABLE "messages" DROP CONSTRAINT "messages_body_check";
ALTER TABLE "messages" ADD CONSTRAINT "messages_body_check" CHECK (
  char_length("body") <= 4000 AND (char_length("body") >= 1 OR "attachment_media_id" IS NOT NULL)
);
