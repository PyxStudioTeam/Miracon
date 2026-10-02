import nodemailer from 'nodemailer';
import { z } from 'zod';

const smtpEnvironmentSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.enum(['465', '587']),
  user: z.string().trim().min(1),
  password: z.string().min(1),
  from: z.string().trim().pipe(z.email().max(254)),
  to: z.string().trim().pipe(z.email().max(254)),
}).strict();

export class ContactMailConfigurationError extends Error {
  constructor() {
    super('Contact SMTP configuration is invalid');
    this.name = 'ContactMailConfigurationError';
  }
}

export class ContactMailDeliveryError extends Error {
  constructor(category) {
    super('Contact mail delivery failed');
    this.name = 'ContactMailDeliveryError';
    this.category = category;
  }
}

/** Matches the application SMTP environment contract. No credentials are returned when disabled. */
export function getContactMailConfig(environment = process.env) {
  const enabled = environment.CONTACT_SMTP_ENABLED;
  if (enabled === undefined || enabled === 'false') return { kind: 'disabled' };
  if (enabled !== 'true') throw new ContactMailConfigurationError();

  const parsed = smtpEnvironmentSchema.safeParse({
    host: environment.CONTACT_SMTP_HOST,
    port: environment.CONTACT_SMTP_PORT,
    user: environment.CONTACT_SMTP_USER,
    password: environment.CONTACT_SMTP_PASSWORD,
    from: environment.CONTACT_SMTP_FROM,
    to: environment.CONTACT_SMTP_TO,
  });
  if (!parsed.success) throw new ContactMailConfigurationError();
  const port = Number(parsed.data.port);
  return {
    kind: 'enabled', ...parsed.data, port,
    secure: port === 465, requireTls: port === 587,
  };
}

/** Creates one reusable transporter; callers owning it should call close() when finished. */
export function createContactMailTransport(config, createTransport = nodemailer.createTransport) {
  if (config.kind !== 'enabled') throw new ContactMailConfigurationError();
  const transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    ignoreTLS: false,
    auth: { user: config.user, pass: config.password },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: 5_000,
    dnsTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });
  return {
    async send(message) {
      const delivery = await transporter.sendMail(message);
      return { acceptedCount: delivery.accepted.length, rejectedCount: delivery.rejected.length };
    },
    close() { transporter.close(); },
  };
}

/** Returns only trusted/static headers plus the owner message or a short localized acknowledgement. */
export function renderContactMail(contact, kind, config) {
  if (config.kind !== 'enabled') throw new ContactMailConfigurationError();
  // Message-ID must be stable across attempts, and never incorporate user-controlled header text.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(contact.id)) {
    throw new ContactMailDeliveryError('invalid_contact');
  }
  if (kind !== 'team' && kind !== 'ack') throw new ContactMailDeliveryError('invalid_kind');
  const messageId = `<contact-${contact.id.toLowerCase()}-${kind}@${config.from.split('@')[1].toLowerCase()}>`;
  if (kind === 'ack') {
    if (!contact.email || !z.email().safeParse(contact.email).success) {
      throw new ContactMailDeliveryError('invalid_recipient');
    }
    const greek = contact.locale === 'el';
    return {
      from: config.from,
      to: contact.email,
      subject: greek ? 'Λάβαμε το μήνυμά σας' : 'We received your message',
      text: greek
        ? 'Ευχαριστούμε που επικοινωνήσατε μαζί μας. Λάβαμε το μήνυμά σας και θα σας απαντήσουμε το συντομότερο δυνατό.\n\nΑυτή είναι αυτόματη επιβεβαίωση. Για να προσθέσετε στοιχεία, μπορείτε να απαντήσετε σε αυτό το email.\n'
        : 'Thank you for contacting us. We received your message and will respond as soon as possible.\n\nThis is an automated acknowledgement. To add details, you may reply to this email.\n',
      messageId,
      headers: { 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All' },
    };
  }
  return {
    from: config.from,
    to: config.to,
    ...(contact.email && z.email().safeParse(contact.email).success ? { replyTo: contact.email } : {}),
    subject: `New contact submission ${contact.id}`,
    text: [
      `Contact ID: ${contact.id}`,
      `Accepted at: ${new Date(contact.createdAt).toISOString()}`,
      `Locale: ${contact.locale}`,
      `Source: ${contact.sourcePath}`,
      `Name: ${contact.name}`,
      `Email: ${contact.email ?? 'Not provided'}`,
      `Phone: ${contact.phone ?? 'Not provided'}`,
      '',
      'Message:',
      contact.message,
    ].join('\n'),
    messageId,
    headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
  };
}

/** Sends at least once; SMTP acceptance followed by a crash can result in a duplicate on retry. */
export async function deliverContactMail(contact, kind, config, transport) {
  const message = renderContactMail(contact, kind, config);
  const ownedTransport = transport ?? createContactMailTransport(config);
  try {
    let result;
    try {
      result = await ownedTransport.send(message);
    } catch {
      throw new ContactMailDeliveryError('transport_failed');
    }
    if (result.acceptedCount !== 1 || result.rejectedCount !== 0) {
      throw new ContactMailDeliveryError('recipient_rejected');
    }
  } finally {
    if (!transport) ownedTransport.close?.();
  }
}
