'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Headphones,
  LockKeyhole,
  LogOut,
  Music2,
  Plus,
  Radio,
  Send,
  Upload as UploadIcon,
  Users,
  X,
} from 'lucide-react';
import { api, time } from '@/lib/client';
import type { PublicConfig, Release } from '@/lib/types';
type Overview = {
  stats: { releases: number; listeners: number; plays: number; subscribers: number };
  releases: Release[];
  channels: { channel: string; count: number }[];
  deliveries: { status: string; count: number }[];
  integrations: PublicConfig;
};
export default function Studio() {
  const [overview, setOverview] = useState<Overview | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [audio, setAudio] = useState<{ id: string; name: string; duration: number } | null>(null),
    [artwork, setArtwork] = useState<{ id: string; name: string } | null>(null),
    [publishing, setPublishing] = useState<Release | null>(null),
    [editing, setEditing] = useState<Release | null>(null),
    [notify, setNotify] = useState(true),
    [processing, setProcessing] = useState(false);
  const publishDialog = useRef<HTMLDialogElement>(null),
    editDialog = useRef<HTMLDialogElement>(null),
    releaseForm = useRef<HTMLFormElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    coverInput = useRef<HTMLInputElement>(null);
  async function refresh() {
    try {
      const response = await fetch('/api/admin/overview', { cache: 'no-store' });
      if (response.status === 401) {
        setOverview(null);
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setOverview(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  // This effect fetches external session state; state updates happen after the request.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, []);
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/login', { password: new FormData(event.currentTarget).get('password') });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File | undefined, kind: 'audio' | 'image') {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.set('file', file);
      const result = await api<{ id: string; kind: string }>('/api/admin/uploads', body);
      if (result.kind !== kind)
        throw new Error(
          kind === 'audio' ? 'Please choose an audio file.' : 'Please choose a cover image.',
        );
      if (kind === 'audio') {
        let duration = 0;
        const url = URL.createObjectURL(file);
        try {
          duration = await new Promise<number>((resolve) => {
            const el = new Audio();
            const timeout = setTimeout(() => {
              el.src = '';
              resolve(0);
            }, 5000);
            el.onloadedmetadata = () => {
              clearTimeout(timeout);
              resolve(Number.isFinite(el.duration) ? el.duration : 0);
              el.src = '';
            };
            el.onerror = () => {
              clearTimeout(timeout);
              resolve(0);
            };
            el.src = url;
          });
        } finally {
          URL.revokeObjectURL(url);
        }
        setAudio({ id: result.id, name: file.name, duration });
      } else setArtwork({ id: result.id, name: file.name });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!audio) throw new Error('Upload an audio file first.');
      const form = new FormData(event.currentTarget);
      await api('/api/admin/releases', {
        title: form.get('title'),
        description: form.get('description'),
        category: form.get('category'),
        audioId: audio.id,
        artworkId: artwork?.id,
        duration: audio.duration,
      });
      setAudio(null);
      setArtwork(null);
      releaseForm.current?.reset();
      if (fileInput.current) fileInput.current.value = '';
      if (coverInput.current) coverInput.current.value = '';
      setMessage('Draft saved. You can preview it before publishing.');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!publishing) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ queued: number }>(`/api/admin/releases/${publishing.id}/publish`, {
        notify,
      });
      publishDialog.current?.close();
      setPublishing(null);
      setMessage(`“${publishing.title}” is live. ${result.queued} notifications queued.`);
      await refresh();
      if (result.queued) void processQueue();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function processQueue() {
    setProcessing(true);
    setError('');
    try {
      let processed = 5;
      while (processed === 5) {
        const result = await api<{ processed: number }>('/api/admin/notifications/drain', {});
        processed = result.processed;
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcessing(false);
    }
  }
  async function saveEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      const f = new FormData(e.currentTarget);
      await api(
        `/api/admin/releases/${editing.id}`,
        { title: f.get('title'), description: f.get('description'), category: f.get('category') },
        'PATCH',
      );
      editDialog.current?.close();
      setEditing(null);
      setMessage('Release updated.');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="studio-loading">
        <span className="live-dot" /> Opening the studio…
      </main>
    );
  if (!overview)
    return (
      <main className="login-page">
        <a href="/" className="text-link">
          <ArrowLeft size={16} /> Back to the listening room
        </a>
        <section className="login-card">
          <LockKeyhole className="accent" size={27} />
          <div className="eyebrow muted">THE PRIVATE STUDIO</div>
          <h1>
            Welcome back,
            <br />
            Serhii<span>.</span>
          </h1>
          <p>A little space to make things happen.</p>
          <form onSubmit={login}>
            <label htmlFor="password">Studio password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
            />
            <button className="button button-accent" disabled={busy}>
              {busy ? 'Opening…' : 'Enter the studio'} <ArrowUpRight size={17} />
            </button>
          </form>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <p className="fine-print">Use the admin password configured for your studio.</p>
        </section>
        <span className="login-footer">SAMBORSKYI. / FOR THE LOVE OF SOUND</span>
      </main>
    );
  const pending = overview.deliveries.find((d) => d.status === 'pending')?.count || 0,
    failed = overview.deliveries.find((d) => d.status === 'failed')?.count || 0;
  return (
    <main className="studio-page">
      <header className="studio-header">
        <a className="brand" href="/">
          SAMBORSKYI<span className="accent">.</span>
          <span className="studio-badge">STUDIO</span>
        </a>
        <div>
          <a className="text-link" href="/">
            Visit site <ArrowUpRight size={16} />
          </a>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={async () => {
              try {
                await api('/api/logout', {});
                setOverview(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <div className="studio-intro">
        <div>
          <div className="eyebrow accent">YOUR SPACE TO CREATE</div>
          <h1>
            Back in the studio<span>.</span>
          </h1>
          <p>Share a sound. Find your people.</p>
        </div>
        <a href="#new-release" className="button button-accent">
          <Plus size={16} /> New experiment
        </a>
      </div>
      <div className="stat-grid">
        {[
          { label: 'Published experiments', value: overview.stats.releases, Icon: Music2 },
          { label: 'Listeners · 30 days', value: overview.stats.listeners, Icon: Headphones },
          { label: 'Plays · 30 days', value: overview.stats.plays, Icon: Radio },
          { label: 'Active subscriptions', value: overview.stats.subscribers, Icon: Users },
        ].map(({ label, value, Icon }) => (
          <div className="stat-card" key={label}>
            <span>
              {label}
              <Icon size={17} />
            </span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p className="stats-note">
        Listening statistics include visitors who allow analytics. Subscriptions count channels, so
        one listener may subscribe more than once.
      </p>
      {message && (
        <p className="studio-notice" role="status">
          <Check size={16} />
          {message}
        </p>
      )}
      {error && (
        <p className="studio-notice error-message" role="alert">
          {error}
        </p>
      )}
      <div className="studio-grid">
        <section className="studio-panel" id="new-release">
          <div className="panel-heading">
            <h2>A new experiment</h2>
            <span>START WITH A SOUND</span>
          </div>
          <form ref={releaseForm} onSubmit={saveDraft}>
            <label className={`upload-zone ${audio ? 'uploaded' : ''}`}>
              <input
                ref={fileInput}
                type="file"
                accept="audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,.mp3,.wav,.ogg,.flac,.m4a"
                disabled={busy}
                onChange={(e) => void upload(e.target.files?.[0], 'audio')}
              />
              {audio ? <Check size={27} /> : <UploadIcon size={27} />}
              <strong>{audio ? audio.name : busy ? 'Uploading…' : 'Choose your audio file'}</strong>
              <span>
                {audio
                  ? `${time(audio.duration)} · Click to replace`
                  : 'MP3, WAV, OGG, FLAC or M4A · up to 80 MB'}
              </span>
            </label>
            <label htmlFor="title">Experiment title</label>
            <input
              id="title"
              name="title"
              placeholder="Give this sound a name"
              maxLength={120}
              required
            />
            <div className="form-columns">
              <div>
                <label htmlFor="category">Category</label>
                <select id="category" name="category">
                  <option>Experimental</option>
                  <option>Ambient</option>
                  <option>Electronic</option>
                  <option>Piano</option>
                  <option>Cinematic</option>
                  <option>Field recordings</option>
                </select>
              </div>
              <div>
                <label htmlFor="cover">
                  Cover artwork <span className="muted">(optional)</span>
                </label>
                <label className="file-button" htmlFor="cover">
                  <input
                    ref={coverInput}
                    id="cover"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={busy}
                    onChange={(e) => void upload(e.target.files?.[0], 'image')}
                  />
                  <UploadIcon size={14} />
                  <span>{artwork ? artwork.name : 'Choose image'}</span>
                </label>
              </div>
            </div>
            <label htmlFor="description">A note from the studio</label>
            <textarea
              id="description"
              name="description"
              placeholder="What were you exploring? What should we listen for?"
              rows={4}
              maxLength={2000}
            />
            <div className="form-bottom">
              <span>Saved as a draft until you publish.</span>
              <button className="button button-accent" disabled={busy || !audio}>
                {busy ? 'Saving…' : 'Save experiment'} <ArrowUpRight size={16} />
              </button>
            </div>
          </form>
        </section>
        <aside className="studio-sidebar">
          <section className="studio-panel">
            <div className="panel-heading">
              <h2>Your connections</h2>
              <Users size={17} />
            </div>
            {[
              {
                name: 'Email',
                connected: overview.integrations.email,
                hint: 'Resend · confirmation required',
                channel: 'email',
              },
              {
                name: 'Telegram',
                connected: Boolean(overview.integrations.telegram),
                hint: overview.integrations.telegram
                  ? `@${overview.integrations.telegram}`
                  : 'Your studio bot',
                channel: 'telegram',
              },
              {
                name: 'Browser push',
                connected: Boolean(overview.integrations.pushKey),
                hint: 'New releases on their devices',
                channel: 'push',
              },
            ].map((c) => (
              <div className="connection-row" key={c.name}>
                <div>
                  <strong>{c.name}</strong>
                  <small>{c.hint}</small>
                </div>
                <span className={c.connected ? 'connected' : 'unconnected'}>
                  {c.connected
                    ? `${overview.channels.find((x) => x.channel === c.channel)?.count || 0} subscribed`
                    : 'Setup needed'}
                </span>
              </div>
            ))}
            <p className="fine-print">
              Connect these services with your server environment variables. Secrets never appear on
              the public site.
            </p>
          </section>
          <section className="studio-panel">
            <div className="panel-heading">
              <h2>Audience insights</h2>
              <Radio size={17} />
            </div>
            <div className="connection-row">
              <div>
                <strong>Meta Pixel</strong>
                <small>Visits · plays · engaged listeners</small>
              </div>
              <span className={overview.integrations.pixelId ? 'connected' : 'unconnected'}>
                {overview.integrations.pixelId ? 'Connected' : 'Setup needed'}
              </span>
            </div>
            <p className="fine-print">
              Marketing events are sent only after a visitor opts in. Use these events in Meta’s
              audience tools.
            </p>
          </section>
          <section className="studio-panel">
            <div className="panel-heading">
              <h2>Notification outbox</h2>
              <Send size={16} />
            </div>
            <div className="outbox-counts">
              <span>
                <b>{pending}</b> queued
              </span>
              <span>
                <b>{overview.deliveries.find((d) => d.status === 'sent')?.count || 0}</b> sent
              </span>
              <span>
                <b>{failed}</b> failed
              </span>
            </div>
            <button
              className="button full-width"
              disabled={processing || !pending}
              onClick={() => void processQueue()}
            >
              {processing ? 'Sending…' : 'Process queued notifications'}
            </button>
            {failed > 0 && (
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await api('/api/admin/notifications/retry', {});
                    await processQueue();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Retry failed deliveries
              </button>
            )}
            <p className="fine-print">
              Notifications send and retry automatically in the background.
            </p>
          </section>
        </aside>
      </div>
      <section className="studio-panel studio-releases">
        <div className="panel-heading">
          <h2>Your experiments</h2>
          <span>{overview.releases.length} IN THE ARCHIVE</span>
        </div>
        {overview.releases.length === 0 ? (
          <div className="studio-empty">
            <Music2 size={30} />
            <h3>Your first transmission starts here.</h3>
            <p>Upload a sound, add a few words, and make it yours.</p>
          </div>
        ) : (
          overview.releases.map((r) => (
            <article className="studio-release" key={r.id}>
              <div className="studio-release-top">
                <div>
                  <span className={`release-status ${r.status}`}>{r.status}</span>
                  <h3>{r.title}</h3>
                  <small>
                    {r.category} · {time(r.duration)}
                  </small>
                </div>
                <div className="release-admin-actions">
                  <button
                    className="button button-small"
                    onClick={() => {
                      setEditing(r);
                      editDialog.current?.showModal();
                    }}
                  >
                    Edit note
                  </button>
                  {r.status === 'draft' ? (
                    <button
                      className="button button-accent button-small"
                      onClick={() => {
                        setPublishing(r);
                        setNotify(true);
                        publishDialog.current?.showModal();
                      }}
                    >
                      Publish <ArrowUpRight size={15} />
                    </button>
                  ) : (
                    <a className="text-link" href={`/listen/${r.id}`}>
                      Open release <ArrowUpRight size={16} />
                    </a>
                  )}
                </div>
              </div>
              <audio controls preload="none" src={`/api/media/${r.audio_id}`} />
            </article>
          ))
        )}
      </section>
      <dialog ref={publishDialog} className="modal" onCancel={() => setPublishing(null)}>
        <button
          className="icon-button modal-close"
          aria-label="Cancel publishing"
          onClick={() => publishDialog.current?.close()}
          disabled={busy}
        >
          <X size={20} />
        </button>
        <div className="eyebrow accent">READY TO BE HEARD</div>
        <h2>Let it out into the world.</h2>
        <p>“{publishing?.title}” will be available to everyone who visits your listening room.</p>
        <label className="checkbox-label publish-checkbox">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />{' '}
          Notify {overview.stats.subscribers} active subscriptions by their chosen channel.
        </label>
        <p className="fine-print">
          Each subscription receives this release once. Failed deliveries are retried.
        </p>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="button" disabled={busy} onClick={() => publishDialog.current?.close()}>
            Keep as draft
          </button>
          <button className="button button-accent" disabled={busy} onClick={() => void publish()}>
            {busy ? 'Publishing…' : 'Publish release'}
          </button>
        </div>
      </dialog>
      <dialog ref={editDialog} className="modal">
        <button
          className="icon-button modal-close"
          aria-label="Close edit"
          onClick={() => editDialog.current?.close()}
        >
          <X size={20} />
        </button>
        <h2>A note from the studio.</h2>
        {editing && (
          <form key={editing.id} onSubmit={saveEdit}>
            <label htmlFor="edit-title">Title</label>
            <input
              id="edit-title"
              name="title"
              defaultValue={editing.title}
              maxLength={120}
              required
            />
            <label htmlFor="edit-category">Category</label>
            <input
              id="edit-category"
              name="category"
              defaultValue={editing.category}
              maxLength={40}
              required
            />
            <label htmlFor="edit-description">Studio note</label>
            <textarea
              id="edit-description"
              name="description"
              defaultValue={editing.description}
              rows={5}
              maxLength={2000}
            />
            <button className="button button-accent" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
          </form>
        )}
      </dialog>
    </main>
  );
}
