import type { APIRoute } from 'astro';

const LEADS_RECIPIENT = 'leads@miracon.gr';
const MAX_REQUESTS_PER_MINUTE = 3;
const requestCounts = new Map<string, { count: number; resetAt: number }>();

function cleanText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const current = requestCounts.get(ip);

  if (!current || current.resetAt <= now) {
    requestCounts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }

  current.count += 1;
  return current.count > MAX_REQUESTS_PER_MINUTE;
}

export const POST: APIRoute = async ({ request, url }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) {
    return new Response(JSON.stringify({ message: 'Invalid request origin.' }), { status: 403 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ message: 'Invalid form data.' }), { status: 400 });
  }

  // Honeypot submissions receive a success response without creating an email.
  if (cleanText(payload.website, 200)) {
    return new Response(JSON.stringify({ ok: true }));
  }

  const formStartedAt = Number(payload.formStartedAt);
  if (!Number.isFinite(formStartedAt) || Date.now() - formStartedAt < 3_000) {
    return new Response(JSON.stringify({ message: 'Please wait a moment and try again.' }), { status: 400 });
  }

  const name = cleanText(payload.name, 120);
  const phone = cleanText(payload.phone, 80);
  const email = cleanText(payload.email, 254);
  const message = cleanText(payload.message, 3_000);
  const page = cleanText(payload.page, 500);
  const consent = payload.consent === true;
  const emailIsValid = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!name || (!phone && !email) || !consent || !emailIsValid) {
    return new Response(JSON.stringify({ message: 'Enter your name and at least one valid contact detail.' }), { status: 400 });
  }

  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ message: 'Too many requests. Please try again in a minute.' }), { status: 429 });
  }

  const resendApiKey = import.meta.env.RESEND_API_KEY;
  const from = import.meta.env.LEADS_FROM_EMAIL || 'MIRACON Website <leads@miracon.gr>';
  if (!resendApiKey) {
    console.error('Lead email is not configured: RESEND_API_KEY is missing.');
    return new Response(JSON.stringify({ message: 'The form is temporarily unavailable. Please try again later.' }), { status: 503 });
  }

  const emailResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [LEADS_RECIPIENT],
      reply_to: email || undefined,
      subject: `Consultation request from ${name}`,
      text: [
        `Name: ${name}`,
        `Phone: ${phone || 'Not provided'}`,
        `Email: ${email || 'Not provided'}`,
        `Page: ${page || 'Not provided'}`,
        '',
        `Message: ${message || 'Not provided'}`,
      ].join('\n'),
      html: `<h2>Consultation request</h2><p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Phone:</strong> ${escapeHtml(phone || 'Not provided')}</p><p><strong>Email:</strong> ${escapeHtml(email || 'Not provided')}</p><p><strong>Page:</strong> ${escapeHtml(page || 'Not provided')}</p><p><strong>Message:</strong><br>${escapeHtml(message || 'Not provided')}</p>`,
    }),
  });

  if (!emailResponse.ok) {
    console.error('Unable to deliver lead email:', emailResponse.status);
    return new Response(JSON.stringify({ message: 'We could not send your request. Please try again later.' }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
