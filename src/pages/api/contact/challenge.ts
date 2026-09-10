import { verifySameOriginMutation } from '../../../lib/server/auth/request-security';
import { json, jsonError, trustedClientAddress } from '../../../lib/server/api';
import type { ApiContext } from '../../../lib/server/api';
import { getContactDigestSecret } from '../../../lib/server/contact-config';
import { PostgresContactRepository } from '../../../lib/server/contact-repository';
import { issueContactChallenge } from '../../../lib/server/contact-service';
import { getDatabasePool } from '../../../lib/server/database';

export async function POST({ request, clientAddress }: ApiContext): Promise<Response> {
  if (!verifySameOriginMutation(request.method, request.headers.get('origin'), request.url)) {
    return jsonError(403, 'origin_failed', 'Origin validation failed');
  }
  const issued = await issueContactChallenge(
    new PostgresContactRepository(getDatabasePool()),
    {
      clientAddress: trustedClientAddress(clientAddress),
      digestSecret: getContactDigestSecret(),
      now: new Date(),
    },
  );
  if (issued.kind === 'rate_limited') {
    return jsonError(429, 'rate_limited', 'Too many contact challenge requests');
  }
  return json({
    challenge: issued.token,
    notBefore: issued.notBefore.toISOString(),
    expiresAt: issued.expiresAt.toISOString(),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
