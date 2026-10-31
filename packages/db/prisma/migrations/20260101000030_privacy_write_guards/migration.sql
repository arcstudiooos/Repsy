-- PR #2 review (I2, I3): tighten what a tenant transaction may write.
--
-- deletion_requests / support_access_grants: the generic FOR ALL tenant_isolation policy let any withTenant
-- transaction of the organization verify a deletion request (which triggers irreversible erasure), lift a legal
-- hold, or forge, extend and un-revoke support grants. Split policies instead: a tenant reads its organization's
-- rows (transparency) and files a deletion request in its initial state; every other write is system scope only
-- (the platform-admin console and the erasure job run under app.bypass_rls).
--
-- messages: documented immutable, but only UPDATE was guarded. DELETE is now refused unless the transaction set
-- app.lawful_erasure = 'on' (transaction-local; only the deletion job does, as for set_log_revisions in 000029),
-- and TRUNCATE is always refused.

DROP POLICY tenant_isolation ON "deletion_requests";
CREATE POLICY tenant_read ON "deletion_requests" FOR SELECT
  USING (organization_id = app_current_org());
CREATE POLICY tenant_request ON "deletion_requests" FOR INSERT
  WITH CHECK (
    organization_id = app_current_org()
    AND status = 'requested'
    AND NOT legal_hold
    AND verified_by IS NULL
    AND verified_at IS NULL
    AND completed_at IS NULL
    AND rejected_reason IS NULL
  );
CREATE POLICY system_write ON "deletion_requests" FOR ALL
  USING (app_rls_bypass())
  WITH CHECK (app_rls_bypass());

DROP POLICY tenant_isolation ON "support_access_grants";
CREATE POLICY tenant_read ON "support_access_grants" FOR SELECT
  USING (organization_id = app_current_org());
CREATE POLICY system_write ON "support_access_grants" FOR ALL
  USING (app_rls_bypass())
  WITH CHECK (app_rls_bypass());

CREATE FUNCTION messages_reject_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_catalog.current_setting('app.lawful_erasure', true) OPERATOR(pg_catalog.=) 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'messages are immutable: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER messages_no_delete
  BEFORE DELETE ON "messages"
  FOR EACH ROW EXECUTE FUNCTION messages_reject_delete();
CREATE TRIGGER messages_no_truncate
  BEFORE TRUNCATE ON "messages"
  FOR EACH STATEMENT EXECUTE FUNCTION messages_reject_delete();
