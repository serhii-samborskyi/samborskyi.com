'use client';
import { useState } from 'react';
import { Check, Mail } from 'lucide-react';
import { api, applyConsent, getConsent, track } from '@/lib/client';
import type { PublicConfig } from '@/lib/types';
export default function TokenAction({
  mode,
  value,
}: {
  mode: 'confirm' | 'unsubscribe';
  value: string;
}) {
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  async function run() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ message: string }>(`/api/${mode}`, { token: value });
      setMessage(result.message);
      setDone(true);
      if (mode === 'confirm') {
        const config = await api<PublicConfig>('/api/config', undefined, 'GET');
        const consent = getConsent();
        if (consent) {
          applyConsent(consent, config);
          track('subscribe');
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="simple-page">
      <a href="/" className="text-link">
        ← Back to the listening room
      </a>
      <section className="token-card">
        {done ? <Check size={35} className="accent" /> : <Mail size={35} className="accent" />}
        <h1>
          {done
            ? 'All set.'
            : mode === 'confirm'
              ? 'A little closer to the sound.'
              : 'Time for a little quiet?'}
        </h1>
        <p>
          {done
            ? message
            : mode === 'confirm'
              ? 'Confirm your email to hear when Serhii shares something new.'
              : 'Unsubscribe from new release emails. You’re always welcome in the listening room.'}
        </p>
        {!done && value && (
          <button className="button button-accent" disabled={busy} onClick={() => void run()}>
            {busy
              ? 'One moment…'
              : mode === 'confirm'
                ? 'Confirm my subscription'
                : 'Unsubscribe from emails'}
          </button>
        )}
        {!value && (
          <p className="error-message">
            This link is missing its confirmation code. Please use the link in your email.
          </p>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {done && (
          <a className="button" href="/">
            Back to the music ↗
          </a>
        )}
      </section>
    </main>
  );
}
