import { getContactDescriptionLines, getMessages, type MessageKey, type SiteLocale } from './i18n';

export type Localized<T> = Record<SiteLocale, T>;

export const homeCopyKeys = [
  'heroLocation', 'heroTitleLine1', 'heroTitleLine2', 'projectsTitle', 'projectsDescription',
  'aboutTagline', 'aboutParagraph1', 'aboutParagraph2',
  'benefitDirectTitle', 'benefitDirectText', 'benefitLegalTitle', 'benefitLegalText',
  'benefitPersonalTitle', 'benefitPersonalText', 'benefitLocationTitle', 'benefitLocationText',
  'visaDescription', 'visaResidencyTitle', 'visaResidencyText', 'visaThresholdTitle',
  'visaThresholdText', 'visaFamilyTitle', 'visaFamilyText', 'visaSchengenTitle', 'visaSchengenText',
] as const;
export type HomeCopy = Record<(typeof homeCopyKeys)[number], string>;

export const goldenVisaCopyKeys = [
  'heroTitleLine1', 'heroTitleLine2', 'heroText', 'thresholdText', 'thresholdAffordable',
  'thresholdNote', 'familyTitle', 'familyDescription', 'familyInclusion', 'familyInclusionText',
  'featuredProperty', 'properties', 'propertiesDescription',
] as const;
export type GoldenVisaCopy = Record<(typeof goldenVisaCopyKeys)[number], string>;

export type ContactCopy = { title: string; description: string };
export type StageCopy = { title: string; description: string; steps: [
  { title: string; text: string }, { title: string; text: string }, { title: string; text: string },
  { title: string; text: string }, { title: string; text: string },
] };

export type SiteSettings = {
  footerTermsVisible: boolean;
  footerTermsPdfUrl: string;
  footerPrivacyVisible: boolean;
  footerPrivacyPdfUrl: string;
  footerCookieVisible: boolean;
  footerCookiePdfUrl: string;
  siteName: string;
  companyName: string;
  homeCopy: Localized<HomeCopy>;
  goldenVisaCopy: Localized<GoldenVisaCopy>;
  contactCopy: Localized<ContactCopy>;
  stagesCopy: Localized<StageCopy>;
  footerPhone: string;
  footerEmail: string;
  footerAddress: Localized<string>;
  facebookVisible: boolean;
  facebookUrl: string;
  instagramVisible: boolean;
  instagramUrl: string;
  linkedinVisible: boolean;
  linkedinUrl: string;
  whatsappVisible: boolean;
  whatsappPhone: string;
  whatsappMessage: string;
};

const localize = <T>(make: (locale: SiteLocale) => T): Localized<T> => ({ en: make('en'), el: make('el') });
const copyFromMessages = <Key extends string>(locale: SiteLocale, prefix: string, keys: readonly Key[]): Record<Key, string> => {
  const messages = getMessages(locale);
  return Object.fromEntries(keys.map((key) => [key, messages[`${prefix}.${key}` as MessageKey]])) as Record<Key, string>;
};

export const defaultSiteSettings: SiteSettings = {
  footerTermsVisible: false,
  footerTermsPdfUrl: '',
  footerPrivacyVisible: false,
  footerPrivacyPdfUrl: '',
  footerCookieVisible: false,
  footerCookiePdfUrl: '',
  siteName: 'MIRACON',
  companyName: 'MIRACON Constructions',
  homeCopy: localize((locale) => copyFromMessages(locale, 'home', homeCopyKeys)),
  goldenVisaCopy: localize((locale) => copyFromMessages(locale, 'gv', goldenVisaCopyKeys)),
  contactCopy: localize((locale) => ({ title: getMessages(locale)['form.title'], description: getContactDescriptionLines(locale).join(' ') })),
  stagesCopy: localize((locale) => {
    const messages = getMessages(locale);
    const stageKeys = ['consultation', 'reservation', 'dueDiligence', 'contract', 'handover'] as const;
    return {
      title: messages['stages.title'], description: messages['stages.description'],
      steps: stageKeys.map((key) => ({ title: messages[`stages.${key}`], text: messages[`stages.${key}Text`] })) as StageCopy['steps'],
    };
  }),
  footerPhone: '+30 695 534 0416',
  footerEmail: 'info@miracon.gr',
  footerAddress: localize((locale) => getMessages(locale)['common.address']),
  facebookVisible: false,
  facebookUrl: '',
  instagramVisible: false,
  instagramUrl: '',
  linkedinVisible: false,
  linkedinUrl: '',
  whatsappVisible: true,
  whatsappPhone: '306955340416',
  whatsappMessage: '',
};

export function brandCopy(value: string, settings: Pick<SiteSettings, 'siteName' | 'companyName'>): string {
  if (settings.siteName === 'MIRACON' && settings.companyName === 'MIRACON Constructions') return value;
  return value
    .replaceAll('MIRACON Constructions', settings.companyName)
    .replaceAll('Miracon Constructions', settings.companyName)
    .replaceAll('MIRACON', settings.siteName);
}

export function isValidTermsPdfUrl(value: string): boolean {
  if (value.startsWith('/media/')) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function externalSocialUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function whatsappLink(settings: Pick<SiteSettings, 'whatsappPhone' | 'whatsappMessage'>): string | null {
  const digits = settings.whatsappPhone.replace(/[^0-9]/g, '');
  if (!digits || digits.length < 7 || digits.length > 15) return null;
  return `https://wa.me/${digits}${settings.whatsappMessage.trim() ? `?text=${encodeURIComponent(settings.whatsappMessage.trim())}` : ''}`;
}
