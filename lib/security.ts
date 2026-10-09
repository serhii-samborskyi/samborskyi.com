import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { siteOrigin, siteOrigins } from './site-origin';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const token = () => randomBytes(32).toString('hex');
export const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export function constantEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export const origin = siteOrigin;
export function sameOrigin(req: Request) {
  if (!siteOrigins().includes(req.headers.get('origin') || ''))
    throw new HttpError(403, 'This request must come from the listening room.');
}
export function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32)
    throw new HttpError(503, 'The studio is not configured yet. Run the setup command.');
  return s;
}
export function signature(value: string) {
  return createHmac('sha256', secret()).update(value).digest('hex');
}
export function signedLink(purpose: string, id: string, extra = '') {
  const payload = `${purpose}:${id}:${extra}`;
  return `${id}.${extra}.${signature(payload)}`;
}
export function verifyLink(purpose: string, value: string) {
  const [id, extra, sig, ...rest] = value.split('.');
  if (
    !id ||
    !extra ||
    !sig ||
    rest.length ||
    !constantEqual(signature(`${purpose}:${id}:${extra}`), sig)
  )
    throw new HttpError(400, 'This link is invalid or has expired.');
  return { id, extra };
}
export function verifyPassword(password: string) {
  if (process.env.ADMIN_PASSWORD)
    return constantEqual(hash(password), hash(process.env.ADMIN_PASSWORD));
  const stored = process.env.ADMIN_PASSWORD_HASH;
  if (!stored) throw new HttpError(503, 'Set ADMIN_PASSWORD in your server environment.');
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) throw new HttpError(503, 'Studio password configuration is invalid.');
  return constantEqual(scryptSync(password, salt, 64).toString('hex'), expected);
}
export function sessionCookie(value: string, expires = 86400, requestOrigin = origin()) {
  return `ss_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expires}${requestOrigin.startsWith('https:') ? '; Secure' : ''}`;
}
export function sessionValue(req: Request) {
  return (
    req.headers
      .get('cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('ss_session='))
      ?.slice(11) || ''
  );
}
export async function requireAdmin(req: Request) {
  const value = sessionValue(req);
  const row =
    value &&
    ((await db().prepare('SELECT expires_at FROM sessions WHERE token_hash=?').get(hash(value))) as
      | {
          expires_at: number;
        }
      | undefined);
  if (!row || row.expires_at < Date.now())
    throw new HttpError(401, 'Please sign in to your studio.');
}
export async function rateLimit(req: Request, scope: string, limit = 20, windowMs = 3600000) {
  // Only trust proxy headers when the deployment explicitly supplies a trusted proxy.
  const address =
    process.env.TRUST_PROXY === '1'
      ? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
      : 'direct';
  const key = hash(`${scope}:${address}`),
    now = Date.now();
  await db().prepare('DELETE FROM rate_limits WHERE resets_at < ?').run(now);
  const row = (await db()
    .prepare(
      `INSERT INTO rate_limits(key,count,resets_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=rate_limits.count+1 RETURNING count`,
    )
    .get(key, now + windowMs)) as {
    count: number;
  };
  if (row.count > limit) throw new HttpError(429, 'Please wait a little before trying again.');
}
export async function jsonBody(req: Request) {
  const limit = 16384;
  if (Number(req.headers.get('content-length') || 0) > limit)
    throw new HttpError(413, 'Request is too large.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, 'Request body is missing.');
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new HttpError(413, 'Request is too large.');
    }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, 'Please check the information and try again.');
  }
}
export function textField(value: unknown, label: string, max: number, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
    throw new HttpError(400, `${label} must be ${required ? '1–' : 'at most '}${max} characters.`);
  return value.trim();
}
