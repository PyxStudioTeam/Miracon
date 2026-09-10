import nodemailer from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { ContactId, ContactSubmissionInput } from './contact-contracts';
import { getContactSmtpConfig } from './contact-config';
import type { ContactSmtpConfig } from './contact-config';

const SMTP_CONNECTION_TIMEOUT_MS = 5_000;
const SMTP_DNS_TIMEOUT_MS = 5_000;
const SMTP_GREETING_TIMEOUT_MS = 5_000;
const SMTP_SOCKET_TIMEOUT_MS = 10_000;

export type AcceptedContactNotification = Pick<
  ContactSubmissionInput,
  'name' | 'email' | 'phone' | 'message' | 'locale' | 'sourcePath'
> & {
  readonly id: ContactId;
  readonly acceptedAt: Date;
};

export type ContactMail = {
  readonly from: string;
  readonly to: string;
  readonly replyTo?: string;
  readonly subject: string;
  readonly text: string;
};

type ContactMailDelivery = {
  readonly acceptedCount: number;
  readonly rejectedCount: number;
};

export interface ContactMailTransport {
  send(message: ContactMail): Promise<ContactMailDelivery>;
}

type ContactNotificationDependencies = {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly createTransport: (config: Extract<ContactSmtpConfig, { readonly kind: 'enabled' }>) => ContactMailTransport;
};

export type ContactNotificationFailureCategory = 'transport_failed' | 'recipient_rejected';

export class ContactNotificationError extends Error {
  readonly name = 'ContactNotificationError';

  constructor(readonly category: ContactNotificationFailureCategory) {
    super('Contact notification delivery failed');
  }
}

export async function notifyAcceptedContact(
  contact: AcceptedContactNotification,
  dependencies: ContactNotificationDependencies = {
    environment: process.env,
    createTransport: createSmtpTransport,
  },
): Promise<void> {
  const config = getContactSmtpConfig(dependencies.environment);
  if (config.kind === 'disabled') return;

  let delivery: ContactMailDelivery;
  try {
    delivery = await dependencies.createTransport(config).send(contactMail(config, contact));
  } catch (error) {
    if (error instanceof ContactNotificationError) throw error;
    throw new ContactNotificationError('transport_failed');
  }
  if (delivery.acceptedCount !== 1 || delivery.rejectedCount !== 0) {
    throw new ContactNotificationError('recipient_rejected');
  }
}

function createSmtpTransport(config: Extract<ContactSmtpConfig, { readonly kind: 'enabled' }>): ContactMailTransport {
  const options: SMTPTransport.Options = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    ignoreTLS: false,
    auth: { user: config.user, pass: config.password },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    dnsTimeout: SMTP_DNS_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
  };
  const transporter = nodemailer.createTransport(new SMTPTransport(options));
  return {
    send: async (message) => {
      const info = await transporter.sendMail(message);
      return { acceptedCount: info.accepted.length, rejectedCount: info.rejected.length };
    },
  };
}

function contactMail(
  config: Extract<ContactSmtpConfig, { readonly kind: 'enabled' }>,
  contact: AcceptedContactNotification,
): ContactMail {
  return {
    from: config.from,
    to: config.to,
    ...(contact.email ? { replyTo: contact.email } : {}),
    subject: `New contact submission ${contact.id}`,
    text: [
      `Contact ID: ${contact.id}`,
      `Accepted at: ${contact.acceptedAt.toISOString()}`,
      `Locale: ${contact.locale}`,
      `Source: ${contact.sourcePath}`,
      `Name: ${contact.name}`,
      `Email: ${contact.email ?? 'Not provided'}`,
      `Phone: ${contact.phone ?? 'Not provided'}`,
      '',
      'Message:',
      contact.message,
    ].join('\n'),
  };
}
