-- Contact information is shared; customer relationships remain unchanged.
CREATE POLICY contact_update ON relay_crm.contacts FOR UPDATE TO relay_crm_runtime
 USING (relay_crm.permitted(workspace_id, true) AND archived_at IS NULL)
 WITH CHECK (relay_crm.permitted(workspace_id, true) AND archived_at IS NULL);
GRANT UPDATE(display_name, email, phone, updated_at, version)
 ON relay_crm.contacts TO relay_crm_runtime;
