-- Historical submissions remain readable; all new contact requests need both details.
alter table miracon.contact_submissions
  add constraint contact_submissions_complete_contact_check
  check (email is not null and phone is not null) not valid;
