import type { PublicConfig, Release } from './types';
export type Consent = { analytics: boolean; marketing: boolean };
type Pixel = ((...args: unknown[]) => void) & {
  queue: unknown[][];
  callMethod?: (...args: unknown[]) => void;
  push?: Pixel;
  loaded?: boolean;
  version?: string;
};
declare global {
  interface Window {
    fbq?: Pixel;
    _fbq?: Pixel;
  }
}
let current: Consent = { analytics: false, marketing: false };
let pixelId: string | null = null;
let pageTracked = false;
export function getConsent(): Consent | null {
  try {
    const data = JSON.parse(localStorage.getItem('ss-consent') || 'null');
    return data && data.version === 1 && Date.now() - data.savedAt < 180 * 86400000
      ? { analytics: data.analytics === true, marketing: data.marketing === true }
      : null;
  } catch {
    return null;
  }
}
export function applyConsent(value: Consent, config: PublicConfig) {
  current = value;
  if (value.marketing && config.pixelId) {
    if (!window.fbq) {
      const fbq: Pixel = Object.assign(
        function (...args: unknown[]) {
          if (fbq.callMethod) fbq.callMethod(...args);
          else fbq.queue.push(args);
        },
        { queue: [] as unknown[][] },
      );
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = '2.0';
      window.fbq = fbq;
      window._fbq = fbq;
      fbq('consent', 'grant');
      fbq('init', config.pixelId);
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://connect.facebook.net/en_US/fbevents.js';
      script.id = 'meta-pixel';
      document.head.append(script);
      pixelId = config.pixelId;
    } else window.fbq('consent', 'grant');
    if (pixelId && !pageTracked) {
      window.fbq?.('track', 'PageView');
      pageTracked = true;
    }
  } else {
    window.fbq?.('consent', 'revoke');
    for (const name of ['_fbp', '_fbc']) {
      document.cookie = `${name}=; Max-Age=0; Path=/`;
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${location.hostname}`;
    }
  }
  if (!value.analytics) {
    try {
      localStorage.removeItem('ss-listener');
    } catch {
      /* Storage may be disabled. */
    }
  }
}
export function saveConsent(value: Consent, config: PublicConfig) {
  try {
    localStorage.setItem(
      'ss-consent',
      JSON.stringify({ ...value, version: 1, savedAt: Date.now() }),
    );
  } catch {
    /* Consent still applies to this visit. */
  }
  applyConsent(value, config);
}
export function track(
  type: 'page_view' | 'play' | 'listen_30' | 'complete' | 'subscribe',
  release?: Release,
) {
  if (current.analytics) {
    let id: string | null;
    try {
      id = localStorage.getItem('ss-listener');
    } catch {
      return;
    }
    if (!id) {
      id = crypto.randomUUID();
      try {
        localStorage.setItem('ss-listener', id);
      } catch {
        return;
      }
    }
    void fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, releaseId: release?.id, visitorId: id, consent: true }),
      keepalive: true,
    }).catch(() => {});
  }
  if (current.marketing && window.fbq) {
    if (type === 'play')
      window.fbq('track', 'ViewContent', {
        content_ids: [release?.id],
        content_name: release?.title,
        content_type: 'music',
      });
    if (type === 'listen_30')
      window.fbq('trackCustom', 'EngagedListen', { release_id: release?.id });
    if (type === 'complete')
      window.fbq('trackCustom', 'TrackCompleted', { release_id: release?.id });
    if (type === 'subscribe') window.fbq('track', 'Subscribe');
  }
}
export async function api<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
  method = 'POST',
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data as T;
}
export function time(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
