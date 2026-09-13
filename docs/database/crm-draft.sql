-- DESIGN DRAFT, NOT A PRODUCTION MIGRATION. See ../CRM_DATABASE.md.
-- Validate only in an isolated database. The migration runner does not load docs/.
-- Runtime roles, authorization policies, audit writers and APIs are not implemented here.
-- RLS is forced without policies: ordinary runtime roles cannot access any CRM rows.
CREATE SCHEMA relay_crm;
REVOKE ALL ON SCHEMA relay_crm FROM PUBLIC;

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
CREATE TABLE relay_crm.contacts (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES relay_crm.workspaces(id),
 display_name text NOT NULL CHECK (btrim(display_name) <> ''),
 email text,
 phone text,
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
 relationship text NOT NULL,
 is_primary boolean NOT NULL DEFAULT false,
 PRIMARY KEY (workspace_id, customer_id, contact_id),
 FOREIGN KEY (workspace_id, customer_id) REFERENCES relay_crm.customers(workspace_id, id),
 FOREIGN KEY (workspace_id, contact_id) REFERENCES relay_crm.contacts(workspace_id, id)
);
CREATE UNIQUE INDEX customer_primary_contact ON relay_crm.customer_contacts(workspace_id, customer_id) WHERE is_primary;
CREATE INDEX contact_customers ON relay_crm.customer_contacts(workspace_id, contact_id);

