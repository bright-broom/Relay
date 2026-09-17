-- Customer foundation only. Provision membership through the migration owner.
-- No changes to existing identity/LINE/calendar permissions or data.
CREATE SCHEMA relay_crm;
REVOKE ALL ON SCHEMA relay_crm FROM PUBLIC;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'relay_crm_runtime') THEN
  CREATE ROLE relay_crm_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'relay_crm_runtime'
   AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
  RAISE EXCEPTION 'CRM runtime group must be an unprivileged NOLOGIN role';
 END IF;
END $$;

CREATE TABLE relay_crm.principals (
 id uuid PRIMARY KEY,
 issuer text NOT NULL,
 subject text NOT NULL,
 display_name text NOT NULL CHECK (btrim(display_name) <> ''),
 verified_email text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 disabled_at timestamptz,
 UNIQUE (issuer, subject)
);

CREATE TABLE relay_crm.workspaces (
 id uuid PRIMARY KEY,
 name text NOT NULL CHECK (btrim(name) <> ''),
 time_zone text NOT NULL DEFAULT 'Asia/Tokyo',
 created_at timestamptz NOT NULL DEFAULT now(),
 archived_at timestamptz
);

CREATE TABLE relay_crm.memberships (
 workspace_id uuid NOT NULL REFERENCES relay_crm.workspaces(id),
 principal_id uuid NOT NULL REFERENCES relay_crm.principals(id),
 role text NOT NULL CHECK (role IN ('viewer','editor','admin')),
 status text NOT NULL CHECK (status IN ('active','suspended')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (workspace_id, principal_id)
);

CREATE TABLE relay_crm.customers (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES relay_crm.workspaces(id),
 kind text NOT NULL CHECK (kind IN ('individual','organization','household')),
 display_name text NOT NULL CHECK (btrim(display_name) <> ''),
 name_search text NOT NULL,
 status text NOT NULL CHECK (status IN ('prospect','active','inactive')),
 owner_id uuid,
 region text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 archived_at timestamptz,
 UNIQUE (workspace_id, id),
 FOREIGN KEY (workspace_id, owner_id) REFERENCES relay_crm.memberships(workspace_id, principal_id)
);

CREATE TABLE relay_crm.audit_events (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES relay_crm.workspaces(id),
 actor_id uuid NOT NULL,
 request_id uuid NOT NULL,
 entity_type text NOT NULL,
 entity_id uuid NOT NULL,
 action text NOT NULL,
 changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (workspace_id, actor_id) REFERENCES relay_crm.memberships(workspace_id, principal_id)
);

CREATE TABLE relay_crm.request_dedup (
 workspace_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 operation text NOT NULL,
 key uuid NOT NULL,
 payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
 response_status integer NOT NULL CHECK (response_status BETWEEN 200 AND 299),
 result_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY (workspace_id, actor_id, operation, key),
 CHECK (expires_at > created_at),
 FOREIGN KEY (workspace_id, actor_id) REFERENCES relay_crm.memberships(workspace_id, principal_id)
);

CREATE INDEX member_workspaces ON relay_crm.memberships(principal_id, status, workspace_id);
CREATE INDEX customer_list ON relay_crm.customers(workspace_id, updated_at DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX audit_history ON relay_crm.audit_events(workspace_id, entity_type, entity_id, created_at, id);
CREATE INDEX dedup_expiry ON relay_crm.request_dedup(expires_at);

CREATE FUNCTION relay_crm.prevent_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'History is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON relay_crm.audit_events
 FOR EACH ROW EXECUTE FUNCTION relay_crm.prevent_history_mutation();

DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'relay_crm' LOOP
  EXECUTE format('ALTER TABLE relay_crm.%I ENABLE ROW LEVEL SECURITY', item.tablename);
  EXECUTE format('ALTER TABLE relay_crm.%I FORCE ROW LEVEL SECURITY', item.tablename);
  -- FORCE also applies to ordinary migration owners. Explicit owner-only access
  -- permits controlled provisioning; the application rejects owner membership.
  EXECUTE format('CREATE POLICY migration_owner ON relay_crm.%I TO %I USING (true) WITH CHECK (true)', item.tablename, current_user);
 END LOOP;
END $$;

-- Session identity is set by the server from verified Google claims, transaction-local.
-- The dependency graph is acyclic: principal -> membership -> workspace -> customer.
CREATE POLICY principal_self ON relay_crm.principals FOR SELECT TO relay_crm_runtime
 USING (issuer = 'https://accounts.google.com'
   AND subject = current_setting('relay.subject', true) AND disabled_at IS NULL);
CREATE POLICY membership_self ON relay_crm.memberships FOR SELECT TO relay_crm_runtime
 USING (principal_id IN (SELECT id FROM relay_crm.principals) AND status = 'active');
CREATE POLICY workspace_member ON relay_crm.workspaces FOR SELECT TO relay_crm_runtime
 USING (archived_at IS NULL AND id IN (SELECT workspace_id FROM relay_crm.memberships));

-- FOR SHARE requires UPDATE privileges/policies. WITH CHECK(false) forbids actual
-- changes, including self-promotion. Only a provisioner can change authorization.
CREATE POLICY principal_lock ON relay_crm.principals FOR UPDATE TO relay_crm_runtime
 USING (issuer = 'https://accounts.google.com'
   AND subject = current_setting('relay.subject', true) AND disabled_at IS NULL) WITH CHECK (false);
CREATE POLICY membership_lock ON relay_crm.memberships FOR UPDATE TO relay_crm_runtime
 USING (principal_id IN (SELECT id FROM relay_crm.principals) AND status = 'active') WITH CHECK (false);
CREATE POLICY workspace_lock ON relay_crm.workspaces FOR UPDATE TO relay_crm_runtime
 USING (archived_at IS NULL AND id IN (SELECT workspace_id FROM relay_crm.memberships)) WITH CHECK (false);

CREATE FUNCTION relay_crm.permitted(target uuid, writing boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
 SELECT target::text = current_setting('relay.workspace_id', true)
 AND EXISTS (
  SELECT 1 FROM relay_crm.memberships m JOIN relay_crm.workspaces w ON w.id = m.workspace_id
  WHERE m.workspace_id = target AND m.principal_id::text = current_setting('relay.principal_id', true)
   AND (NOT writing OR m.role IN ('editor','admin'))
 );
$$;
CREATE POLICY customer_read ON relay_crm.customers FOR SELECT TO relay_crm_runtime
 USING (relay_crm.permitted(workspace_id, false));
CREATE POLICY customer_create ON relay_crm.customers FOR INSERT TO relay_crm_runtime
 WITH CHECK (relay_crm.permitted(workspace_id, true)
   AND (owner_id IS NULL OR owner_id::text = current_setting('relay.principal_id', true)));
CREATE POLICY audit_read ON relay_crm.audit_events FOR SELECT TO relay_crm_runtime
 USING (relay_crm.permitted(workspace_id, false));
CREATE POLICY audit_append ON relay_crm.audit_events FOR INSERT TO relay_crm_runtime
 WITH CHECK (relay_crm.permitted(workspace_id, false)
   AND actor_id::text = current_setting('relay.principal_id', true));
CREATE POLICY dedup_read ON relay_crm.request_dedup FOR SELECT TO relay_crm_runtime
 USING (relay_crm.permitted(workspace_id, false)
   AND actor_id::text = current_setting('relay.principal_id', true));
CREATE POLICY dedup_create ON relay_crm.request_dedup FOR INSERT TO relay_crm_runtime
 WITH CHECK (relay_crm.permitted(workspace_id, true)
   AND actor_id::text = current_setting('relay.principal_id', true));

REVOKE ALL ON ALL TABLES IN SCHEMA relay_crm FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA relay_crm FROM PUBLIC;
GRANT USAGE ON SCHEMA relay_crm TO relay_crm_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA relay_crm TO relay_crm_runtime;
GRANT INSERT ON relay_crm.customers, relay_crm.audit_events, relay_crm.request_dedup TO relay_crm_runtime;
GRANT UPDATE(disabled_at) ON relay_crm.principals TO relay_crm_runtime;
GRANT UPDATE(status) ON relay_crm.memberships TO relay_crm_runtime;
GRANT UPDATE(archived_at) ON relay_crm.workspaces TO relay_crm_runtime;
GRANT EXECUTE ON FUNCTION relay_crm.permitted(uuid, boolean) TO relay_crm_runtime;
