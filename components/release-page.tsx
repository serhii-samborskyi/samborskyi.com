'use client';
import { useState } from 'react';
import { Play } from 'lucide-react';
import type { PublicConfig, Release } from '@/lib/types';
import Player from './player';
import ConsentSettings from './consent';
export default function ReleasePage({
  release,
  config,
}: {
  release: Release;
  config: PublicConfig;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <main className="simple-page release-page">
        <a className="text-link" href="/">
          ← All experiments
        </a>
        <div className="eyebrow accent">
          {release.category.toUpperCase()} /{' '}
          {new Date(release.published_at!).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC',
          })}
        </div>
        <h1>{release.title}</h1>
        <div className="release-page-art">
          {release.artwork_id ? (
            <img src={`/api/media/${release.artwork_id}`} alt={`Artwork for ${release.title}`} />
          ) : (
            <img src="/serhii-cover.png" alt="Serhii Samborskyi" />
          )}
        </div>
        <button className="button button-accent" onClick={() => setPlaying(true)}>
          <Play size={16} /> Listen to this experiment
        </button>
        <p className="release-description">{release.description}</p>
        <div className="release-bottom">
          <div className="eyebrow">A NOTE FROM SERHII SAMBORSKYI</div>
          <p>Like where this is going? Come along for the next experiment.</p>
          <a className="button" href="/#subscribe">
            Stay in the loop ↗
          </a>
          <p>
            <button
              className="footer-button"
              onClick={() => window.dispatchEvent(new Event('open-privacy'))}
            >
              Cookie choices
            </button>{' '}
            · <a href="/privacy">Privacy</a>
          </p>
        </div>
      </main>
      <ConsentSettings config={config} />
      {playing && (
        <>
          <div className="player-space" />
          <Player
            release={release}
            queue={[release]}
            onChange={() => {}}
            onClose={() => setPlaying(false)}
          />
        </>
      )}
    </>
  );
}
