-- PRD L11: coach demo videos are transcoded by Cloudflare Stream into adaptive-bitrate HLS.
-- The original MP4 stays in storage and plays until the stream is ready (or if Stream is not set up).
ALTER TABLE "media_files" ADD COLUMN "stream_uid" TEXT;
ALTER TABLE "media_files" ADD COLUMN "stream_status" TEXT;
ALTER TABLE "media_files" ADD COLUMN "stream_hls_url" TEXT;
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_stream_status_check" CHECK ("stream_status" IS NULL OR "stream_status" IN ('processing', 'ready', 'error'));
