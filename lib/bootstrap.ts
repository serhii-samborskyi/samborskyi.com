import { createHmac, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { db, transaction } from './db';
import { siteOrigin } from './site-origin';

export async function bootstrap() {
  const password = process.env.ADMIN_PASSWORD;
  if (password !== undefined && (password.length < 12 || password.length > 200))
    throw new Error('ADMIN_PASSWORD must contain 12–200 characters.');
  if (!password && !process.env.ADMIN_PASSWORD_HASH)
    throw new Error('Set ADMIN_PASSWORD before starting the application.');
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL)
    throw new Error(
      'Set DATABASE_URL to your PostgreSQL connection URL (or file:/app/data/studio.sqlite with a persistent volume).',
    );
  process.env.APP_URL = siteOrigin();
  const settings = await transaction(async () => {
    await db().lock(824762004);
    async function saved(key: string, create: () => string) {
      const existing = await db().prepare('SELECT value FROM app_settings WHERE key=?').get(key);
      if (existing) return String(existing.value);
      const value = create();
      await db().prepare('INSERT INTO app_settings(key,value) VALUES(?,?)').run(key, value);
      return value;
    }
    const sessionSecret =
      process.env.SESSION_SECRET ||
      (await saved('session_secret', () => randomBytes(48).toString('hex')));
    if (sessionSecret.length < 32)
      throw new Error('SESSION_SECRET, when provided, must contain at least 32 characters.');
    const vapid =
      process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
        ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
        : JSON.parse(await saved('vapid_keys', () => JSON.stringify(webpush.generateVAPIDKeys())));
    const webhookSecret =
      process.env.TELEGRAM_WEBHOOK_SECRET ||
      (await saved('telegram_webhook_secret', () => randomBytes(32).toString('hex')));
    const fingerprint = createHmac('sha256', sessionSecret)
      .update(password || process.env.ADMIN_PASSWORD_HASH!)
      .digest('hex');
    const previous = await db()
      .prepare("SELECT value FROM app_settings WHERE key='admin_fingerprint'")
      .get();
    if (previous && previous.value !== fingerprint)
      await db().prepare('DELETE FROM sessions').run();
    await db()
      .prepare(
        "INSERT INTO app_settings(key,value) VALUES('admin_fingerprint',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(fingerprint);
    return { sessionSecret, vapid, webhookSecret };
  });
  process.env.SESSION_SECRET = settings.sessionSecret;
  process.env.VAPID_PUBLIC_KEY = settings.vapid.publicKey;
  process.env.VAPID_PRIVATE_KEY = settings.vapid.privateKey;
  process.env.VAPID_SUBJECT ||= process.env.APP_URL;
  process.env.TELEGRAM_WEBHOOK_SECRET = settings.webhookSecret;
}
