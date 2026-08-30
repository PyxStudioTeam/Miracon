import { z } from 'zod';
import { getDatabasePool } from './database';
import { hasCapability, type AdminCapability } from './auth/authorization';
import { verifySameOriginMutation } from './auth/request-security';
import { findSession, verifySessionCsrf } from './auth/session';
import type { AuthenticatedSession } from './auth/session';

export type ApiContext = {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly clientAddress?: string;
};

export type GuardedSession = {
  readonly session: AuthenticatedSession;
  readonly sessionToken: string;
};

export type GuardResult =
  | { readonly ok: true; readonly value: GuardedSession }
  | { readonly ok: false; readonly response: Response };

type ParsedJson<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly response: Response };

export const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;

export function json(value: unknown, init: ResponseInit = {}): Response {
  return Response.json(value, init);
}

export function jsonError(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, { status });
}

export async function parseJson<Value>(request: Request, schema: z.ZodType<Value>): Promise<ParsedJson<Value>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return { ok: false, response: jsonError(400, 'invalid_request', 'Request body must be valid JSON') };
    }
    throw error;
  }
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, response: jsonError(400, 'invalid_request', 'Request body is invalid') };
}

export function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const entry of header.split(';')) {
    const [key, ...parts] = entry.trim().split('=');
    if (key === name) return parts.join('=') || null;
  }
  return null;
}

export async function requireSession(request: Request): Promise<GuardResult> {
  const sessionToken = cookieValue(request, '__Host-session');
  if (!sessionToken) {
    return { ok: false, response: jsonError(401, 'unauthorized', 'Authentication is required') };
  }
  const session = await findSession(getDatabasePool(), sessionToken, new Date());
  if (!session) {
    return { ok: false, response: jsonError(401, 'unauthorized', 'Authentication is required') };
  }
  return { ok: true, value: { session, sessionToken } };
}

export async function requireSessionCapability(
  request: Request,
  capability: AdminCapability,
): Promise<GuardResult> {
  const result = await requireSession(request);
  if (!result.ok) return result;
  if (!hasCapability(result.value.session.role, capability)) {
    return { ok: false, response: jsonError(403, 'forbidden', 'You do not have permission to perform this action') };
  }
  return result;
}

export async function requireAdminMutation(request: Request): Promise<GuardResult> {
  const result = await requireSession(request);
  if (!result.ok) return result;

  const csrfToken = request.headers.get('x-csrf-token');
  if (!csrfToken || !verifySessionCsrf(result.value.session, csrfToken)) {
    return { ok: false, response: jsonError(403, 'csrf_failed', 'CSRF validation failed') };
  }
  if (!verifySameOriginMutation(request.method, request.headers.get('origin'), request.url)) {
    return { ok: false, response: jsonError(403, 'origin_failed', 'Origin validation failed') };
  }
  return result;
}

export async function requireAdminMutationCapability(
  request: Request,
  capability: AdminCapability,
): Promise<GuardResult> {
  const result = await requireAdminMutation(request);
  if (!result.ok) return result;
  if (!hasCapability(result.value.session.role, capability)) {
    return { ok: false, response: jsonError(403, 'forbidden', 'You do not have permission to perform this action') };
  }
  return result;
}

export function trustedClientAddress(clientAddress?: string): string {
  const adapterAddress = clientAddress?.trim();
  if (adapterAddress) return adapterAddress.slice(0, 512);
  return 'unknown';
}
