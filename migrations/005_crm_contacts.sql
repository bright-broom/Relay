-- Additive contact foundation. Apply with the same owner as 003 and 004.
CREATE TABLE relay_crm.contacts (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES relay_crm.workspaces(id),
 display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
 email text CHECK (email IS NULL OR length(email) BETWEEN 1 AND 254),
 phone text CHECK (phone IS NULL OR length(phone) BETWEEN 1 AND 64),
 email_search text,
 phone_search text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 archived_at timestamptz,
 UNIQUE (workspace_id, id)
);
CREATE TABLE relay_crm.customer_contacts (
 workspace_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 contact_id uuid NOT NULL,
 relationship text NOT NULL CHECK (relationship IN ('contact','self','billing','other')),
 is_primary boolean NOT NULL DEFAULT false,
 PRIMARY KEY (workspace_id, customer_id, contact_id),
 FOREIGN KEY (workspace_id, customer_id) REFERENCES relay_crm.customers(workspace_id, id),
 FOREIGN KEY (workspace_id, contact_id) REFERENCES relay_crm.contacts(workspace_id, id)
);
CREATE UNIQUE INDEX customer_primary_contact ON relay_crm.customer_contacts(workspace_id, customer_id) WHERE is_primary;
CREATE INDEX contact_customers ON relay_crm.customer_contacts(workspace_id, contact_id);
DO $$ DECLARE item text; BEGIN
 FOREACH item IN ARRAY ARRAY['contacts','customer_contacts'] LOOP
  EXECUTE format('ALTER TABLE relay_crm.%I ENABLE ROW LEVEL SECURITY', item);
  EXECUTE format('ALTER TABLE relay_crm.%I FORCE ROW LEVEL SECURITY', item);
  EXECUTE format('CREATE POLICY migration_owner ON relay_crm.%I TO %I USING (true) WITH CHECK (true)', item, current_user);
  EXECUTE format('CREATE POLICY member_read ON relay_crm.%I FOR SELECT TO relay_crm_runtime USING (relay_crm.permitted(workspace_id, false))', item);
 END LOOP;
END $$;
CREATE POLICY contact_create ON relay_crm.contacts FOR INSERT TO relay_crm_runtime
 WITH CHECK (relay_crm.permitted(workspace_id, true));
CREATE POLICY contact_link ON relay_crm.customer_contacts FOR INSERT TO relay_crm_runtime
 WITH CHECK (relay_crm.permitted(workspace_id, true)
  AND EXISTS (SELECT 1 FROM relay_crm.customers c WHERE c.workspace_id = customer_contacts.workspace_id AND c.id = customer_id AND c.archived_at IS NULL)
  AND EXISTS (SELECT 1 FROM relay_crm.contacts c WHERE c.workspace_id = customer_contacts.workspace_id AND c.id = contact_id AND c.archived_at IS NULL));
REVOKE ALL ON relay_crm.contacts, relay_crm.customer_contacts FROM PUBLIC;
GRANT SELECT, INSERT ON relay_crm.contacts, relay_crm.customer_contacts TO relay_crm_runtime;
