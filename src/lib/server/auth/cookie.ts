export const SESSION_COOKIE_NAME = '__Host-session' as const;

const COOKIE_SECURITY_ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Lax';

export function createSessionCookie(sessionToken: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE_NAME}=${sessionToken}; Max-Age=${maxAgeSeconds}; ${COOKIE_SECURITY_ATTRIBUTES}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${COOKIE_SECURITY_ATTRIBUTES}`;
}
