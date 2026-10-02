export const CONTACT_DIGEST_SECRET_MIN_LENGTH = 32;

export function getContactDigestSecret(value = process.env.CONTACT_DIGEST_SECRET): string {
  const secret = value?.trim();
  if (!secret || secret.length < CONTACT_DIGEST_SECRET_MIN_LENGTH) {
    throw new ContactConfigurationError(
      `CONTACT_DIGEST_SECRET must contain at least ${CONTACT_DIGEST_SECRET_MIN_LENGTH} characters`,
    );
  }
  return secret;
}

export class ContactConfigurationError extends Error {
  readonly name = 'ContactConfigurationError';

  constructor(message: string) {
    super(message);
  }
}

