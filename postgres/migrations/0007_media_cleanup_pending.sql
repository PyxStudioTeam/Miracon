alter table miracon.media_files
add column deletion_pending_at timestamptz;

create index media_files_deletion_pending_idx
on miracon.media_files (deletion_pending_at, created_at, id)
where deletion_pending_at is not null;
