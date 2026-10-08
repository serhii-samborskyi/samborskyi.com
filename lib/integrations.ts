import webpush from 'web-push';
import { HttpError, origin, signedLink } from './security';
import type { PublicConfig, Subscriber, Release } from './types';
export function configuration(): PublicConfig {
  return {
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    telegram:
      process.env.TELEGRAM_BOT_TOKEN &&
      process.env.TELEGRAM_WEBHOOK_SECRET &&
      /^[A-Za-z0-9_]{5,32}$/.test(process.env.TELEGRAM_BOT_USERNAME || '')
        ? process.env.TELEGRAM_BOT_USERNAME!
        : null,
    pushKey:
      process.env.VAPID_PRIVATE_KEY && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_SUBJECT
        ? process.env.VAPID_PUBLIC_KEY
        : null,
    pixelId: /^\d{5,25}$/.test(process.env.META_PIXEL_ID || '') ? process.env.META_PIXEL_ID! : null,
  };
}
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  idempotencyKey: string,
  unsubscribe?: string,
) {
  if (!configuration().email)
    throw new HttpError(503, 'Email updates will open soon. Please check back.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [to],
      subject,
      text,
      ...(unsubscribe
        ? {
            headers: {
              'List-Unsubscribe': `<${unsubscribe}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }
        : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new HttpError(502, `Email provider returned ${response.status}.`);
}
export async function telegram(chatId: string, text: string) {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new HttpError(503, 'Telegram is not connected yet.');
  const response = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(15000),
    },
  );
  const result = await response.json();
  if (!response.ok || !result.ok)
    throw new HttpError(
      response.status === 403 ? 410 : 502,
      `Telegram returned ${response.status}.`,
    );
}
export function validatePush(value: unknown) {
  const s = value as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  let url: URL;
  try {
    url = new URL(s.endpoint || '');
  } catch {
    throw new HttpError(400, 'Invalid push subscription.');
  }
  const host = url.hostname;
  const allowed =
    host === 'fcm.googleapis.com' ||
    host === 'updates.push.services.mozilla.com' ||
    host === 'web.push.apple.com' ||
    host.endsWith('.push.apple.com') ||
    host === 'wns.windows.com' ||
    host.endsWith('.notify.windows.com');
  if (
    !allowed ||
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    !s.keys?.auth ||
    !s.keys?.p256dh ||
    !/^[A-Za-z0-9_-]+$/.test(s.keys.p256dh) ||
    !/^[A-Za-z0-9_-]+$/.test(s.keys.auth) ||
    Buffer.from(s.keys.p256dh, 'base64url').length !== 65 ||
    Buffer.from(s.keys.auth, 'base64url').length !== 16
  )
    throw new HttpError(400, 'This browser push service is not supported.');
  return { endpoint: url.href, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}
export async function sendRelease(subscriber: Subscriber, release: Release, jobId: string) {
  const link = `${origin()}/listen/${release.id}`;
  const text = `${release.title}\n\n${release.description}\n\nListen: ${link}\n\n— Serhii Samborskyi`;
  if (subscriber.channel === 'email') {
    const unsub = `${origin()}/unsubscribe?token=${signedLink('unsubscribe', subscriber.id, subscriber.confirm_nonce)}`;
    await sendEmail(
      subscriber.address,
      `New sounds: ${release.title}`,
      `${text}\n\nUnsubscribe: ${unsub}`,
      jobId,
      `${origin()}/api/unsubscribe/one-click?token=${signedLink('unsubscribe', subscriber.id, subscriber.confirm_nonce)}`,
    );
  } else if (subscriber.channel === 'telegram')
    await telegram(subscriber.address, `${text}\n\nSend /stop to unsubscribe.`);
  else {
    if (!configuration().pushKey) throw new HttpError(503, 'Browser push is not configured.');
    const subscription = validatePush(JSON.parse(subscriber.data || '{}'));
    const detail = webpush.generateRequestDetails(
      subscription,
      JSON.stringify({
        title: `New sounds: ${release.title}`,
        body: 'A new experiment from Serhii Samborskyi. Tap to listen.',
        url: link,
        tag: release.id,
      }),
      {
        vapidDetails: {
          subject: process.env.VAPID_SUBJECT!,
          publicKey: process.env.VAPID_PUBLIC_KEY!,
          privateKey: process.env.VAPID_PRIVATE_KEY!,
        },
        TTL: 86400,
      },
    );
    const response = await fetch(detail.endpoint, {
      method: detail.method,
      headers: detail.headers as Record<string, string>,
      body: detail.body as unknown as BodyInit,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new HttpError(
        response.status === 404 || response.status === 410 ? 410 : 502,
        `Push service returned ${response.status}.`,
      );
  }
}
