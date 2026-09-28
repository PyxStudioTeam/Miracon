import { z } from 'zod';
import type { SiteSettings } from '../site-settings-shared';
import {
  siteSettingsSnapshotSchema,
  SINGLETON_AGGREGATE_ID,
  type SiteSettingsSnapshot,
} from './revision-contracts';

export type SiteSettingsRevisionTransportInput = {
  readonly settings: SiteSettings;
  readonly expectedRevisionId: string | null;
  readonly mediaFileIds: readonly string[];
  readonly mutationTime: string;
};

export type SiteSettingsRevisionTransport = {
  readonly aggregateType: 'site_settings';
  readonly aggregateId: typeof SINGLETON_AGGREGATE_ID;
  readonly snapshot: SiteSettingsSnapshot;
  readonly expectedRevisionId: string | null;
  readonly mediaFileIds: string[];
};

const canonicalTimestampSchema = z.iso.datetime().transform((value) => new Date(value).toISOString());

export function buildSiteSettingsRevisionTransport(
  input: SiteSettingsRevisionTransportInput,
): SiteSettingsRevisionTransport {
  const mutationTime = canonicalTimestampSchema.parse(input.mutationTime);

  const snapshot = siteSettingsSnapshotSchema.parse({
    aggregateType: 'site_settings',
    aggregateId: SINGLETON_AGGREGATE_ID,
    settings: {
      id: 1,
      footer_terms_visible: input.settings.footerTermsVisible,
      footer_terms_pdf_url: input.settings.footerTermsPdfUrl,
      footer_privacy_visible: input.settings.footerPrivacyVisible,
      footer_privacy_pdf_url: input.settings.footerPrivacyPdfUrl,
      footer_cookie_visible: input.settings.footerCookieVisible,
      footer_cookie_pdf_url: input.settings.footerCookiePdfUrl,
      site_name: input.settings.siteName,
      company_name: input.settings.companyName,
      home_copy: input.settings.homeCopy,
      golden_visa_copy: input.settings.goldenVisaCopy,
      contact_copy: input.settings.contactCopy,
      stages_copy: input.settings.stagesCopy,
      footer_phone: input.settings.footerPhone,
      footer_email: input.settings.footerEmail,
      footer_address: input.settings.footerAddress,
      facebook_visible: input.settings.facebookVisible,
      facebook_url: input.settings.facebookUrl,
      instagram_visible: input.settings.instagramVisible,
      instagram_url: input.settings.instagramUrl,
      linkedin_visible: input.settings.linkedinVisible,
      linkedin_url: input.settings.linkedinUrl,
      whatsapp_visible: input.settings.whatsappVisible,
      whatsapp_phone: input.settings.whatsappPhone,
      whatsapp_message: input.settings.whatsappMessage,
      updated_at: mutationTime,
    },
  });

  return {
    aggregateType: 'site_settings',
    aggregateId: SINGLETON_AGGREGATE_ID,
    snapshot,
    expectedRevisionId: input.expectedRevisionId,
    mediaFileIds: [...new Set(input.mediaFileIds)].sort(),
  };
}
