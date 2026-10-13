-- Contact acknowledgement text lives beside localized contact-form copy in the
-- revisioned site_settings.contact_copy JSONB. Historical approved revisions and
-- rows without this key retain their shape; application/worker supply defaults.
-- No published copy is backfilled, so editor proposals remain unpublished.
alter table miracon.site_settings
  add constraint site_settings_contact_acknowledgement_copy_format check (
    contact_copy is null or (
      (contact_copy->'en'->'acknowledgement' is null or (
        jsonb_typeof(contact_copy->'en'->'acknowledgement') = 'string'
        and length(contact_copy->'en'->>'acknowledgement') between 1 and 2000
        and length(btrim(contact_copy->'en'->>'acknowledgement', E' \n\t')) > 0
        and translate(contact_copy->'en'->>'acknowledgement', E'\n\t', '') !~ '[[:cntrl:]]'
      ))
      and (contact_copy->'el'->'acknowledgement' is null or (
        jsonb_typeof(contact_copy->'el'->'acknowledgement') = 'string'
        and length(contact_copy->'el'->>'acknowledgement') between 1 and 2000
        and length(btrim(contact_copy->'el'->>'acknowledgement', E' \n\t')) > 0
        and translate(contact_copy->'el'->>'acknowledgement', E'\n\t', '') !~ '[[:cntrl:]]'
      ))
    )
  );
