import { bootstrap } from '../lib/bootstrap.ts';
import { db } from '../lib/db.ts';
await bootstrap();
await db().close();
const { APP_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } = process.env;
if (!APP_URL?.startsWith('https://') || !TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET)
  throw new Error(
    'Set a public HTTPS APP_URL, TELEGRAM_BOT_TOKEN, and TELEGRAM_WEBHOOK_SECRET in .env.local first.',
  );
const result = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: `${new URL(APP_URL).origin}/api/telegram/webhook`,
    secret_token: TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message'],
  }),
});
const data = await result.json();
if (!result.ok || !data.ok)
  throw new Error('Telegram could not register the webhook. Check your configuration.');
console.log(
  'Telegram webhook registered. Listeners can send /start to subscribe or /stop to leave.',
);
