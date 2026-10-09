import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteOrigin, siteOrigins } from '../lib/site-origin';
import { sameOrigin } from '../lib/security';

const keys = ['APP_URL', 'COOLIFY_URL', 'COOLIFY_FQDN', 'NODE_ENV', 'PORT'] as const;
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
test.beforeEach(() => {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: 'production' });
});
test.after(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: saved[key] });
  }
});

test('all configured domains are accepted, while the first remains canonical', () => {
  process.env.COOLIFY_URL =
    ' https://preview.example.com, https://music.example.com, https://www.music.example.com, ';
  assert.equal(siteOrigin(), 'https://preview.example.com');
  for (const origin of siteOrigins())
    assert.doesNotThrow(() =>
      sameOrigin(new Request('http://container:3000/api/login', { headers: { origin } })),
    );
  process.env.APP_URL = 'https://music.example.com';
  assert.deepEqual(siteOrigins(), [
    'https://music.example.com',
    'https://preview.example.com',
    'https://www.music.example.com',
  ]);
});

test('Coolify target ports are stripped, but explicit public ports are preserved', () => {
  process.env.COOLIFY_URL = 'https://music.example.com:3000,http://preview.example.com:8080';
  assert.deepEqual(siteOrigins(), ['https://music.example.com', 'http://preview.example.com']);
  process.env.APP_URL = 'http://localhost:4319';
  assert.equal(siteOrigin(), 'http://localhost:4319');
});

test('FQDN fallback handles all domains without inventing HTTPS aliases for HTTP URLs', () => {
  process.env.COOLIFY_URL = ' ';
  process.env.COOLIFY_FQDN = 'music.example.com:3000, www.music.example.com:3000';
  assert.deepEqual(siteOrigins(), ['https://music.example.com', 'https://www.music.example.com']);
  process.env.COOLIFY_URL = 'http://music.example.com:3000';
  assert.deepEqual(siteOrigins(), ['http://music.example.com']);
});

test('missing, malformed, or untrusted origins cannot bypass the check with proxy headers', () => {
  process.env.COOLIFY_URL = 'https://music.example.com:3000';
  for (const origin of [
    undefined,
    'null',
    'http://music.example.com',
    'https://music.example.com:3000',
    'https://music.example.com.attacker.example',
    'https://attacker.example',
    'https://music.example.com https://attacker.example',
    'https://music.example.com/path',
  ]) {
    const headers: Record<string, string> = {
      host: 'attacker.example',
      'x-forwarded-host': 'attacker.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin',
    };
    if (origin !== undefined) headers.origin = origin;
    assert.throws(
      () => sameOrigin(new Request('https://attacker.example/api/login', { headers })),
      { status: 403 },
    );
  }
});

test('invalid or missing deployment configuration fails closed', () => {
  assert.throws(siteOrigins, /Assign a domain/);
  for (const value of [
    'javascript:alert(1)',
    'ftp://music.example.com',
    'https://user:pass@music.example.com',
  ]) {
    process.env.APP_URL = value;
    assert.throws(siteOrigins, /HTTP\(S\)/);
  }
  delete process.env.APP_URL;
  process.env.COOLIFY_URL = 'https://music.example.com,ftp://other.example.com';
  assert.throws(siteOrigins, /HTTP\(S\)/);
});
