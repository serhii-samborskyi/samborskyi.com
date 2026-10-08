import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, scryptSync } from 'node:crypto';
const { testDatabase } = await import('./test-database');
const database = await testDatabase();
process.env.APP_URL = 'http://localhost:4319';
process.env.SESSION_SECRET = 'test-secret-that-is-more-than-thirty-two-characters';
process.env.ADMIN_PASSWORD_HASH = `test-salt:${scryptSync('studio-test-password', 'test-salt', 64).toString('hex')}`;
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.EMAIL_FROM = 'Studio <studio@example.com>';
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-key';
process.env.TELEGRAM_BOT_USERNAME = 'StudioTestBot';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
const { GET, POST, PATCH, DELETE } = await import('../app/api/[...path]/route');
const { db } = await import('../lib/db');
const { signedLink, hash } = await import('../lib/security');
const { drainQueue } = await import('../lib/releases');
const { validatePush } = await import('../lib/integrations');
const calls: {
  url: string;
  body: Record<string, unknown>;
}[] = [];
let failEmail = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = String(input);
  assert.ok(
    url === 'https://api.resend.com/emails' || url.startsWith('https://api.telegram.org/'),
    'Only mocked service endpoints may be used',
  );
  calls.push({ url, body: JSON.parse(String(options?.body || '{}')) });
  return Response.json(
    url.startsWith('https://api.telegram.org/') ? { ok: true } : { id: 'fake-delivery' },
    { status: failEmail && url.includes('resend') ? 503 : 200 },
  );
};
let cookie = '';
async function call(
  p: string,
  method = 'GET',
  body?: unknown,
  authenticated = false,
  extra: Record<string, string> = {},
) {
  const headers: Record<string, string> = { origin: process.env.APP_URL!, ...extra };
  if (authenticated) headers.cookie = cookie;
  if (body !== undefined && !(body instanceof FormData))
    headers['Content-Type'] = 'application/json';
  const req = new Request(`${process.env.APP_URL}/api/${p}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  return ({ GET, POST, PATCH, DELETE } as Record<string, (r: Request) => Promise<Response>>)[
    method
  ](req);
}
async function seedSubscriber(
  channel = 'email',
  address = 'listener@example.com',
  status = 'active',
) {
  const id = randomUUID();
  await db()
    .prepare(
      'INSERT INTO subscribers(id,channel,address,status,confirm_nonce,created_at,confirmed_at) VALUES(?,?,?,?,?,?,?)',
    )
    .run(id, channel, address, status, 'nonce-' + id, Date.now(), Date.now());
  return id;
}
let audioId = '',
  releaseId = '';
test('listening room workflow and security', async (t) => {
  await t.test('studio and upload endpoints reject unauthenticated access', async () => {
    assert.equal((await call('admin/overview')).status, 401);
    assert.equal((await call('admin/uploads', 'POST', {})).status, 401);
  });
  await t.test('login validates password and rejects cross-origin requests', async () => {
    assert.equal((await call('login', 'POST', { password: 'wrong' })).status, 401);
    assert.equal(
      (
        await call('login', 'POST', { password: 'studio-test-password' }, false, {
          origin: 'https://attacker.example',
        })
      ).status,
      403,
    );
    const r = await call('login', 'POST', { password: 'studio-test-password' });
    assert.equal(r.status, 200);
    cookie = r.headers.get('set-cookie')!.split(';')[0];
    assert.match(r.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
    assert.equal((await call('admin/overview', 'GET', undefined, true)).status, 200);
  });
  await t.test(
    'audio upload checks bytes, drafts stay private, and invalid covers are rejected',
    async () => {
      const invalid = new FormData();
      invalid.set(
        'file',
        new File(['<svg onload="alert(1)"/>'], 'song.mp3', { type: 'audio/mpeg' }),
      );
      assert.equal((await call('admin/uploads', 'POST', invalid, true)).status, 400);
      const wav = Buffer.alloc(100);
      wav.write('RIFF', 0);
      wav.write('WAVE', 8);
      const body = new FormData();
      body.set('file', new File([wav], 'private-test.wav', { type: 'audio/wav' }));
      const r = await call('admin/uploads', 'POST', body, true);
      assert.equal(r.status, 201);
      audioId = (await r.json()).id;
      assert.equal((await call(`media/${audioId}`)).status, 401);
      assert.equal((await call(`media/${audioId}`, 'GET', undefined, true)).status, 200);
      const draft = await call(
        'admin/releases',
        'POST',
        {
          title: 'Test composition',
          description: 'A studio note',
          category: 'Ambient',
          audioId,
          duration: 90,
        },
        true,
      );
      assert.equal(draft.status, 201);
      releaseId = (await draft.json()).id;
      assert.equal((await (await call('releases')).json()).releases.length, 0);
    },
  );
  await t.test(
    'email sign-up requires consent, confirmation is explicit, links expire, and addresses are deduplicated',
    async () => {
      assert.equal(
        (await call('subscribe/email', 'POST', { email: 'fan@example.com', consent: false }))
          .status,
        400,
      );
      let r = await call('subscribe/email', 'POST', { email: 'Fan@Example.com', consent: true });
      assert.equal(r.status, 200);
      const row = (await db()
        .prepare("SELECT * FROM subscribers WHERE address='fan@example.com'")
        .get()) as {
        id: string;
        status: string;
        confirm_nonce: string;
      };
      assert.equal(row.status, 'pending');
      const email = calls.find((c) => c.url.includes('resend'))!;
      const link = String(email.body.text).match(
        /http:\/\/localhost:4319\/confirm\?token=(\S+)/,
      )![1];
      r = await call('confirm', 'POST', { token: link });
      assert.equal(r.status, 200);
      assert.equal(
        (
          (await db().prepare('SELECT status FROM subscribers WHERE id=?').get(row.id)) as {
            status: string;
          }
        ).status,
        'active',
      );
      assert.equal((await call('confirm', 'POST', { token: link + 'tampered' })).status, 400);
      const expired = signedLink('confirm', row.id, `${row.confirm_nonce}:${Date.now() - 1000}`);
      assert.equal((await call('confirm', 'POST', { token: expired })).status, 400);
      assert.equal(
        (await call('subscribe/email', 'POST', { email: 'fan@example.com', consent: true })).status,
        200,
      );
      assert.equal(
        (
          (await db()
            .prepare("SELECT COUNT(*) as n FROM subscribers WHERE address='fan@example.com'")
            .get()) as {
            n: number;
          }
        ).n,
        1,
      );
    },
  );
  await t.test(
    'publishing is atomic and repeated publish does not duplicate notifications',
    async () => {
      await seedSubscriber('email', 'pending@example.com', 'pending');
      await seedSubscriber('email', 'left@example.com', 'unsubscribed');
      const r = await call(`admin/releases/${releaseId}/publish`, 'POST', { notify: true }, true);
      assert.equal(r.status, 200);
      assert.equal((await r.json()).queued, 1);
      const again = await call(
        `admin/releases/${releaseId}/publish`,
        'POST',
        { notify: true },
        true,
      );
      assert.equal((await again.json()).queued, 0);
      assert.equal((await (await call('releases')).json()).releases.length, 1);
    },
  );
  await t.test('published media supports bounded, suffix, and invalid range requests', async () => {
    let r = await call(`media/${audioId}`, 'GET', undefined, false, { range: 'bytes=5-14' });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), 'bytes 5-14/100');
    assert.equal((await r.arrayBuffer()).byteLength, 10);
    r = await call(`media/${audioId}`, 'GET', undefined, false, { range: 'bytes=-4' });
    assert.equal(r.status, 206);
    assert.equal((await r.arrayBuffer()).byteLength, 4);
    assert.equal(
      (await call(`media/${audioId}`, 'GET', undefined, false, { range: 'bytes=100-110' })).status,
      416,
    );
  });
  await t.test(
    'delivery failures retry, successful jobs are not resent, and unsubscribe is enforced',
    async () => {
      failEmail = true;
      let result = await drainQueue();
      assert.equal(result.failed, 1);
      assert.equal(
        (
          (await db().prepare('SELECT status FROM deliveries').get()) as {
            status: string;
          }
        ).status,
        'pending',
      );
      failEmail = false;
      await db().prepare('UPDATE deliveries SET next_attempt=0').run();
      result = await drainQueue();
      assert.equal(result.sent, 1);
      assert.equal((await drainQueue()).processed, 0);
      const row = (await db()
        .prepare("SELECT * FROM subscribers WHERE address='fan@example.com'")
        .get()) as {
        id: string;
        confirm_nonce: string;
      };
      const value = signedLink('unsubscribe', row.id, row.confirm_nonce);
      assert.equal((await call('unsubscribe', 'POST', { token: value })).status, 200);
      assert.equal(
        (
          (await db().prepare('SELECT status FROM subscribers WHERE id=?').get(row.id)) as {
            status: string;
          }
        ).status,
        'unsubscribed',
      );
    },
  );
  await t.test('analytics requires consent and deduplicates repeat plays', async () => {
    const visitorId = randomUUID();
    assert.equal(
      (await call('events', 'POST', { type: 'play', visitorId, releaseId, consent: false })).status,
      400,
    );
    const body = { type: 'play', visitorId, releaseId, consent: true };
    assert.equal((await call('events', 'POST', body)).status, 200);
    assert.equal((await call('events', 'POST', body)).status, 200);
    assert.equal(
      (
        (await db().prepare('SELECT COUNT(*) AS n FROM events').get()) as {
          n: number;
        }
      ).n,
      1,
    );
    assert.equal(
      (await call('events', 'POST', { ...body, releaseId: 'not-a-release' })).status,
      400,
    );
  });
  await t.test('Telegram validates webhook secrets and records explicit start/stop', async () => {
    const body = { message: { chat: { id: 123456, type: 'private' }, text: '/start' } };
    assert.equal((await call('telegram/webhook', 'POST', body)).status, 403);
    const headers = { 'x-telegram-bot-api-secret-token': 'test-webhook-secret' };
    assert.equal((await call('telegram/webhook', 'POST', body, false, headers)).status, 200);
    assert.equal(
      (
        (await db().prepare("SELECT status FROM subscribers WHERE channel='telegram'").get()) as {
          status: string;
        }
      ).status,
      'active',
    );
    body.message.text = '/stop';
    await call('telegram/webhook', 'POST', body, false, headers);
    assert.equal(
      (
        (await db().prepare("SELECT status FROM subscribers WHERE channel='telegram'").get()) as {
          status: string;
        }
      ).status,
      'unsubscribed',
    );
  });
  await t.test('push subscriptions cannot target private or attacker-controlled servers', () => {
    for (const endpoint of [
      'http://127.0.0.1:80/',
      'https://attacker.example/',
      'https://fcm.googleapis.com.attacker.example/',
      'https://fcm.googleapis.com:444/',
    ])
      assert.throws(() => validatePush({ endpoint, keys: { p256dh: 'a', auth: 'b' } }));
  });
  await t.test('unsubscribing before queued delivery skips the job', async () => {
    const id = await seedSubscriber('email', 'changed-mind@example.com', 'unsubscribed');
    await db()
      .prepare('INSERT INTO deliveries(id,release_id,subscriber_id) VALUES(?,?,?)')
      .run(randomUUID(), releaseId, id);
    const before = calls.length;
    const result = await drainQueue();
    assert.equal(result.sent, 0);
    assert.equal(calls.length, before);
    assert.equal(
      (
        (await db().prepare('SELECT status FROM deliveries WHERE subscriber_id=?').get(id)) as {
          status: string;
        }
      ).status,
      'skipped',
    );
  });
  await t.test('logout invalidates the persisted session', async () => {
    assert.equal((await call('logout', 'POST', {}, true)).status, 200);
    assert.equal((await call('admin/overview', 'GET', undefined, true)).status, 401);
    assert.equal(
      (
        (await db()
          .prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash=?')
          .get(hash(cookie.split('=')[1]))) as {
          n: number;
        }
      ).n,
      0,
    );
  });
});
test.after(async () => {
  globalThis.fetch = realFetch;
  await db().close();
  await database.cleanup();
});
