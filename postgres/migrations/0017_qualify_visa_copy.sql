-- Replace outdated default marketing copy without overwriting site-owner edits.
-- Each field changes only when it still equals the shipped default.
do $$
declare
  replacement record;
begin
  for replacement in
    select * from (values
      ('en', 'visaDescription', $old$EU residency through property investment — from €250,000$old$, $new$Greek residency through qualifying property investment, subject to current rules$new$),
      ('en', 'visaResidencyText', $old$Greece offers one of Europe's most accessible residency-by-investment programmes. Purchase qualifying real estate and receive a 5-year renewable residence permit for your entire family — no minimum stay required$old$, $new$A qualifying real estate investment may support an application for a Greek residence permit. Approval and renewal depend on meeting the legal requirements$new$),
      ('en', 'visaThresholdText', $old$The minimum qualifying investment is €250,000. Selected residences at Monastiriou 4 in central Thessaloniki meet this threshold — making MIRACON projects an ideal entry point into the programme$old$, $new$Investment thresholds vary by property, location and legal category. Check current rules and confirm the eligibility of any project before investing$new$),
      ('en', 'visaFamilyText', $old$The residence permit covers the investor, spouse, children under 21, and both sets of parents. No additional fees per family member. The permit is renewed every 5 years as long as the property is owned$old$, $new$Eligible family members may apply under the programme, subject to the current rules. Confirm individual eligibility, fees and renewal requirements before applying$new$),
      ('en', 'visaSchengenText', $old$As a Greek residence permit holder you can travel freely across 26 Schengen countries without a visa. No minimum stay in Greece required — visit when you wish, live where you want$old$, $new$A Greek residence permit may allow short stays in the Schengen Area under the applicable entry and stay rules$new$),
      ('el', 'visaDescription', $old$Άδεια διαμονής στην ΕΕ μέσω επένδυσης σε ακίνητο — από €250.000$old$, $new$Ελληνική άδεια διαμονής μέσω επιλέξιμης επένδυσης σε ακίνητο, σύμφωνα με τους ισχύοντες κανόνες$new$),
      ('el', 'visaResidencyText', $old$Η Ελλάδα προσφέρει ένα από τα πιο προσιτά ευρωπαϊκά προγράμματα διαμονής μέσω επένδυσης. Αγοράστε επιλέξιμο ακίνητο και αποκτήστε ανανεώσιμη πενταετή άδεια διαμονής για όλη την οικογένεια — χωρίς ελάχιστη υποχρεωτική παραμονή$old$, $new$Μια επιλέξιμη επένδυση σε ακίνητο μπορεί να στηρίξει αίτηση για ελληνική άδεια διαμονής. Η έγκριση και η ανανέωση εξαρτώνται από τις νόμιμες προϋποθέσεις$new$),
      ('el', 'visaThresholdText', $old$Η ελάχιστη επιλέξιμη επένδυση είναι €250.000. Επιλεγμένες κατοικίες στη Μοναστηρίου 4, στο κέντρο της Θεσσαλονίκης, πληρούν αυτό το όριο και αποτελούν ιδανική είσοδο στο πρόγραμμα$old$, $new$Τα επενδυτικά όρια διαφέρουν ανάλογα με το ακίνητο, την περιοχή και τη νομική κατηγορία. Ελέγξτε τους ισχύοντες κανόνες και την επιλεξιμότητα κάθε έργου πριν επενδύσετε$new$),
      ('el', 'visaFamilyText', $old$Η άδεια διαμονής καλύπτει τον επενδυτή, τον/τη σύζυγο, τα παιδιά κάτω των 21 ετών και τους γονείς και των δύο συζύγων. Ανανεώνεται κάθε 5 χρόνια όσο το ακίνητο παραμένει στην ιδιοκτησία σας$old$, $new$Τα επιλέξιμα μέλη της οικογένειας μπορούν να υποβάλουν αίτηση σύμφωνα με τους ισχύοντες κανόνες. Ελέγξτε ξεχωριστά την επιλεξιμότητα, τα τέλη και τις προϋποθέσεις ανανέωσης$new$),
      ('el', 'visaSchengenText', $old$Με ελληνική άδεια διαμονής μπορείτε να ταξιδεύετε χωρίς βίζα στις χώρες της ζώνης Σένγκεν. Δεν απαιτείται ελάχιστη παραμονή στην Ελλάδα — επισκέπτεστε τη χώρα όποτε θέλετε$old$, $new$Μια ελληνική άδεια διαμονής μπορεί να επιτρέπει σύντομες επισκέψεις στη ζώνη Σένγκεν σύμφωνα με τους ισχύοντες κανόνες εισόδου και παραμονής$new$)
    ) as changes(locale, field, previous, revised)
  loop
    update miracon.site_settings
    set home_copy = jsonb_set(home_copy, array[replacement.locale, replacement.field], to_jsonb(replacement.revised), false)
    where id = 1 and home_copy #>> array[replacement.locale, replacement.field] = replacement.previous;
  end loop;

  for replacement in
    select * from (values
      ('en', 'heroText', $old$Secure your Greek Golden Visa through prime real estate investments in Thessaloniki & Halkidiki with MIRACON Constructions$old$, $new$Explore properties in Thessaloniki and Halkidiki with MIRACON Constructions. Golden Visa eligibility is assessed individually$new$),
      ('en', 'familyDescription', $old$Eligibility for the Golden Visa extends not only to the property owner, but also to:$old$, $new$Eligible family members may apply under the current programme rules:$new$),
      ('en', 'familyInclusionText', $old$The Greek Golden Visa grants residency rights to the investor and eligible family members under a single application structure, providing long-term flexibility, mobility within the Schengen Area and access to local services$old$, $new$Investors and qualifying family members may apply for Greek residency, subject to individual eligibility, applicable fees and current immigration rules$new$),
      ('en', 'thresholdText', $old$investment option for obtaining a Golden Visa in the European Union$old$, $new$threshold available only for qualifying property categories under Greek law$new$),
      ('en', 'thresholdAffordable', $old$- the most affordable$old$, $new$— subject to eligibility$new$),
      ('en', 'thresholdNote', $old$For standard residential property purchases in most regions of Greece, the minimum investment is$old$, $new$Other property categories generally require$new$),
      ('el', 'heroText', $old$Εξασφαλίστε την ελληνική Golden Visa μέσω επενδύσεων σε προνομιακά ακίνητα στη Θεσσαλονίκη και τη Χαλκιδική με τη MIRACON Constructions$old$, $new$Εξερευνήστε ακίνητα στη Θεσσαλονίκη και τη Χαλκιδική με τη MIRACON Constructions. Η επιλεξιμότητα για Golden Visa εξετάζεται ξεχωριστά$new$),
      ('el', 'familyDescription', $old$Η Golden Visa καλύπτει όχι μόνο τον ιδιοκτήτη του ακινήτου αλλά και:$old$, $new$Επιλέξιμα μέλη της οικογένειας μπορούν να υποβάλουν αίτηση σύμφωνα με τους ισχύοντες κανόνες:$new$),
      ('el', 'familyInclusionText', $old$Η ελληνική Golden Visa παρέχει δικαιώματα διαμονής στον επενδυτή και στα επιλέξιμα μέλη της οικογένειας με μία ενιαία αίτηση, προσφέροντας μακροχρόνια ευελιξία, μετακίνηση στη ζώνη Σένγκεν και πρόσβαση σε τοπικές υπηρεσίες$old$, $new$Ο επενδυτής και τα επιλέξιμα μέλη της οικογένειας μπορούν να υποβάλουν αίτηση για ελληνική άδεια διαμονής, σύμφωνα με τα ατομικά κριτήρια, τα ισχύοντα τέλη και τη νομοθεσία$new$),
      ('el', 'thresholdText', $old$επενδυτική επιλογή για την απόκτηση Golden Visa στην Ευρωπαϊκή Ένωση$old$, $new$όριο διαθέσιμο μόνο για επιλέξιμες κατηγορίες ακινήτων σύμφωνα με την ελληνική νομοθεσία$new$),
      ('el', 'thresholdAffordable', $old$- η πιο προσιτή επιλογή$old$, $new$— υπό προϋποθέσεις επιλεξιμότητας$new$),
      ('el', 'thresholdNote', $old$Για την αγορά συνήθων κατοικιών στις περισσότερες περιοχές της Ελλάδας, η ελάχιστη επένδυση είναι$old$, $new$Άλλες κατηγορίες ακινήτων απαιτούν γενικά$new$)
    ) as changes(locale, field, previous, revised)
  loop
    update miracon.site_settings
    set golden_visa_copy = jsonb_set(golden_visa_copy, array[replacement.locale, replacement.field], to_jsonb(replacement.revised), false)
    where id = 1 and golden_visa_copy #>> array[replacement.locale, replacement.field] = replacement.previous;
  end loop;
end;
$$;
