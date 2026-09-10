import { createHmac, randomUUID } from 'node:crypto';
import { contactChallengeTokenSchema, contactIdSchema } from './contact-contracts';
import type { ContactChallengeToken, ContactSubmissionInput } from './contact-contracts';
import type {
  ContactChallengeRecord,
  ContactChallengeIssueResult,
  ContactIntakeRepository,
  ContactSubmissionResult,
} from './contact-repository';
import { generateOpaqueToken } from './auth/crypto';

export const CONTACT_CHALLENGE_DWELL_MS = 3_000;
export const CONTACT_CHALLENGE_TTL_MS = 15 * 60 * 1_000;

type ContactRequestContext = {
  readonly clientAddress: string;
  readonly digestSecret: string;
  readonly now: Date;
};

type ContactSubmissionRequest = ContactRequestContext & {
  readonly submission: ContactSubmissionInput;
};

export type IssuedContactChallenge =
  | { readonly kind: 'issued'; readonly token: ContactChallengeToken; readonly notBefore: Date; readonly expiresAt: Date }
  | { readonly kind: 'rate_limited' };

export type SubmitContactResult = ContactSubmissionResult;

export async function issueContactChallenge(
  repository: ContactIntakeRepository,
  context: ContactRequestContext,
): Promise<IssuedContactChallenge> {
  const token = contactChallengeTokenSchema.parse(generateOpaqueToken());
  const notBefore = new Date(context.now.getTime() + CONTACT_CHALLENGE_DWELL_MS);
  const expiresAt = new Date(context.now.getTime() + CONTACT_CHALLENGE_TTL_MS);
  const record: ContactChallengeRecord = {
    tokenDigest: contactDigest(context.digestSecret, 'challenge', token),
    clientDigest: contactDigest(context.digestSecret, 'client', context.clientAddress),
    createdAt: context.now,
    notBefore,
    expiresAt,
  };
  const result: ContactChallengeIssueResult = await repository.createChallenge(record);
  return result.kind === 'issued' ? { kind: 'issued', token, notBefore, expiresAt } : result;
}

export async function submitContact(
  repository: ContactIntakeRepository,
  request: ContactSubmissionRequest,
): Promise<SubmitContactResult> {
  const duplicateSource = [
    request.submission.name,
    request.submission.email ?? '',
    request.submission.phone ?? '',
    request.submission.message,
  ].map(normalizeDuplicatePart).join('\0');
  return repository.acceptSubmission({
    id: contactIdSchema.parse(randomUUID()),
    name: request.submission.name,
    email: request.submission.email,
    phone: request.submission.phone,
    message: request.submission.message,
    locale: request.submission.locale,
    sourcePath: request.submission.sourcePath,
    challengeDigest: contactDigest(request.digestSecret, 'challenge', request.submission.challenge),
    clientDigest: contactDigest(request.digestSecret, 'client', request.clientAddress),
    duplicateDigest: contactDigest(request.digestSecret, 'duplicate', duplicateSource),
    isSpam: request.submission.website.trim().length > 0,
    createdAt: request.now,
  });
}

function contactDigest(secret: string, domain: 'challenge' | 'client' | 'duplicate', value: string): Buffer {
  return createHmac('sha256', secret)
    .update(`miracon-contact/${domain}/v1\0${value}`, 'utf8')
    .digest();
}

function normalizeDuplicatePart(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}
