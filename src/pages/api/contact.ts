import { verifySameOriginMutation } from '../../lib/server/auth/request-security';
import { json, jsonError, trustedClientAddress } from '../../lib/server/api';
import type { ApiContext } from '../../lib/server/api';
import { contactSubmissionSchema } from '../../lib/server/contact-contracts';
import type { ContactSubmissionInput } from '../../lib/server/contact-contracts';
import {
  ContactSmtpConfigurationError,
  getContactDigestSecret,
} from '../../lib/server/contact-config';
import {
  ContactNotificationError,
  notifyAcceptedContact,
} from '../../lib/server/contact-notifications';
import type {
  AcceptedContactNotification,
  ContactNotificationFailureCategory,
} from '../../lib/server/contact-notifications';
import { PostgresContactRepository } from '../../lib/server/contact-repository';
import { submitContact } from '../../lib/server/contact-service';
import type { SubmitContactResult } from '../../lib/server/contact-service';
import { getDatabasePool } from '../../lib/server/database';

export const CONTACT_REQUEST_MAX_BYTES = 8_192;

type ContactSubmitRequest = {
  readonly submission: ContactSubmissionInput;
  readonly clientAddress: string;
  readonly now: Date;
};

type ContactNotificationLog = {
  readonly event: 'contact_notification_failed';
  readonly contactId: AcceptedContactNotification['id'];
  readonly category: ContactNotificationFailureCategory | 'configuration_invalid' | 'unexpected';
};

type ContactRouteDependencies = {
  readonly submit: (request: ContactSubmitRequest) => Promise<SubmitContactResult>;
  readonly notify: (contact: AcceptedContactNotification) => Promise<void>;
  readonly logNotificationFailure: (event: ContactNotificationLog) => void;
};

const contactRouteDependencies: ContactRouteDependencies = {
  submit: ({ submission, clientAddress, now }) => submitContact(
    new PostgresContactRepository(getDatabasePool()),
    { submission, clientAddress, digestSecret: getContactDigestSecret(), now },
  ),
  notify: notifyAcceptedContact,
  logNotificationFailure: (event) => console.warn(JSON.stringify(event)),
};

export function createContactPost(
  overrides: Readonly<Partial<ContactRouteDependencies>> = {},
): (context: ApiContext) => Promise<Response> {
  const dependencies = { ...contactRouteDependencies, ...overrides };
  return async ({ request, clientAddress }) => {
    if (!verifySameOriginMutation(request.method, request.headers.get('origin'), request.url)) {
      return jsonError(403, 'origin_failed', 'Origin validation failed');
    }
    const contentLength = request.headers.get('content-length');
    if (!contentLength) return jsonError(411, 'length_required', 'Content-Length is required');
    if (!/^\d+$/u.test(contentLength) || Number(contentLength) > CONTACT_REQUEST_MAX_BYTES) {
      return jsonError(413, 'request_too_large', 'Request body exceeds the contact request limit');
    }
    const input = await parseContactBody(request);
    if (!input.ok) return input.response;

    const now = new Date();
    const result = await dependencies.submit({
      submission: input.value,
      clientAddress: trustedClientAddress(clientAddress),
      now,
    });
    switch (result.kind) {
      case 'accepted':
        try {
          await dependencies.notify({
            id: result.id,
            name: input.value.name,
            email: input.value.email,
            phone: input.value.phone,
            message: input.value.message,
            locale: input.value.locale,
            sourcePath: input.value.sourcePath,
            acceptedAt: now,
          });
        } catch (error) {
          dependencies.logNotificationFailure({
            event: 'contact_notification_failed',
            contactId: result.id,
            category: notificationFailureCategory(error),
          });
        }
        return json({ id: result.id }, { status: 201 });
      case 'invalid_challenge':
        return jsonError(400, 'invalid_challenge', 'Contact challenge is invalid or expired');
      case 'too_fast':
        return jsonError(429, 'challenge_too_fast', 'Contact challenge dwell time was not met');
      case 'rate_limited':
        return jsonError(429, 'rate_limited', 'Too many contact requests');
      case 'duplicate':
        return jsonError(409, 'duplicate_contact', 'This contact request was already received');
      case 'spam':
        return jsonError(400, 'invalid_request', 'Request body is invalid');
      default:
        return assertNever(result);
    }
  };
}

export const POST = createContactPost();

type ParsedContactBody =
  | { readonly ok: true; readonly value: ContactSubmissionInput }
  | { readonly ok: false; readonly response: Response };

async function parseContactBody(request: Request): Promise<ParsedContactBody> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, response: jsonError(400, 'invalid_request', 'Request body must be valid JSON') };

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    receivedBytes += chunk.value.byteLength;
    if (receivedBytes > CONTACT_REQUEST_MAX_BYTES) {
      await reader.cancel();
      return { ok: false, response: jsonError(413, 'request_too_large', 'Request body exceeds the contact request limit') };
    }
    chunks.push(chunk.value);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return { ok: false, response: jsonError(400, 'invalid_request', 'Request body must be valid JSON') };
    }
    throw error;
  }
  const parsed = contactSubmissionSchema.safeParse(body);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, response: jsonError(400, 'invalid_request', 'Request body is invalid') };
}

function assertNever(_value: never): never {
  throw new TypeError('Unexpected contact submission result');
}

function notificationFailureCategory(
  error: unknown,
): ContactNotificationLog['category'] {
  if (error instanceof ContactSmtpConfigurationError) return 'configuration_invalid';
  if (error instanceof ContactNotificationError) return error.category;
  return 'unexpected';
}
