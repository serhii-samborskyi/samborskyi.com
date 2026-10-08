import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PublicConfig } from '../lib/types';
const memory = new Map<string, string>(),
  scripts: { src?: string }[] = [],
  requests: string[] = [];
const storage = {
  getItem: (key: string) => memory.get(key) || null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    cookie: '',
    createElement: () => ({}),
    head: { append: (s: { src?: string }) => scripts.push(s) },
  },
});
Object.defineProperty(globalThis, 'location', {
  configurable: true,
  value: { hostname: 'music.example.com' },
});
globalThis.fetch = async (input) => {
  requests.push(String(input));
  return Response.json({ ok: true });
};
const { applyConsent, saveConsent, getConsent, track } = await import('../lib/client');
const config: PublicConfig = {
  email: false,
  telegram: null,
  pushKey: null,
  pixelId: '12345678901',
};
test('optional tracking stays off until consent and can be withdrawn', () => {
  applyConsent({ analytics: false, marketing: false }, config);
  track('page_view');
  track('subscribe');
  assert.equal(scripts.length, 0);
  assert.equal(requests.length, 0);
  assert.equal(memory.has('ss-listener'), false);
  saveConsent({ analytics: true, marketing: false }, config);
  track('page_view');
  assert.equal(requests.length, 1);
  assert.equal(scripts.length, 0);
  assert.equal(memory.has('ss-listener'), true);
  saveConsent({ analytics: true, marketing: true }, config);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'https://connect.facebook.net/en_US/fbevents.js');
  track('subscribe');
  assert.ok(window.fbq?.queue.some((args) => args[1] === 'Subscribe'));
  const count = requests.length,
    events = window.fbq!.queue.length;
  saveConsent({ analytics: false, marketing: false }, config);
  track('subscribe');
  assert.equal(requests.length, count);
  assert.equal(memory.has('ss-listener'), false);
  assert.equal(window.fbq!.queue.length, events + 1);
  assert.deepEqual(window.fbq!.queue.at(-1), ['consent', 'revoke']);
  assert.deepEqual(getConsent(), { analytics: false, marketing: false });
});
test('expired and malformed consent never grant permission', () => {
  storage.setItem('ss-consent', 'broken');
  assert.equal(getConsent(), null);
  storage.setItem(
    'ss-consent',
    JSON.stringify({
      version: 1,
      savedAt: Date.now() - 181 * 86400000,
      analytics: true,
      marketing: true,
    }),
  );
  assert.equal(getConsent(), null);
});
test('disabled browser storage cannot break essential-only choices', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    },
  });
  assert.equal(getConsent(), null);
  assert.doesNotThrow(() => saveConsent({ analytics: false, marketing: false }, config));
});
