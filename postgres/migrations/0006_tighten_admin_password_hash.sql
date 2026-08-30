alter table miracon.admin_users
drop constraint admin_users_password_hash_check;

alter table miracon.admin_users
add constraint admin_users_password_hash_check
check (
  password_hash ~ '^[$]argon2id[$]v=19[$][mtp]=[1-9][0-9]*(,[mtp]=[1-9][0-9]*){2}[$][A-Za-z0-9+/]+={0,2}[$][A-Za-z0-9+/]+={0,2}$'
  and split_part(password_hash, '$', 4) ~ '(^|,)m=[1-9][0-9]*(,|$)'
  and split_part(password_hash, '$', 4) ~ '(^|,)t=[1-9][0-9]*(,|$)'
  and split_part(password_hash, '$', 4) ~ '(^|,)p=[1-9][0-9]*(,|$)'
);
