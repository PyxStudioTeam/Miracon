import { z } from 'zod';

export const contactIdSchema = z.uuid().brand<'ContactId'>();
export const contactChallengeTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u).brand<'ContactChallengeToken'>();

export const contactSubmissionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().pipe(z.email().max(254)).optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  message: z.string().trim().min(1).max(3_000),
  consent: z.literal(true),
  locale: z.enum(['en', 'el']),
  sourcePath: z.string().trim().min(1).max(2_048).regex(/^\/(?!\/)/u),
  website: z.string().max(256),
  challenge: contactChallengeTokenSchema,
}).strict().refine((input) => input.email !== undefined || input.phone !== undefined, {
  message: 'Email or phone is required',
});

export const contactListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

export type ContactId = z.infer<typeof contactIdSchema>;
export type ContactChallengeToken = z.infer<typeof contactChallengeTokenSchema>;
export type ContactSubmissionInput = z.infer<typeof contactSubmissionSchema>;
