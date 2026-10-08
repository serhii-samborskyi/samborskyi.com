'use client';
import { useState } from 'react';
import Image from 'next/image';
import Subscription from './subscription';
import ConsentSettings from './consent';
import ReleaseArchive from './release-archive';
import Player from './player';
import type { PublicConfig, Release } from '@/lib/types';

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
function Mark() {
  return (
    <span className="sound-mark" aria-hidden="true">
      {[12, 22, 32, 18, 26].map((h, i) => (
        <i key={i} style={{ height: h }} />
      ))}
    </span>
  );
}
export default function ListeningRoom({
  releases,
  config,
}: {
  releases: Release[];
  config: PublicConfig;
}) {
  const [selected, setSelected] = useState<Release | null>(null);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a href="/" className="brand" aria-label="Serhii Samborskyi home">
          <Mark />
          <span>
            SAMBORSKYI<span className="brand-period">.</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#experiments">Experiments</a>
          <a href="#about">The composer</a>
        </nav>
        <a className="button button-small" href="#subscribe">
          Stay in the loop <Arrow />
        </a>
      </header>
      <main id="main">
        <section className="hero">
          <Image
            className="hero-portrait"
            src="/serhii-cover.png"
            alt="Serhii Samborskyi wearing sunglasses and an embroidered Ukrainian shirt"
            width={1254}
            height={1254}
            sizes="(max-width: 700px) 100vw, 66vw"
            priority
          />
          <div className="hero-shade" />
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="live-dot" /> INDEPENDENT COMPOSER & SOUND EXPLORER
            </div>
            <h1>
              A place
              <br />
              for <span>sound.</span>
            </h1>
            <p>
              I’m Serhii Samborskyi. This is my open studio.
              <br className="desktop-break" /> Music experiments, unfiltered ideas, and a little
              <br className="desktop-break" /> space to get lost in listening.
            </p>
            <div className="hero-actions">
              {releases.length ? (
                <button className="button button-accent" onClick={() => setSelected(releases[0])}>
                  <span className="play-triangle" /> Listen to the latest
                </button>
              ) : (
                <a className="button button-accent" href="#experiments">
                  <span className="play-triangle" /> Explore the experiments
                </a>
              )}
              <a className="text-link" href="#about">
                Meet the composer <Arrow />
              </a>
            </div>
          </div>
          <div className="hero-bottom">
            <span>NO RULES. JUST RESONANCE.</span>
            <span className="portrait-caption">
              SERHII SAMBORSKYI <span>COMPOSER / EXPLORER</span>
            </span>
            <a href="#experiments" aria-label="Scroll to experiments">
              ↓
            </a>
          </div>
        </section>
        <div className="studio-strip">
          <span>
            <i className="live-dot" /> THE STUDIO IS OPEN
          </span>
          <span>Ideas become sounds. Sounds become stories.</span>
          <span>
            MADE TO BE HEARD <span aria-hidden="true">↙</span>
          </span>
        </div>
        <section className="section experiments" id="experiments">
          <div className="section-heading">
            <div>
              <div className="eyebrow muted">01 / THE LISTENING ROOM</div>
              <h2>
                Sound, in progress<span>.</span>
              </h2>
            </div>
            <span className="small muted">A home for every new experiment.</span>
          </div>
          {releases.length ? (
            <ReleaseArchive releases={releases} onPlay={setSelected} selected={selected?.id} />
          ) : (
            <div className="release-empty">
              <div className="record-art" aria-hidden="true">
                <div className="record">
                  <div className="record-center">
                    <Mark />
                  </div>
                </div>
                <span className="record-label">
                  SS — 001
                  <br />
                  THE BEGINNING
                </span>
              </div>
              <div className="release-copy">
                <div className="eyebrow accent">
                  <span className="live-dot" /> FIRST TRANSMISSION · COMING SOON
                </div>
                <h3>
                  Something is
                  <br />
                  taking shape.
                </h3>
                <p>
                  Every experiment starts with a little curiosity.
                  <br />
                  The first sounds will find their home right here.
                </p>
                <a className="text-link" href="#subscribe">
                  Be the first to listen <Arrow />
                </a>
                <div className="release-tags">
                  <span>EXPERIMENTAL</span>
                  <span>INDEPENDENT</span>
                  <span>ALWAYS EXPLORING</span>
                </div>
              </div>
            </div>
          )}
        </section>
        <section className="section about" id="about">
          <div className="about-label">
            <div className="eyebrow muted">02 / BEHIND THE SOUND</div>
            <span className="large-asterisk" aria-hidden="true">
              ✳
            </span>
          </div>
          <div className="about-copy">
            <h2>
              Following the sound.
              <br />
              <span>Seeing where it goes.</span>
            </h2>
            <div className="about-columns">
              <p>
                I’m Serhii, a composer with a soft spot for the unexpected. This is a place for my
                music experiments — the finished pieces, the happy accidents, and everything in
                between.
              </p>
              <p>
                No perfect formula. Just curiosity, a feeling, and the freedom to try something new.
                Put on your headphones. Stay a little while.
              </p>
            </div>
            <div className="signature">
              Serhii Samborskyi <span>— THANK YOU FOR LISTENING</span>
            </div>
          </div>
        </section>
        <section className="section subscribe-section" id="subscribe">
          <div>
            <div className="eyebrow accent">03 / KEEP THE CONNECTION</div>
            <h2>
              Good things
              <br />
              come to <em>listeners.</em>
            </h2>
            <p>
              New sounds, straight from my studio to you.
              <br />
              Choose your way to stay close.
            </p>
          </div>
          <Subscription config={config} />
        </section>
      </main>
      <footer className="site-footer">
        <a className="brand" href="/">
          SAMBORSKYI.
        </a>
        <span>Independent sounds. Shared with you.</span>
        <div>
          <button
            className="footer-button"
            onClick={() => window.dispatchEvent(new Event('open-privacy'))}
          >
            Cookie choices
          </button>
          <a href="/privacy">Privacy</a>
          <a href="/studio">
            Studio <Arrow />
          </a>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
      <ConsentSettings config={config} />
      {selected && (
        <>
          <div className="player-space" />
          <Player
            key={selected.id}
            release={selected}
            queue={releases}
            onChange={setSelected}
            onClose={() => setSelected(null)}
          />
        </>
      )}
    </>
  );
}
