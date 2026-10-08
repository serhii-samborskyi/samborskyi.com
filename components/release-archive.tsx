'use client';
import { useState } from 'react';
import { ArrowUpRight, Play } from 'lucide-react';
import type { Release } from '@/lib/types';
import { time } from '@/lib/client';
export default function ReleaseArchive({
  releases,
  onPlay,
  selected,
}: {
  releases: Release[];
  onPlay: (r: Release) => void;
  selected: string | undefined;
}) {
  const [category, setCategory] = useState('All sounds');
  const latest = releases[0];
  const categories = ['All sounds', ...Array.from(new Set(releases.map((r) => r.category)))];
  return (
    <>
      <article className="release-empty release-feature">
        <div className="record-art">
          {latest.artwork_id ? (
            <img
              className="release-artwork"
              src={`/api/media/${latest.artwork_id}`}
              alt={`Artwork for ${latest.title}`}
            />
          ) : (
            <>
              <div className="record" aria-hidden="true">
                <div className="record-center">
                  <span className="record-initials">SS.</span>
                </div>
              </div>
              <span className="record-label">
                SS — {String(releases.length).padStart(3, '0')}
                <br />
                {latest.category.toUpperCase()}
              </span>
            </>
          )}
        </div>
        <div className="release-copy">
          <div className="eyebrow accent">
            <span className="live-dot" /> LATEST TRANSMISSION ·{' '}
            {new Date(latest.published_at!)
              .toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'UTC',
              })
              .toUpperCase()}
          </div>
          <h3>{latest.title}</h3>
          <p>{latest.description}</p>
          <div className="release-feature-actions">
            <button className="button button-accent" onClick={() => onPlay(latest)}>
              <Play size={15} /> Listen now
            </button>
            <a className="text-link" href={`/listen/${latest.id}`}>
              Studio note <ArrowUpRight size={15} />
            </a>
          </div>
          <div className="release-tags">
            <span>{latest.category.toUpperCase()}</span>
            {latest.duration > 0 && <span>{time(latest.duration)}</span>}
          </div>
        </div>
      </article>
      <div className="archive-toolbar">
        <div className="filter-tabs" role="group" aria-label="Filter releases">
          {categories.map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              className={c === category ? 'active' : ''}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <span>
          {releases.length} {releases.length === 1 ? 'experiment' : 'experiments'}
        </span>
      </div>
      <div className="track-list">
        {releases
          .filter((r) => category === 'All sounds' || r.category === category)
          .map((release, i) => (
            <article
              className={`track-row ${selected === release.id ? 'selected' : ''}`}
              key={release.id}
            >
              <span className="track-number">{String(i + 1).padStart(2, '0')}</span>
              <button
                className="track-play"
                aria-label={`Play ${release.title}`}
                onClick={() => onPlay(release)}
              >
                <Play size={16} />
              </button>
              <div className="track-title">
                <a href={`/listen/${release.id}`}>{release.title}</a>
                <span>{release.category}</span>
              </div>
              <span className="track-date">
                {new Date(release.published_at!).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'UTC',
                })}
              </span>
              <span className="track-duration">
                {release.duration ? time(release.duration) : '—'}
              </span>
              <a
                className="icon-button"
                href={`/listen/${release.id}`}
                aria-label={`Open ${release.title}`}
              >
                <ArrowUpRight size={18} />
              </a>
            </article>
          ))}
      </div>
    </>
  );
}
