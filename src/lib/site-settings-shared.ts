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

export function isValidTermsPdfUrl(value: string): boolean {
  if (value.startsWith('/media/')) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
