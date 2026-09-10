import { describe, expect, it } from 'vitest';
import {
  ContactSmtpConfigurationError,
  getContactSmtpConfig,
} from '../src/lib/server/contact-config';
import { contactIdSchema } from '../src/lib/server/contact-contracts';
import {
  notifyAcceptedContact,
  type ContactMail,
  type ContactMailTransport,
} from '../src/lib/server/contact-notifications';

const enabledEnvironment = {
  CONTACT_SMTP_ENABLED: 'true',
  CONTACT_SMTP_HOST: 'smtp.example.test',
  CONTACT_SMTP_PORT: '587',
  CONTACT_SMTP_USER: 'smtp-user',
  CONTACT_SMTP_PASSWORD: 'smtp-password',
  CONTACT_SMTP_FROM: 'website@example.test',
  CONTACT_SMTP_TO: 'team@example.test',
} as const;

const acceptedContact = {
  id: contactIdSchema.parse('10000000-0000-4000-8000-000000000001'),
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  phone: '+30 210 000 0000',
  message: 'Please contact me about a property.',
  locale: 'en' as const,
  sourcePath: '/projects/example',
  acceptedAt: new Date('2026-09-02T12:00:00.000Z'),
};

class CapturingTransport implements ContactMailTransport {
  message: ContactMail | null = null;

  constructor(private readonly result = { acceptedCount: 1, rejectedCount: 0 }) {}

  async send(message: ContactMail): Promise<{ readonly acceptedCount: number; readonly rejectedCount: number }> {
    this.message = message;
    return this.result;
  }
}

describe('contact SMTP configuration', () => {
  it('is disabled when explicit opt-in is absent or false', () => {
    // Given / When / Then
    expect(getContactSmtpConfig({})).toEqual({ kind: 'disabled' });
    expect(getContactSmtpConfig({ CONTACT_SMTP_ENABLED: 'false' })).toEqual({ kind: 'disabled' });
  });

  it('selects implicit TLS for 465 and required STARTTLS for 587', () => {
    // Given / When
    const implicitTls = getContactSmtpConfig({ ...enabledEnvironment, CONTACT_SMTP_PORT: '465' });
    const startTls = getContactSmtpConfig(enabledEnvironment);

    // Then
    expect(implicitTls).toMatchObject({ kind: 'enabled', port: 465, secure: true, requireTls: false });
    expect(startTls).toMatchObject({ kind: 'enabled', port: 587, secure: false, requireTls: true });
  });

  it('rejects incomplete, unsupported, or invalid enabled configuration without exposing values', () => {
    // Given
    const invalidEnvironments = [
      { ...enabledEnvironment, CONTACT_SMTP_PASSWORD: undefined },
      { ...enabledEnvironment, CONTACT_SMTP_PORT: '25' },
      { ...enabledEnvironment, CONTACT_SMTP_TO: 'not-an-email' },
      { ...enabledEnvironment, CONTACT_SMTP_ENABLED: 'TRUE' },
    ];

    // When / Then
    for (const environment of invalidEnvironments) {
      expect(() => getContactSmtpConfig(environment)).toThrow(ContactSmtpConfigurationError);
      expect(() => getContactSmtpConfig(environment)).toThrow('Contact SMTP configuration is invalid');
    }
  });
});

describe('accepted contact notifications', () => {
  it('does not create a transport when SMTP is disabled', async () => {
    // Given
    let transportCreations = 0;

    // When
    await notifyAcceptedContact(acceptedContact, {
      environment: {},
      createTransport: () => {
        transportCreations += 1;
        return new CapturingTransport();
      },
    });

    // Then
    expect(transportCreations).toBe(0);
  });

  it('sends one internal plain-text message with validated email as Reply-To', async () => {
    // Given
    const transport = new CapturingTransport();

    // When
    await notifyAcceptedContact(acceptedContact, {
      environment: enabledEnvironment,
      createTransport: () => transport,
    });

    // Then
    expect(transport.message).toEqual({
      from: 'website@example.test',
      to: 'team@example.test',
      replyTo: 'ada@example.test',
      subject: 'New contact submission 10000000-0000-4000-8000-000000000001',
      text: [
        'Contact ID: 10000000-0000-4000-8000-000000000001',
        'Accepted at: 2026-09-02T12:00:00.000Z',
        'Locale: en',
        'Source: /projects/example',
        'Name: Ada Lovelace',
        'Email: ada@example.test',
        'Phone: +30 210 000 0000',
        '',
        'Message:',
        'Please contact me about a property.',
      ].join('\n'),
    });
  });

  it('omits Reply-To when the accepted contact has no submitted email', async () => {
    // Given
    const transport = new CapturingTransport();

    // When
    await notifyAcceptedContact({ ...acceptedContact, email: undefined }, {
      environment: enabledEnvironment,
      createTransport: () => transport,
    });

    // Then
    expect(transport.message).not.toHaveProperty('replyTo');
  });

  it('rejects partial recipient delivery', async () => {
    // Given
    const transport = new CapturingTransport({ acceptedCount: 0, rejectedCount: 1 });

    // When / Then
    await expect(notifyAcceptedContact(acceptedContact, {
      environment: enabledEnvironment,
      createTransport: () => transport,
    })).rejects.toMatchObject({ category: 'recipient_rejected' });
  });
});
