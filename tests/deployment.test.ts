import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './test-database';
const database = await testDatabase();
const { db, transaction, postgresSql } = await import('../lib/db');
const { bootstrap } = await import('../lib/bootstrap');
const { siteOrigin } = await import('../lib/site-origin');
const { verifyPassword, token, hash } = await import('../lib/security');
const { publishRelease, drainQueue } = await import('../lib/releases');
process.env.ADMIN_PASSWORD = 'testing-a-strong-admin-password';
process.env.COOLIFY_URL = 'https://music.example.com,https://www.music.example.com';
delete process.env.APP_URL;
delete process.env.ADMIN_PASSWORD_HASH;
delete process.env.SESSION_SECRET;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;
delete process.env.TELEGRAM_WEBHOOK_SECRET;
Object.assign(process.env, { NODE_ENV: 'production' });

test('Coolify runtime configuration and database persistence', async (t) => {
  await t.test(
    'boots using only database URL, admin password, and automatic Coolify domain',
    async () => {
      await bootstrap();
      assert.equal(siteOrigin(), 'https://music.example.com');
      assert.equal(verifyPassword(process.env.ADMIN_PASSWORD!), true);
      assert.equal(verifyPassword('wrong-password'), false);
      assert.ok(process.env.SESSION_SECRET!.length >= 32);
      assert.ok(process.env.VAPID_PUBLIC_KEY);
      assert.equal(process.env.VAPID_SUBJECT, 'https://music.example.com');
    },
  );
  await t.test('keys survive a fresh process configuration and reopened database', async () => {
    const original = {
      secret: process.env.SESSION_SECRET,
      key: process.env.VAPID_PRIVATE_KEY,
      webhook: process.env.TELEGRAM_WEBHOOK_SECRET,
    };
    delete process.env.SESSION_SECRET;
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    await db().close();
    await bootstrap();
    assert.equal(process.env.SESSION_SECRET, original.secret);
    assert.equal(process.env.VAPID_PRIVATE_KEY, original.key);
    assert.equal(process.env.TELEGRAM_WEBHOOK_SECRET, original.webhook);
  });
  await t.test(
    'password changes invalidate existing sessions without rotating subscription signing keys',
    async () => {
      const secret = process.env.SESSION_SECRET;
      await db()
        .prepare('INSERT INTO sessions(token_hash,expires_at) VALUES(?,?)')
        .run(hash(token()), Date.now() + 86400000);
      process.env.ADMIN_PASSWORD = 'a-new-strong-admin-password';
      await bootstrap();
      assert.equal((await db().prepare('SELECT COUNT(*) AS n FROM sessions').get())!.n, 0);
      assert.equal(process.env.SESSION_SECRET, secret);
      assert.equal(verifyPassword('a-new-strong-admin-password'), true);
      assert.equal(verifyPassword('testing-a-strong-admin-password'), false);
    },
  );
  await t.test(
    'binary uploads survive reopening and support slices without loading the full audio',
    async () => {
      const bytes = Buffer.from([0, 255, 13, 10, 1, 2, 128, 0]);
      await db()
        .prepare(
          'INSERT INTO uploads(id,filename,mime,size,kind,created_at,content) VALUES(?,?,?,?,?,?,?)',
        )
        .run('upload', 'test.wav', 'audio/wav', bytes.length, 'audio', Date.now(), bytes);
      await db().close();
      const slice = await db()
        .prepare('SELECT substr(content,?,?) AS bytes FROM uploads WHERE id=?')
        .get(2, 4, 'upload');
      assert.deepEqual(Buffer.from(slice!.bytes as Uint8Array), bytes.subarray(1, 5));
    },
  );
  await t.test('failed transactions roll back, without rolling back concurrent work', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const failing = transaction(async () => {
      await db()
        .prepare('INSERT INTO app_settings(key,value) VALUES(?,?)')
        .run('rolled_back', 'no');
      entered();
      await held;
      throw new Error('intentional rollback');
    });
    const rejection = assert.rejects(failing, /intentional rollback/);
    await started;
    const independent = db()
      .prepare('INSERT INTO app_settings(key,value) VALUES(?,?)')
      .run('independent', 'yes');
    release();
    await rejection;
    await independent;
    assert.equal(
      await db().prepare('SELECT value FROM app_settings WHERE key=?').get('rolled_back'),
      undefined,
    );
    assert.equal(
      (await db().prepare('SELECT value FROM app_settings WHERE key=?').get('independent'))!.value,
      'yes',
    );
  });
  await t.test('concurrent publish and queue consumers never duplicate jobs', async () => {
    await db()
      .prepare(
        'INSERT INTO releases(id,title,description,category,audio_id,created_at) VALUES(?,?,?,?,?,?)',
      )
      .run('release', 'Sound', 'Note', 'Ambient', 'upload', Date.now());
    await db()
      .prepare(
        'INSERT INTO subscribers(id,channel,address,status,confirm_nonce,created_at) VALUES(?,?,?,?,?,?)',
      )
      .run('subscriber', 'email', 'test@example.com', 'active', 'nonce', Date.now());
    const publications = await Promise.all([
      publishRelease('release', true),
      publishRelease('release', true),
      publishRelease('release', true),
    ]);
    assert.equal(
      publications.reduce((n, r) => n + r.queued, 0),
      1,
    );
    await db().prepare("UPDATE subscribers SET status='unsubscribed' WHERE id='subscriber'").run();
    const drains = await Promise.all([drainQueue(), drainQueue()]);
    assert.equal(
      drains.reduce((n, r) => n + r.processed, 0),
      1,
    );
  });
  await t.test(
    'rejects weak passwords and never trusts request headers for canonical URLs',
    async () => {
      process.env.ADMIN_PASSWORD = 'short';
      await assert.rejects(bootstrap, /12–200/);
      process.env.ADMIN_PASSWORD = 'a-new-strong-admin-password';
      delete process.env.APP_URL;
      delete process.env.COOLIFY_URL;
      process.env.COOLIFY_FQDN = 'music.example.com,www.music.example.com';
      assert.equal(siteOrigin(), 'https://music.example.com');
      delete process.env.COOLIFY_FQDN;
      assert.throws(siteOrigin, /Assign a domain/);
      process.env.APP_URL = 'javascript:alert(1)';
      assert.throws(siteOrigin, /HTTP\(S\)/);
      process.env.APP_URL = 'https://music.example.com';
    },
  );
  await t.test('SQL parameters preserve literals and conflict semantics', () => {
    assert.equal(
      postgresSql("SELECT '?' AS mark, ? AS value, 'isn''t ?' AS text"),
      "SELECT '?' AS mark, $1 AS value, 'isn''t ?' AS text",
    );
    assert.equal(
      postgresSql('INSERT OR IGNORE INTO x(id) VALUES(?)'),
      'INSERT INTO x(id) VALUES($1) ON CONFLICT DO NOTHING',
    );
  });
});
test.after(async () => {
  await db().close();
  await database.cleanup();
});
