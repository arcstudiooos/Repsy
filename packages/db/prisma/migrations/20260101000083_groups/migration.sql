-- PRD H7, H8: coach-moderated groups for a cohort or team, each with a chat and a feed (posts, comments,
-- reactions). Members can report a post or comment and mute another member; coaches hide anything and settle reports.
-- `author_client_id` is set when a client wrote it, so erasing the client removes their words.
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "groups_id_organization_id_key" ON "groups"("id", "organization_id");
CREATE INDEX "groups_organization_id_idx" ON "groups"("organization_id");
ALTER TABLE "groups" ADD CONSTRAINT "groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "groups" ADD CONSTRAINT "groups_check" CHECK (length("name") BETWEEN 1 AND 80 AND length("description") <= 1000);

CREATE TABLE "group_members" (
    "group_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_members_pkey" PRIMARY KEY ("group_id", "client_id")
);
CREATE INDEX "group_members_organization_id_client_id_idx" ON "group_members"("organization_id", "client_id");
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_organization_id_fkey" FOREIGN KEY ("group_id", "organization_id") REFERENCES "groups"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_client_id_organization_id_fkey" FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "group_posts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "author_user_id" UUID NOT NULL,
    "author_client_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hidden_at" TIMESTAMPTZ(3),
    CONSTRAINT "group_posts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "group_posts_id_organization_id_key" ON "group_posts"("id", "organization_id");
CREATE INDEX "group_posts_group_id_kind_created_at_idx" ON "group_posts"("group_id", "kind", "created_at");
CREATE INDEX "group_posts_organization_id_author_client_id_idx" ON "group_posts"("organization_id", "author_client_id");
ALTER TABLE "group_posts" ADD CONSTRAINT "group_posts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_posts" ADD CONSTRAINT "group_posts_group_id_organization_id_fkey" FOREIGN KEY ("group_id", "organization_id") REFERENCES "groups"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_posts" ADD CONSTRAINT "group_posts_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_posts" ADD CONSTRAINT "group_posts_author_client_id_organization_id_fkey" FOREIGN KEY ("author_client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_posts" ADD CONSTRAINT "group_posts_check" CHECK ("kind" IN ('chat', 'post') AND length("body") BETWEEN 1 AND 4000);

CREATE TABLE "group_comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "author_client_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hidden_at" TIMESTAMPTZ(3),
    CONSTRAINT "group_comments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "group_comments_id_organization_id_key" ON "group_comments"("id", "organization_id");
CREATE INDEX "group_comments_post_id_created_at_idx" ON "group_comments"("post_id", "created_at");
CREATE INDEX "group_comments_organization_id_author_client_id_idx" ON "group_comments"("organization_id", "author_client_id");
ALTER TABLE "group_comments" ADD CONSTRAINT "group_comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_comments" ADD CONSTRAINT "group_comments_post_id_organization_id_fkey" FOREIGN KEY ("post_id", "organization_id") REFERENCES "group_posts"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_comments" ADD CONSTRAINT "group_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_comments" ADD CONSTRAINT "group_comments_author_client_id_organization_id_fkey" FOREIGN KEY ("author_client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_comments" ADD CONSTRAINT "group_comments_check" CHECK (length("body") BETWEEN 1 AND 2000);

CREATE TABLE "group_reactions" (
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_reactions_pkey" PRIMARY KEY ("post_id", "user_id", "kind")
);
CREATE INDEX "group_reactions_organization_id_user_id_idx" ON "group_reactions"("organization_id", "user_id");
ALTER TABLE "group_reactions" ADD CONSTRAINT "group_reactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_reactions" ADD CONSTRAINT "group_reactions_post_id_organization_id_fkey" FOREIGN KEY ("post_id", "organization_id") REFERENCES "group_posts"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_reactions" ADD CONSTRAINT "group_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_reactions" ADD CONSTRAINT "group_reactions_check" CHECK ("kind" IN ('like', 'clap', 'strong', 'fire'));

CREATE TABLE "group_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "post_id" UUID,
    "comment_id" UUID,
    "reporter_user_id" UUID NOT NULL,
    "reporter_client_id" UUID,
    "reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    CONSTRAINT "group_reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "group_reports_group_id_resolved_at_idx" ON "group_reports"("group_id", "resolved_at");
ALTER TABLE "group_reports" ADD CONSTRAINT "group_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_reports" ADD CONSTRAINT "group_reports_group_id_organization_id_fkey" FOREIGN KEY ("group_id", "organization_id") REFERENCES "groups"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_reports" ADD CONSTRAINT "group_reports_post_id_organization_id_fkey" FOREIGN KEY ("post_id", "organization_id") REFERENCES "group_posts"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_reports" ADD CONSTRAINT "group_reports_comment_id_organization_id_fkey" FOREIGN KEY ("comment_id", "organization_id") REFERENCES "group_comments"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_reports" ADD CONSTRAINT "group_reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_reports" ADD CONSTRAINT "group_reports_reporter_client_id_organization_id_fkey" FOREIGN KEY ("reporter_client_id", "organization_id") REFERENCES "clients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_reports" ADD CONSTRAINT "group_reports_check" CHECK (
  ("post_id" IS NULL) <> ("comment_id" IS NULL) AND length("reason") <= 500
);

CREATE TABLE "group_mutes" (
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "muted_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_mutes_pkey" PRIMARY KEY ("organization_id", "user_id", "muted_user_id")
);
ALTER TABLE "group_mutes" ADD CONSTRAINT "group_mutes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_mutes" ADD CONSTRAINT "group_mutes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_mutes" ADD CONSTRAINT "group_mutes_muted_user_id_fkey" FOREIGN KEY ("muted_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_mutes" ADD CONSTRAINT "group_mutes_check" CHECK ("user_id" <> "muted_user_id");

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['groups', 'group_members', 'group_posts', 'group_comments', 'group_reactions', 'group_reports', 'group_mutes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_current_org() OR app_rls_bypass()) WITH CHECK (organization_id = app_current_org() OR app_rls_bypass())',
      t
    );
  END LOOP;
END
$$;
