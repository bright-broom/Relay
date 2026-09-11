-- Run once against a dedicated Relay database using the migration owner.
CREATE SCHEMA IF NOT EXISTS relay_private;
REVOKE ALL ON SCHEMA relay_private FROM PUBLIC;

CREATE TABLE relay_private.oauth_attempts (
  token_hash text PRIMARY KEY, state text NOT NULL, verifier text NOT NULL,
  nonce text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE relay_private.sessions (
  token_hash text PRIMARY KEY, subject text NOT NULL, email text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE relay_private.line_codes (
  token_hash text PRIMARY KEY, owner_email text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('user', 'group')),
  expires_at timestamptz NOT NULL, UNIQUE(owner_email, kind)
);
CREATE TABLE relay_private.line_destinations (
  id uuid PRIMARY KEY, owner_email text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('user', 'group')),
  line_id text NOT NULL, actor_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_email, kind)
);
CREATE TABLE relay_private.line_events (
  event_id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE relay_private.notifications (
  id uuid PRIMARY KEY, owner_email text NOT NULL,
  destination_id uuid NOT NULL REFERENCES relay_private.line_destinations(id) ON DELETE CASCADE,
  line_id text NOT NULL, locale text NOT NULL CHECK (locale IN ('ja', 'en')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0, lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON relay_private.notifications(owner_email, created_at);
-- No objects in the public schema; browser/PostgREST clients get no grants.
REVOKE ALL ON ALL TABLES IN SCHEMA relay_private FROM PUBLIC;
