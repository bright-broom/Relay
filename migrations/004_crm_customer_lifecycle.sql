-- Additive migration: preserve existing records, grants and append-only history.
ALTER TABLE relay_crm.request_dedup ADD COLUMN result_version bigint CHECK (result_version > 0);
CREATE INDEX customer_archived_list ON relay_crm.customers(workspace_id, updated_at DESC, id DESC)
 WHERE archived_at IS NOT NULL;
CREATE POLICY customer_update ON relay_crm.customers FOR UPDATE TO relay_crm_runtime
 USING (relay_crm.permitted(workspace_id, true))
 WITH CHECK (relay_crm.permitted(workspace_id, true));
-- Tenant, owner, status and creation metadata cannot be changed by this feature.
GRANT UPDATE(display_name, name_search, kind, updated_at, version, archived_at)
 ON relay_crm.customers TO relay_crm_runtime;
