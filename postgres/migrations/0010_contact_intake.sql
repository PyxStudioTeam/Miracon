create table miracon.contact_challenges (
  token_digest bytea primary key check (octet_length(token_digest) = 32),
  client_digest bytea not null check (octet_length(client_digest) = 32),
  created_at timestamptz not null,
  not_before timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (not_before > created_at),
  check (expires_at > not_before),
  check (consumed_at is null or consumed_at >= created_at)
);

create index contact_challenges_expiry_idx
  on miracon.contact_challenges(expires_at);

create table miracon.contact_submissions (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 120),
  email text check (email is null or char_length(email) between 3 and 254),
  phone text check (phone is null or char_length(phone) between 1 and 40),
  message text not null check (char_length(message) between 1 and 3000),
  consented_at timestamptz not null,
  locale text not null check (locale in ('en', 'el')),
  source_path text not null check (char_length(source_path) between 1 and 2048 and source_path like '/%'),
  client_digest bytea not null check (octet_length(client_digest) = 32),
  duplicate_digest bytea not null check (octet_length(duplicate_digest) = 32),
  created_at timestamptz not null,
  check (email is not null or phone is not null),
  check (consented_at = created_at)
);

create index contact_submissions_client_created_idx
  on miracon.contact_submissions(client_digest, created_at desc);

create index contact_submissions_duplicate_created_idx
  on miracon.contact_submissions(duplicate_digest, created_at desc);

create index contact_submissions_retention_idx
  on miracon.contact_submissions(created_at, id);
