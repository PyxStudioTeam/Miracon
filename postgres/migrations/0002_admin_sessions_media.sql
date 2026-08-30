create table miracon.admin_users (
  id smallint primary key default 1 check (id = 1),
  email text not null unique check (email = lower(email) and btrim(email) = email and email like '%@%'),
  password_hash text not null check (password_hash like '$argon2id$%'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table miracon.admin_sessions (
  id text primary key check (btrim(id) <> ''),
  admin_user_id smallint not null references miracon.admin_users(id) on delete cascade,
  session_token_hash bytea not null unique check (octet_length(session_token_hash) = 32),
  csrf_token_hash bytea not null check (octet_length(csrf_token_hash) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (revoked_at is null or revoked_at >= created_at)
);

create table miracon.login_throttle (
  key_hash bytea primary key check (octet_length(key_hash) = 32),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  check (blocked_until is null or blocked_until >= window_started_at)
);

create table miracon.media_files (
  id text primary key check (btrim(id) <> ''),
  relative_url text not null unique
    check (relative_url ~ '^/media/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+$' and relative_url !~ '(^|/)\.\.(/|$)'),
  relative_path text not null unique
    check (relative_path !~ '^/' and relative_path !~ '\\' and relative_path !~ '(^|/)\.\.(/|$)' and btrim(relative_path) <> ''),
  original_name text,
  mime_type text not null check (btrim(mime_type) <> ''),
  size_bytes bigint not null check (size_bytes > 0),
  sha256 bytea not null check (octet_length(sha256) = 32),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  uploaded_by smallint references miracon.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index admin_sessions_expiry_idx on miracon.admin_sessions(expires_at)
where revoked_at is null;
create index login_throttle_blocked_idx on miracon.login_throttle(blocked_until)
where blocked_until is not null;

create trigger admin_users_set_updated_at
before update on miracon.admin_users
for each row execute function miracon.set_updated_at();

create trigger login_throttle_set_updated_at
before update on miracon.login_throttle
for each row execute function miracon.set_updated_at();

create trigger media_files_set_updated_at
before update on miracon.media_files
for each row execute function miracon.set_updated_at();
