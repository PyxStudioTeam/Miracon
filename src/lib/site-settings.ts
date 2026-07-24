import { createPublicSupabaseClient } from './supabase';

export type SiteSettings = {
  footerTermsVisible: boolean;
  footerTermsPdfUrl: string;
  footerPrivacyVisible: boolean;
  footerPrivacyPdfUrl: string;
  footerCookieVisible: boolean;
  footerCookiePdfUrl: string;
};

export const defaultSiteSettings: SiteSettings = {
  footerTermsVisible: false,
  footerTermsPdfUrl: '',
  footerPrivacyVisible: false,
  footerPrivacyPdfUrl: '',
  footerCookieVisible: false,
  footerCookiePdfUrl: '',
};

export function isValidTermsPdfUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function mapSiteSettings(row: Record<string, unknown> | null | undefined): SiteSettings {
  const footerTermsPdfUrl = String(row?.footer_terms_pdf_url ?? '').trim();
  const footerPrivacyPdfUrl = String(row?.footer_privacy_pdf_url ?? '').trim();
  const footerCookiePdfUrl = String(row?.footer_cookie_pdf_url ?? '').trim();
  return {
    footerTermsVisible: Boolean(row?.footer_terms_visible) && isValidTermsPdfUrl(footerTermsPdfUrl),
    footerTermsPdfUrl: isValidTermsPdfUrl(footerTermsPdfUrl) ? footerTermsPdfUrl : '',
    footerPrivacyVisible: Boolean(row?.footer_privacy_visible) && isValidTermsPdfUrl(footerPrivacyPdfUrl),
    footerPrivacyPdfUrl: isValidTermsPdfUrl(footerPrivacyPdfUrl) ? footerPrivacyPdfUrl : '',
    footerCookieVisible: Boolean(row?.footer_cookie_visible) && isValidTermsPdfUrl(footerCookiePdfUrl),
    footerCookiePdfUrl: isValidTermsPdfUrl(footerCookiePdfUrl) ? footerCookiePdfUrl : '',
  };
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const supabase = createPublicSupabaseClient();
  if (!supabase) return defaultSiteSettings;

  const { data, error } = await supabase
    .from('site_settings')
    .select('footer_terms_visible, footer_terms_pdf_url, footer_privacy_visible, footer_privacy_pdf_url, footer_cookie_visible, footer_cookie_pdf_url')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) return defaultSiteSettings;
  return mapSiteSettings(data);
}
