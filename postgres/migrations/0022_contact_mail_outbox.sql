create table miracon.contact_mail_jobs (
  contact_id uuid not null references miracon.contact_submissions(id) on delete cascade,
  kind text not null check (kind in ('team', 'ack')),
  state text not null default 'queued' check (state in ('queued', 'leased', 'sent', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null,
  lease_token uuid,
  lease_expires_at timestamptz,
  sent_at timestamptz,
  last_failure_category text,
  created_at timestamptz not null,
  primary key (contact_id, kind),
  check ((lease_token is null) = (lease_expires_at is null))
);

create index contact_mail_jobs_queued_idx
  on miracon.contact_mail_jobs(next_attempt_at, created_at, contact_id, kind)
  where state = 'queued';

create index contact_mail_jobs_leased_idx
  on miracon.contact_mail_jobs(lease_expires_at)
  where state = 'leased';

create index contact_submissions_ack_email_idx
  on miracon.contact_submissions(lower(btrim(email)), created_at desc, id)
  where email is not null;
