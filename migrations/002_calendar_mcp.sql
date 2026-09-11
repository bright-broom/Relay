CREATE TABLE relay_private.calendar_oauth (
 token_hash text PRIMARY KEY, owner_subject text NOT NULL, state text NOT NULL,
 verifier text NOT NULL, nonce text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE relay_private.calendar_connections (
 owner_subject text PRIMARY KEY, refresh_cipher text NOT NULL, connected_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE relay_private.schedule_proposals (
 id uuid PRIMARY KEY, owner_subject text NOT NULL, title text NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, time_zone text NOT NULL,
 buffer_minutes integer NOT NULL CHECK(buffer_minutes BETWEEN 0 AND 60),
 state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','booked')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at)
);
CREATE INDEX ON relay_private.schedule_proposals(owner_subject, starts_at);
CREATE TABLE relay_private.mcp_tokens (
 id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE, owner_subject text NOT NULL,
 owner_email text NOT NULL, permission text NOT NULL CHECK(permission IN ('read','book')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON relay_private.mcp_tokens(owner_subject);
CREATE TABLE relay_private.integration_usage (
 owner_subject text NOT NULL, window_start timestamptz NOT NULL, count integer NOT NULL,
 PRIMARY KEY(owner_subject,window_start)
);
REVOKE ALL ON ALL TABLES IN SCHEMA relay_private FROM PUBLIC;
