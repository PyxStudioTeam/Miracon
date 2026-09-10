import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CONTACT_CHALLENGE_DWELL_MS,
  issueContactChallenge,
  submitContact,
} from '../src/lib/server/contact-service';
import {
  contactChallengeTokenSchema,
  contactIdSchema,
  contactSubmissionSchema,
} from '../src/lib/server/contact-contracts';
import type {
  ContactChallengeRecord,
  ContactChallengeIssueResult,
  ContactIntakeRepository,
  ContactSubmissionRecord,
  ContactSubmissionResult,
} from '../src/lib/server/contact-repository';

const now = new Date('2026-09-02T12:00:00.000Z');
const digestSecret = 'contact-test-secret-with-at-least-thirty-two-bytes';
const validSubmission = {
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  phone: '+30 210 000 0000',
  message: 'Please contact me about a property.',
  consent: true as const,
  locale: 'en' as const,
  sourcePath: '/projects/example',
  website: '',
  challenge: contactChallengeTokenSchema.parse('a'.repeat(43)),
};

class FakeContactRepository implements ContactIntakeRepository {
  challenge: ContactChallengeRecord | null = null;
  submission: ContactSubmissionRecord | null = null;
  submissionResult: ContactSubmissionResult = {
    kind: 'accepted',
    id: contactIdSchema.parse('10000000-0000-4000-8000-000000000001'),
  };

  async createChallenge(record: ContactChallengeRecord): Promise<ContactChallengeIssueResult> {
    this.challenge = record;
    return { kind: 'issued' };
  }

  async acceptSubmission(record: ContactSubmissionRecord): Promise<ContactSubmissionResult> {
    this.submission = record;
    return record.isSpam ? { kind: 'spam' } : this.submissionResult;
  }
}

describe('contact intake service', () => {
  it('issues a digest-only challenge with a server-enforced dwell time', async () => {
    // Given
    const repository = new FakeContactRepository();

    // When
    const challenge = await issueContactChallenge(repository, { clientAddress: '203.0.113.7', digestSecret, now });

    // Then
    expect(challenge.kind).toBe('issued');
    if (challenge.kind !== 'issued') throw new Error('Expected challenge issuance');
    expect(challenge.notBefore.getTime()).toBe(now.getTime() + CONTACT_CHALLENGE_DWELL_MS);
    expect(repository.challenge?.tokenDigest).toHaveLength(32);
    expect(repository.challenge?.clientDigest).toHaveLength(32);
    expect(repository.challenge?.clientDigest).toEqual(contactDigest('client', '203.0.113.7'));
    expect(JSON.stringify(repository.challenge)).not.toContain('203.0.113.7');
  });

  it('persists only client and duplicate digests for a valid submission', async () => {
    // Given
    const repository = new FakeContactRepository();

    // When
    const result = await submitContact(repository, {
      submission: validSubmission,
      clientAddress: '203.0.113.7',
      digestSecret,
      now,
    });

    // Then
    expect(result).toEqual({ kind: 'accepted', id: '10000000-0000-4000-8000-000000000001' });
    expect(repository.submission?.clientDigest).toHaveLength(32);
    expect(repository.submission?.duplicateDigest).toHaveLength(32);
    expect(repository.submission?.challengeDigest).toEqual(contactDigest('challenge', validSubmission.challenge));
    expect(JSON.stringify(repository.submission)).not.toContain('203.0.113.7');
  });

  it('passes a populated honeypot to transactional challenge consumption', async () => {
    // Given
    const repository = new FakeContactRepository();

    // When
    const result = await submitContact(repository, {
      submission: { ...validSubmission, website: 'https://spam.example' },
      clientAddress: '203.0.113.7',
      digestSecret,
      now,
    });

    // Then
    expect(result).toEqual({ kind: 'spam' });
    expect(repository.submission?.isSpam).toBe(true);
  });

  it('rejects unknown request fields and missing contact methods at the boundary', () => {
    // Given
    const unknownField = { ...validSubmission, unexpected: true };
    const missingContactMethod = { ...validSubmission, email: undefined, phone: undefined };

    // When
    const unknownResult = contactSubmissionSchema.safeParse(unknownField);
    const missingResult = contactSubmissionSchema.safeParse(missingContactMethod);

    // Then
    expect(unknownResult.success).toBe(false);
    expect(missingResult.success).toBe(false);
  });

  it('normalizes equivalent content into the same duplicate digest', async () => {
    // Given
    const firstRepository = new FakeContactRepository();
    const secondRepository = new FakeContactRepository();

    // When
    await submitContact(firstRepository, { submission: validSubmission, clientAddress: '203.0.113.7', digestSecret, now });
    await submitContact(secondRepository, {
      submission: {
        ...validSubmission,
        name: '  ADA   LOVELACE ',
        email: 'ADA@EXAMPLE.TEST',
        message: ' Please contact me about a property. ',
      },
      clientAddress: '203.0.113.8',
      digestSecret,
      now,
    });

    // Then
    expect(secondRepository.submission?.duplicateDigest).toEqual(firstRepository.submission?.duplicateDigest);
  });
});

function contactDigest(domain: 'challenge' | 'client', value: string): Buffer {
  return createHmac('sha256', digestSecret)
    .update(`miracon-contact/${domain}/v1\0${value}`, 'utf8')
    .digest();
}
