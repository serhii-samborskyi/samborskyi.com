'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X, ShieldCheck } from 'lucide-react';
import { applyConsent, getConsent, saveConsent, track } from '@/lib/client';
import type { PublicConfig } from '@/lib/types';
export default function ConsentSettings({ config }: { config: PublicConfig }) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [dismissed, setDismissed] = useState(false),
    [analytics, setAnalytics] = useState(false),
    [marketing, setMarketing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const existing = getConsent();
    if (existing) {
      applyConsent(existing, config);
      if (existing.analytics) track('page_view');
    }
    const open = () => {
      const current = getConsent();
      setAnalytics(current?.analytics || false);
      setMarketing(current?.marketing || false);
      dialog.current?.showModal();
    };
    const keyboard = () => {
      document.documentElement.dataset.keyboard = 'true';
    };
    const pointer = () => {
      delete document.documentElement.dataset.keyboard;
    };
    window.addEventListener('open-privacy', open);
    window.addEventListener('keydown', keyboard);
    window.addEventListener('pointerdown', pointer);
    return () => {
      window.removeEventListener('open-privacy', open);
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('pointerdown', pointer);
    };
  }, [config]);
  function save(a: boolean, m: boolean) {
    try {
      saveConsent({ analytics: a, marketing: m }, config);
      if (a) track('page_view');
    } catch {
      applyConsent({ analytics: false, marketing: false }, config);
    }
    setDismissed(true);
    dialog.current?.close();
  }
  return (
    <>
      {mounted && !dismissed && !getConsent() && (
        <aside className="consent-banner" aria-label="Privacy choices">
          <div>
            <ShieldCheck size={18} />
            <p>
              Your listening, your choice.
              <span>
                Optional analytics help me understand what resonates. Meta helps my music reach new
                listeners.
              </span>
            </p>
          </div>
          <div className="consent-actions">
            <button onClick={() => save(false, false)}>Essential only</button>
            <button onClick={() => dialog.current?.showModal()}>Choose cookies</button>
          </div>
        </aside>
      )}
      <dialog ref={dialog} className="modal privacy-modal">
        <button
          className="icon-button modal-close"
          aria-label="Close privacy settings"
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
        <div className="eyebrow accent">YOUR PRIVACY</div>
        <h2>Make yourself comfortable.</h2>
        <p>Music and subscriptions work with optional tracking switched off.</p>
        <label className="preference">
          <span>
            <b>Listening analytics</b>
            <small>
              Anonymous visits, plays, and listening milestones. Helps me understand the music you
              enjoy.
            </small>
          </span>
          <input
            type="checkbox"
            checked={analytics}
            onChange={(e) => setAnalytics(e.target.checked)}
          />
        </label>
        <label className="preference">
          <span>
            <b>Reach more listeners</b>
            <small>
              Allow the Meta Pixel to measure visits and music engagement and help build advertising
              audiences.
            </small>
          </span>
          <input
            type="checkbox"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
          />
        </label>
        <div className="modal-actions">
          <button className="button" onClick={() => save(false, false)}>
            Essential only
          </button>
          <button className="button button-accent" onClick={() => save(analytics, marketing)}>
            Save my choices
          </button>
        </div>
        <a className="fine-print" href="/privacy">
          Read the privacy note ↗
        </a>
      </dialog>
    </>
  );
}
