import { z } from 'zod';

export const CONTACT_DIGEST_SECRET_MIN_LENGTH = 32;

const contactSmtpEnvironmentSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.enum(['465', '587']),
  user: z.string().trim().min(1),
  password: z.string().min(1),
  from: z.string().trim().pipe(z.email().max(254)),
  to: z.string().trim().pipe(z.email().max(254)),
}).strict();

export type ContactSmtpConfig =
  | { readonly kind: 'disabled' }
  | {
    readonly kind: 'enabled';
    readonly host: string;
    readonly port: 465 | 587;
    readonly user: string;
    readonly password: string;
    readonly from: string;
    readonly to: string;
    readonly secure: boolean;
    readonly requireTls: boolean;
  };

export function getContactDigestSecret(value = process.env.CONTACT_DIGEST_SECRET): string {
  const secret = value?.trim();
  if (!secret || secret.length < CONTACT_DIGEST_SECRET_MIN_LENGTH) {
    throw new ContactConfigurationError(
      `CONTACT_DIGEST_SECRET must contain at least ${CONTACT_DIGEST_SECRET_MIN_LENGTH} characters`,
    );
  }
  return secret;
}

export function getContactSmtpConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ContactSmtpConfig {
  const enabled = environment.CONTACT_SMTP_ENABLED;
  if (enabled === undefined || enabled === 'false') return { kind: 'disabled' };
  if (enabled !== 'true') throw new ContactSmtpConfigurationError();

  const parsed = contactSmtpEnvironmentSchema.safeParse({
    host: environment.CONTACT_SMTP_HOST,
    port: environment.CONTACT_SMTP_PORT,
    user: environment.CONTACT_SMTP_USER,
    password: environment.CONTACT_SMTP_PASSWORD,
    from: environment.CONTACT_SMTP_FROM,
    to: environment.CONTACT_SMTP_TO,
  });
  if (!parsed.success) throw new ContactSmtpConfigurationError();

  if (parsed.data.port === '465') {
    return { kind: 'enabled', ...parsed.data, port: 465, secure: true, requireTls: false };
  }
  return { kind: 'enabled', ...parsed.data, port: 587, secure: false, requireTls: true };
}

export class ContactConfigurationError extends Error {
  readonly name = 'ContactConfigurationError';

  constructor(message: string) {
    super(message);
  }
}

export class ContactSmtpConfigurationError extends Error {
  readonly name = 'ContactSmtpConfigurationError';

  constructor() {
    super('Contact SMTP configuration is invalid');
  }
}
