-- Change only the original catalog copy; leave administrator-edited descriptions untouched.
update miracon.projects
set short_description = 'Contemporary city apartments in the heart of Thessaloniki'
where id = 'monastiriou-4-residences'
  and short_description = 'Contemporary city apartments in the heart of Thessaloniki. High rental demand year-round from students, professionals and tourists. Golden Visa eligible from €250,000';

update miracon.projects
set translations = jsonb_set(translations, '{el,shortDescription}', to_jsonb('Σύγχρονα αστικά διαμερίσματα στην καρδιά της Θεσσαλονίκης'::text), false)
where id = 'monastiriou-4-residences'
  and translations #>> '{el,shortDescription}' = 'Σύγχρονα αστικά διαμερίσματα στην καρδιά της Θεσσαλονίκης. Υψηλή ζήτηση για μίσθωση όλο τον χρόνο από φοιτητές, επαγγελματίες και τουρίστες. Επιλέξιμα για Golden Visa από 250.000 €';
