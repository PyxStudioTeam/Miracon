-- Preserve existing challenges and expiry while removing the obsolete dwell column.
alter table miracon.contact_challenges
  drop column not_before,
  add constraint contact_challenges_expiry_after_creation_check
  check (expires_at > created_at);
