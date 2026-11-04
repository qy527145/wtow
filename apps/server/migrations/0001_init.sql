CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE project_role   AS ENUM ('tester','assigner','developer','admin');
CREATE TYPE raw_status     AS ENUM ('Pending','Claimed','Processed','Merged','Duplicate','Ignored');
CREATE TYPE exec_status    AS ENUM ('Queued','InProgress','Done','Cancelled');
CREATE TYPE link_relation  AS ENUM ('split','merge');
CREATE TYPE owner_type     AS ENUM ('raw','exec');
CREATE TYPE actor_type     AS ENUM ('human','agent');

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id                   BIGSERIAL PRIMARY KEY,
  slug                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  require_human_triage BOOLEAN NOT NULL DEFAULT false,
  created_by           BIGINT NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at          TIMESTAMPTZ
);

CREATE TABLE memberships (
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  roles      project_role[] NOT NULL CHECK (cardinality(roles) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE api_tokens (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   BYTEA NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  roles        project_role[] NOT NULL,
  read_only    BOOLEAN NOT NULL DEFAULT false,
  actor_type   actor_type NOT NULL DEFAULT 'agent',
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id         BYTEA PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_counters (
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  next_seq   BIGINT NOT NULL DEFAULT 1000,
  PRIMARY KEY (project_id, kind)
);

CREATE TABLE raw_compositions (
  project_id       BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id               TEXT NOT NULL,
  seq              BIGINT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  status           raw_status NOT NULL DEFAULT 'Pending',
  reporter_id      BIGINT NOT NULL REFERENCES users(id),
  claimed_by       BIGINT REFERENCES users(id),
  claimed_at       TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  merged_into_id   TEXT,
  triage_reason    TEXT,
  version          INT NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, seq),
  FOREIGN KEY (project_id, merged_into_id) REFERENCES raw_compositions (project_id, id),
  CHECK ((status = 'Claimed') = (claimed_by IS NOT NULL)),
  CHECK ((status IN ('Merged','Duplicate')) = (merged_into_id IS NOT NULL))
);

CREATE INDEX raw_project_status_idx ON raw_compositions (project_id, status, created_at DESC);
CREATE INDEX raw_title_trgm_idx     ON raw_compositions USING GIN (title gin_trgm_ops);
CREATE INDEX raw_desc_trgm_idx      ON raw_compositions USING GIN (description gin_trgm_ops);

CREATE TABLE exec_compositions (
  project_id       BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id               TEXT NOT NULL,
  seq              BIGINT NOT NULL,
  instruction      TEXT NOT NULL,
  target_resources TEXT[] NOT NULL DEFAULT '{}',
  status           exec_status NOT NULL DEFAULT 'Queued',
  priority         SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
  assigner_id      BIGINT NOT NULL REFERENCES users(id),
  developer_id     BIGINT REFERENCES users(id),
  claimed_at       TIMESTAMPTZ,
  developer_notes  TEXT,
  result_links     JSONB NOT NULL DEFAULT '[]',
  version          INT NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, seq)
);

CREATE INDEX exec_pool_idx    ON exec_compositions (project_id, status, priority, created_at);
CREATE INDEX exec_targets_idx ON exec_compositions USING GIN (target_resources);

CREATE TABLE raw_exec_links (
  project_id BIGINT NOT NULL,
  raw_id     TEXT NOT NULL,
  exec_id    TEXT NOT NULL,
  relation   link_relation NOT NULL,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, raw_id, exec_id),
  FOREIGN KEY (project_id, raw_id) REFERENCES raw_compositions (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, exec_id) REFERENCES exec_compositions (project_id, id) ON DELETE CASCADE
);

CREATE INDEX links_by_exec_idx ON raw_exec_links (project_id, exec_id);

CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_type  owner_type,
  owner_id    TEXT,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL,
  storage_key TEXT NOT NULL,
  uploaded_by BIGINT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attach_owner_idx ON attachments (project_id, owner_type, owner_id);

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id    BIGINT NOT NULL REFERENCES users(id),
  token_id    BIGINT REFERENCES api_tokens(id),
  actor_type  actor_type NOT NULL,
  action      TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id   TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_project_time_idx ON audit_logs (project_id, created_at DESC);

CREATE TABLE idempotency_keys (
  project_id   BIGINT NOT NULL,
  user_id      BIGINT NOT NULL,
  key          TEXT NOT NULL,
  endpoint     TEXT NOT NULL,
  request_hash BYTEA NOT NULL,
  response     JSONB,
  status_code  SMALLINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id, key)
);
