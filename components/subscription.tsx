'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bell, Check, Mail, Send } from 'lucide-react';
import { api, track } from '@/lib/client';
import type { PublicConfig } from '@/lib/types';
export default function Subscription({ config }: { config: PublicConfig }) {
  const [tab, setTab] = useState('Email'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [pushActive, setPushActive] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker
        .getRegistration('/')
        .then((r) => r?.pushManager?.getSubscription())
        .then((s) => setPushActive(Boolean(s)))
        .catch(() => {});
  }, []);
  function change(next: string) {
    setTab(next);
    setMessage('');
    setError('');
  }
  async function email(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const f = new FormData(event.currentTarget);
    try {
      const result = await api<{ message: string }>('/api/subscribe/email', {
        email: f.get('email'),
        website: f.get('website'),
        consent: f.get('consent') === 'on',
      });
      setMessage(result.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function push() {
    setBusy(true);
    setError('');
    setMessage('');
    let created: PushSubscription | null = null;
    try {
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      )
        throw new Error(
          'This browser doesn’t support notifications here. On iPhone or iPad, add this site to your Home Screen first.',
        );
      if (!window.isSecureContext)
        throw new Error('Browser notifications need a secure connection.');
      if (pushActive) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await api('/api/subscribe/push', { subscription: subscription.toJSON() }, 'DELETE');
          await subscription.unsubscribe();
        }
        setPushActive(false);
        setMessage('Browser notifications are off.');
        return;
      }
      if (!config.pushKey)
        throw new Error('Browser notifications will open soon. Please check back.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted')
        throw new Error(
          permission === 'denied'
            ? 'Notifications are blocked. You can allow them in your browser’s site settings.'
            : 'No problem. You can turn notifications on another time.',
        );
      await navigator.serviceWorker.register('/sw.js');
      const registration = await navigator.serviceWorker.ready;
      const base64 = config.pushKey.replace(/-/g, '+').replace(/_/g, '/');
      const applicationServerKey = Uint8Array.from(
        atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)),
        (c) => c.charCodeAt(0),
      );
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ||
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }));
      if (!existing) created = subscription;
      const result = await api<{ message: string }>('/api/subscribe/push', {
        subscription: subscription.toJSON(),
      });
      setPushActive(true);
      setMessage(result.message);
      track('subscribe');
    } catch (e) {
      if (created) await created.unsubscribe().catch(() => {});
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="subscribe-card">
      <div className="subscription-tabs" role="tablist" aria-label="How to subscribe">
        {[
          { name: 'Email', Icon: Mail },
          { name: 'Telegram', Icon: Send },
          { name: 'Push', Icon: Bell },
        ].map(({ name, Icon }, i) => (
          <button
            key={name}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            id={`tab-${name}`}
            aria-controls={`panel-${name}`}
            role="tab"
            aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1}
            className={tab === name ? 'active' : ''}
            onClick={() => change(name)}
            onKeyDown={(e) => {
              let n = i;
              if (e.key === 'ArrowRight') n = (i + 1) % 3;
              else if (e.key === 'ArrowLeft') n = (i + 2) % 3;
              else if (e.key === 'Home') n = 0;
              else if (e.key === 'End') n = 2;
              else return;
              e.preventDefault();
              change(['Email', 'Telegram', 'Push'][n]);
              tabs.current[n]?.focus();
            }}
          >
            <Icon size={13} />
            {name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'Email' ? (
          <>
            <h3>A note when there’s something new.</h3>
            <p>Only new music and occasional studio notes.</p>
            <form onSubmit={email}>
              <label className="sr-only" htmlFor="email">
                Your email address
              </label>
              <div className="email-field">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  placeholder="Your email address"
                  required
                  disabled={busy}
                />
                <button disabled={busy} aria-label="Subscribe by email">
                  {busy ? <span className="small">…</span> : <ArrowUpRight size={20} />}
                </button>
              </div>
              <div hidden aria-hidden="true">
                <label>
                  Website
                  <input name="website" tabIndex={-1} autoComplete="off" />
                </label>
              </div>
              <label className="checkbox-label">
                <input name="consent" type="checkbox" required disabled={busy} /> I’d like to
                receive new releases by email.
              </label>
            </form>
            <span className="fine-print">A little music. No noise. Unsubscribe anytime.</span>
          </>
        ) : tab === 'Telegram' ? (
          <>
            <h3>A little music in your messages.</h3>
            <p>Get a personal heads-up whenever a new experiment is ready to hear.</p>
            {config.telegram ? (
              <a
                className="button button-accent subscription-cta"
                href={`https://t.me/${config.telegram}?start=website`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Send size={16} /> Open Telegram <ArrowUpRight size={15} />
              </a>
            ) : (
              <div className="channel-soon">
                <Send size={18} />
                <span>
                  The studio’s Telegram bot is coming soon.
                  <small>Email and browser updates are here when connected.</small>
                </span>
              </div>
            )}
            <span className="fine-print">
              Tap Start in the bot to subscribe. Send /stop to leave.
            </span>
          </>
        ) : (
          <>
            <h3>Be here for the next drop.</h3>
            <p>A quiet notification on this device. No inbox, no account needed.</p>
            <button
              className="button button-accent subscription-cta"
              onClick={push}
              disabled={busy}
            >
              {pushActive ? <Check size={16} /> : <Bell size={16} />}{' '}
              {busy
                ? 'Connecting…'
                : pushActive
                  ? 'Turn off notifications'
                  : 'Enable notifications'}
            </button>
            <span className="fine-print">You can turn these off here anytime.</span>
          </>
        )}
        {message && (
          <p className="status-message" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