CREATE TABLE relay_crm.pipelines (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES relay_crm.workspaces(id),
 name text NOT NULL CHECK (btrim(name) <> ''),
 archived_at timestamptz,
 UNIQUE (workspace_id, id)
);
CREATE TABLE relay_crm.stages (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 pipeline_id uuid NOT NULL,
 name text NOT NULL CHECK (btrim(name) <> ''),
 kind text NOT NULL CHECK (kind IN ('open','won','lost')),
 position integer NOT NULL CHECK (position >= 0),
 archived_at timestamptz,
 UNIQUE (workspace_id, pipeline_id, id),
 UNIQUE (workspace_id, pipeline_id, position),
 FOREIGN KEY (workspace_id, pipeline_id) REFERENCES relay_crm.pipelines(workspace_id, id)
);
CREATE TABLE relay_crm.opportunities (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 title text NOT NULL CHECK (btrim(title) <> ''),
 pipeline_id uuid NOT NULL,
 stage_id uuid NOT NULL,
 owner_id uuid,
 expected_amount bigint CHECK (expected_amount >= 0),
 currency text NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
 expected_close_on date,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 archived_at timestamptz,
 UNIQUE (workspace_id, id),
 UNIQUE (workspace_id, customer_id, id),
 FOREIGN KEY (workspace_id, customer_id) REFERENCES relay_crm.customers(workspace_id, id),
 FOREIGN KEY (workspace_id, pipeline_id, stage_id) REFERENCES relay_crm.stages(workspace_id, pipeline_id, id),
 FOREIGN KEY (workspace_id, owner_id) REFERENCES relay_crm.memberships(workspace_id, principal_id)
);
CREATE TABLE relay_crm.activities (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 opportunity_id uuid,
 kind text NOT NULL CHECK (kind IN ('call','email','meeting','message','note','task_completion')),
 summary text NOT NULL CHECK (btrim(summary) <> ''),
 body text,
 evidence_kind text NOT NULL CHECK (evidence_kind IN ('self_report','source_reference')),
 source_reference text,
 occurred_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 actor_id uuid NOT NULL,
 supersedes_id uuid,
 UNIQUE (workspace_id, id),
 UNIQUE (workspace_id, customer_id, id),
 UNIQUE (workspace_id, supersedes_id),
 CHECK (supersedes_id IS NULL OR supersedes_id <> id),
 CHECK (evidence_kind <> 'source_reference' OR nullif(btrim(source_reference),'') IS NOT NULL),
 FOREIGN KEY (workspace_id, customer_id) REFERENCES relay_crm.customers(workspace_id, id),
 FOREIGN KEY (workspace_id, customer_id, opportunity_id) REFERENCES relay_crm.opportunities(workspace_id, customer_id, id),
 FOREIGN KEY (workspace_id, actor_id) REFERENCES relay_crm.memberships(workspace_id, principal_id),
 FOREIGN KEY (workspace_id, customer_id, supersedes_id) REFERENCES relay_crm.activities(workspace_id, customer_id, id)
);
CREATE TABLE relay_crm.tasks (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 opportunity_id uuid,
 title text NOT NULL CHECK (btrim(title) <> ''),
 assignee_id uuid,
 status text NOT NULL CHECK (status IN ('todo','doing','waiting','confirmation_required','done','cancelled')),
 due_on date,
 due_at timestamptz,
 waiting_for text,
 completed_at timestamptz,
 completion_activity_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 archived_at timestamptz,
 UNIQUE (workspace_id, id),
 CHECK (due_on IS NULL OR due_at IS NULL),
 CHECK ((status = 'done' AND completed_at IS NOT NULL AND completion_activity_id IS NOT NULL)
     OR (status <> 'done' AND completed_at IS NULL AND completion_activity_id IS NULL)),
 FOREIGN KEY (workspace_id, customer_id) REFERENCES relay_crm.customers(workspace_id, id),
 FOREIGN KEY (workspace_id, customer_id, opportunity_id) REFERENCES relay_crm.opportunities(workspace_id, customer_id, id),
 FOREIGN KEY (workspace_id, assignee_id) REFERENCES relay_crm.memberships(workspace_id, principal_id),
 FOREIGN KEY (workspace_id, customer_id, completion_activity_id) REFERENCES relay_crm.activities(workspace_id, customer_id, id)
);
CREATE TABLE relay_crm.proposal_snapshots (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 opportunity_id uuid NOT NULL,
 revision integer NOT NULL CHECK (revision > 0),
 actor_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 engine_version text NOT NULL CHECK (engine_version = 'fixed-cost-jpy/1.0.0'),
 profile_id text NOT NULL CHECK (profile_id = 'fixed-cost'),
 profile_version text NOT NULL CHECK (profile_version = '1.0.0'),
 currency text NOT NULL CHECK (currency = 'JPY'),
 current_monthly bigint NOT NULL CHECK (current_monthly BETWEEN 0 AND 9999999999),
 proposed_monthly bigint NOT NULL CHECK (proposed_monthly BETWEEN 0 AND 9999999999),
 upfront bigint NOT NULL CHECK (upfront BETWEEN 0 AND 9999999999),
 installment_monthly bigint NOT NULL CHECK (installment_monthly BETWEEN 0 AND 9999999999),
 installment_months integer NOT NULL CHECK (installment_months BETWEEN 0 AND 420),
 horizon_months integer NOT NULL CHECK (horizon_months BETWEEN 1 AND 420),
 current_total bigint NOT NULL,
 proposed_total bigint NOT NULL,
 remaining_installments bigint NOT NULL,
 customer_snapshot jsonb NOT NULL CHECK (jsonb_typeof(customer_snapshot) = 'object'),
 source_snapshot jsonb NOT NULL CHECK (jsonb_typeof(source_snapshot) = 'object'),
 UNIQUE (workspace_id, id),
 UNIQUE (workspace_id, opportunity_id, revision),
 CHECK ((installment_monthly = 0) = (installment_months = 0)),
 CHECK (current_total = current_monthly * horizon_months),
 CHECK (proposed_total = upfront + proposed_monthly * horizon_months + installment_monthly * least(installment_months, horizon_months)),
 CHECK (remaining_installments = installment_monthly * greatest(installment_months - horizon_months, 0)),
 FOREIGN KEY (workspace_id, customer_id, opportunity_id) REFERENCES relay_crm.opportunities(workspace_id, customer_id, id),
 FOREIGN KEY (workspace_id, actor_id) REFERENCES relay_crm.memberships(workspace_id, principal_id)
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
CREATE INDEX customer_owner ON relay_crm.customers(workspace_id, owner_id, id) WHERE archived_at IS NULL;
CREATE INDEX contact_email_lookup ON relay_crm.contacts(workspace_id, email_search) WHERE archived_at IS NULL;
CREATE INDEX contact_phone_lookup ON relay_crm.contacts(workspace_id, phone_search) WHERE archived_at IS NULL;
CREATE INDEX customer_opportunities ON relay_crm.opportunities(workspace_id, customer_id, updated_at DESC, id DESC);
CREATE INDEX pipeline_board ON relay_crm.opportunities(workspace_id, pipeline_id, stage_id, id) WHERE archived_at IS NULL;
CREATE INDEX customer_timeline ON relay_crm.activities(workspace_id, customer_id, occurred_at DESC, id DESC);
CREATE INDEX opportunity_timeline ON relay_crm.activities(workspace_id, opportunity_id, occurred_at DESC, id DESC) WHERE opportunity_id IS NOT NULL;
CREATE INDEX task_due_date ON relay_crm.tasks(workspace_id, assignee_id, due_on, id) WHERE archived_at IS NULL AND status NOT IN ('done','cancelled');
CREATE INDEX task_due_time ON relay_crm.tasks(workspace_id, assignee_id, due_at, id) WHERE archived_at IS NULL AND status NOT IN ('done','cancelled');
CREATE INDEX task_customer ON relay_crm.tasks(workspace_id, customer_id, id);
CREATE INDEX audit_history ON relay_crm.audit_events(workspace_id, entity_type, entity_id, created_at, id);
CREATE INDEX dedup_expiry ON relay_crm.request_dedup(expires_at);

CREATE FUNCTION relay_crm.prevent_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'History is append-only; use a correction or new revision' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER immutable_activities BEFORE UPDATE OR DELETE ON relay_crm.activities
 FOR EACH ROW EXECUTE FUNCTION relay_crm.prevent_history_mutation();
CREATE TRIGGER immutable_proposals BEFORE UPDATE OR DELETE ON relay_crm.proposal_snapshots
 FOR EACH ROW EXECUTE FUNCTION relay_crm.prevent_history_mutation();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON relay_crm.audit_events
 FOR EACH ROW EXECUTE FUNCTION relay_crm.prevent_history_mutation();

-- No usable application policies are shipped by this draft. Never grant owner/BYPASSRLS to the app.
DO $$
DECLARE item record;
BEGIN
 FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'relay_crm' LOOP
  EXECUTE format('ALTER TABLE relay_crm.%I ENABLE ROW LEVEL SECURITY', item.tablename);
  EXECUTE format('ALTER TABLE relay_crm.%I FORCE ROW LEVEL SECURITY', item.tablename);
 END LOOP;
END;
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA relay_crm FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA relay_crm FROM PUBLIC;
