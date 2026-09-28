import { defaultSiteSettings, isValidTermsPdfUrl, externalSocialUrl, whatsappLink } from './site-settings-shared';
import type { SiteSettings } from './site-settings-shared';

export { defaultSiteSettings, isValidTermsPdfUrl, externalSocialUrl, whatsappLink } from './site-settings-shared';
export type { SiteSettings } from './site-settings-shared';

export function mapSiteSettings(row: Record<string, unknown> | null | undefined): SiteSettings {
  const footerTermsPdfUrl = String(row?.footer_terms_pdf_url ?? '').trim();
  const footerPrivacyPdfUrl = String(row?.footer_privacy_pdf_url ?? '').trim();
  const footerCookiePdfUrl = String(row?.footer_cookie_pdf_url ?? '').trim();
  // Columns added after the original singleton have defaults; legacy snapshots
  // and migration-free local previews retain the public copy they started with.
  return {
    footerTermsVisible: Boolean(row?.footer_terms_visible) && isValidTermsPdfUrl(footerTermsPdfUrl),
    footerTermsPdfUrl: isValidTermsPdfUrl(footerTermsPdfUrl) ? footerTermsPdfUrl : '',
    footerPrivacyVisible: Boolean(row?.footer_privacy_visible) && isValidTermsPdfUrl(footerPrivacyPdfUrl),
    footerPrivacyPdfUrl: isValidTermsPdfUrl(footerPrivacyPdfUrl) ? footerPrivacyPdfUrl : '',
    footerCookieVisible: Boolean(row?.footer_cookie_visible) && isValidTermsPdfUrl(footerCookiePdfUrl),
    footerCookiePdfUrl: isValidTermsPdfUrl(footerCookiePdfUrl) ? footerCookiePdfUrl : '',
    siteName: String(row?.site_name ?? defaultSiteSettings.siteName),
    companyName: String(row?.company_name ?? defaultSiteSettings.companyName),
    homeCopy: (row?.home_copy ?? defaultSiteSettings.homeCopy) as SiteSettings['homeCopy'],
    goldenVisaCopy: (row?.golden_visa_copy ?? defaultSiteSettings.goldenVisaCopy) as SiteSettings['goldenVisaCopy'],
    contactCopy: (row?.contact_copy ?? defaultSiteSettings.contactCopy) as SiteSettings['contactCopy'],
    stagesCopy: (row?.stages_copy ?? defaultSiteSettings.stagesCopy) as SiteSettings['stagesCopy'],
    footerPhone: String(row?.footer_phone ?? defaultSiteSettings.footerPhone),
    footerEmail: String(row?.footer_email ?? defaultSiteSettings.footerEmail),
    footerAddress: (row?.footer_address ?? defaultSiteSettings.footerAddress) as SiteSettings['footerAddress'],
    facebookVisible: Boolean(row?.facebook_visible) && externalSocialUrl(String(row?.facebook_url ?? '')) !== null,
    facebookUrl: String(row?.facebook_url ?? ''),
    instagramVisible: Boolean(row?.instagram_visible) && externalSocialUrl(String(row?.instagram_url ?? '')) !== null,
    instagramUrl: String(row?.instagram_url ?? ''),
    linkedinVisible: Boolean(row?.linkedin_visible) && externalSocialUrl(String(row?.linkedin_url ?? '')) !== null,
    linkedinUrl: String(row?.linkedin_url ?? ''),
    whatsappVisible: Boolean(row?.whatsapp_visible ?? defaultSiteSettings.whatsappVisible) && whatsappLink({
      whatsappPhone: String(row?.whatsapp_phone ?? defaultSiteSettings.whatsappPhone),
      whatsappMessage: String(row?.whatsapp_message ?? ''),
    }) !== null,
    whatsappPhone: String(row?.whatsapp_phone ?? defaultSiteSettings.whatsappPhone),
    whatsappMessage: String(row?.whatsapp_message ?? ''),
  };
}

export async function getSiteSettings(): Promise<SiteSettings> {
  if (import.meta.env.DEV && !process.env.DATABASE_URL) return defaultSiteSettings;
  const { getDatabasePool } = await import('./server/database');
  const { getSiteSettings: getSettings } = await import('./server/site-settings');
  return getSettings(getDatabasePool());
}
