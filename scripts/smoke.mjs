import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const base = process.env.SMOKE_BASE_URL;
const password = process.env.SMOKE_ADMIN_PASSWORD;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || !password)
  throw new Error(
    'Use SMOKE_BASE_URL pointing to a disposable localhost app and SMOKE_ADMIN_PASSWORD.',
  );
const file = process.env.SMOKE_STATE_FILE || path.join(tmpdir(), 'samborskyi-smoke-state.json');
const digest = (b) => createHash('sha256').update(b).digest('hex');
let cookie = '';
async function request(endpoint, body) {
  const response = await fetch(base + endpoint, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: base,
      Cookie: cookie,
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  assert.ok(response.ok, `${endpoint}: ${response.status}`);
  return response;
}
assert.equal((await fetch(base + '/api/health')).status, 200);
if (process.argv.includes('--verify')) {
  const state = JSON.parse(readFileSync(file, 'utf8'));
  cookie = state.cookie;
  await request('/api/admin/overview');
  assert.equal(
    digest(Buffer.from(await (await request('/api/media/' + state.audio)).arrayBuffer())),
    state.hash,
  );
  const release = await request('/listen/' + state.release);
  const html = await release.text();
  assert.ok(html.includes('Container persistence check'));
  const range = await fetch(base + '/api/media/' + state.audio, {
    headers: { Range: 'bytes=0-15' },
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 16);
  const config = await (await request('/api/config')).json();
  assert.equal(config.pushKey, state.pushKey);
  await request('/api/logout', {});
  assert.equal(
    (await fetch(base + '/api/admin/overview', { headers: { Cookie: cookie } })).status,
    401,
  );
  console.log(
    'Container replacement verified: published release, audio bytes, session, VAPID key, seeking, and logout.',
  );
} else {
  const login = await request('/api/login', { password });
  cookie = login.headers.get('set-cookie').split(';')[0];
  await request('/api/admin/overview');
  const wav = Buffer.alloc(32044);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(32000, 40);
  const form = new FormData();
  form.set('file', new File([wav], 'smoke.wav', { type: 'audio/wav' }));
  const audio = (await (await request('/api/admin/uploads', form)).json()).id;
  assert.equal((await fetch(base + '/api/media/' + audio)).status, 401);
  const release = (
    await (
      await request('/api/admin/releases', {
        title: 'Container persistence check',
        description: 'Isolated automated deployment check.',
        category: 'Experimental',
        audioId: audio,
        duration: 1,
      })
    ).json()
  ).id;
  assert.equal((await fetch(base + '/listen/' + release)).status, 404);
  await request('/api/admin/releases/' + release + '/publish', { notify: false });
  const html = await (await request('/listen/' + release)).text();
  assert.ok(html.includes('property="og:title" content="Container persistence check"'));
  const root = await (await request('/')).text();
  assert.ok(root.includes('Container persistence check'));
  const config = await (await request('/api/config')).json();
  assert.ok(config.pushKey);
  writeFileSync(
    file,
    JSON.stringify({ audio, release, hash: digest(wav), cookie, pushKey: config.pushKey }),
    { mode: 0o600 },
  );
  console.log(
    'HTTP smoke passed: login, private upload/draft, publication, playback, metadata, and automatic push configuration.',
  );
}
