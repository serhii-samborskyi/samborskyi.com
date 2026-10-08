'use client';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import type { Release } from '@/lib/types';
import { time, track } from '@/lib/client';
let sessionVolume = 0.8;
export default function Player({
  release,
  queue,
  onChange,
  onClose,
}: {
  release: Release;
  queue: Release[];
  onChange: (r: Release) => void;
  onClose: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null),
    lastTime = useRef(0),
    listened = useRef(0),
    reported = useRef(false),
    started = useRef(false);
  const [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [duration, setDuration] = useState(release.duration),
    [volume, setVolumeState] = useState(sessionVolume),
    [error, setError] = useState('');
  function setVolume(value: number) {
    sessionVolume = value;
    setVolumeState(value);
  }
  useEffect(() => {
    listened.current = 0;
    lastTime.current = 0;
    reported.current = false;
    started.current = false;
    audio.current?.play().catch(() => {
      setPlaying(false);
    });
  }, [release.id, release.duration]);
  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: release.title,
      artist: 'Serhii Samborskyi',
      artwork: [
        {
          src: new URL(
            release.artwork_id ? `/api/media/${release.artwork_id}` : '/serhii-cover.png',
            location.origin,
          ).href,
        },
      ],
    });
    navigator.mediaSession.setActionHandler('play', () => {
      void audio.current
        ?.play()
        .catch(() => setError('This audio couldn’t start. Please try again.'));
    });
    navigator.mediaSession.setActionHandler('pause', () => audio.current?.pause());
    return () => {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
    };
  }, [release]);
  function update() {
    const el = audio.current;
    if (!el) return;
    const delta = el.currentTime - lastTime.current;
    if (!el.paused && !el.seeking && delta > 0 && delta < 2) listened.current += delta;
    lastTime.current = el.currentTime;
    setPosition(el.currentTime);
    if (listened.current >= 30 && !reported.current) {
      reported.current = true;
      track('listen_30', release);
    }
  }
  function toggle() {
    if (!audio.current) return;
    if (audio.current.paused)
      void audio.current
        .play()
        .catch(() => setError('This audio couldn’t start. Please try again.'));
    else audio.current.pause();
  }
  function skip(direction: number) {
    const i = queue.findIndex((r) => r.id === release.id);
    if (direction === -1 && position > 3) {
      if (audio.current) audio.current.currentTime = 0;
    } else if (queue[i + direction]) onChange(queue[i + direction]);
  }
  return (
    <section className="audio-player" aria-label={`Now playing: ${release.title}`}>
      <audio
        ref={audio}
        src={`/api/media/${release.audio_id}`}
        preload="metadata"
        onPlay={() => {
          setPlaying(true);
          if (!started.current) {
            started.current = true;
            track('play', release);
          }
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={update}
        onLoadedMetadata={() => setDuration(audio.current?.duration || release.duration)}
        onEnded={() => {
          setPlaying(false);
          if (listened.current >= Math.min(30, duration * 0.8)) track('complete', release);
          skip(1);
        }}
        onError={() => {
          setPlaying(false);
          setError('This audio couldn’t load. Try again in a moment.');
        }}
      />
      <div className="playing-info">
        <img
          src={release.artwork_id ? `/api/media/${release.artwork_id}` : '/serhii-cover.png'}
          alt=""
        />
        <div>
          <span>{release.title}</span>
          <small>{error || 'Serhii Samborskyi'}</small>
        </div>
      </div>
      <div className="transport">
        <button
          className="icon-button"
          aria-label="Previous track"
          disabled={queue[0]?.id === release.id && position < 3}
          onClick={() => skip(-1)}
        >
          <SkipBack size={17} />
        </button>
        <button className="player-play" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>
          {playing ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button
          className="icon-button"
          aria-label="Next track"
          disabled={queue[queue.length - 1]?.id === release.id}
          onClick={() => skip(1)}
        >
          <SkipForward size={17} />
        </button>
      </div>
      <div className="seek-control">
        <span>{time(position)}</span>
        <input
          aria-label="Playback position"
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={position}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (audio.current) {
              audio.current.currentTime = v;
              lastTime.current = v;
            }
            setPosition(v);
          }}
        />
        <span>{time(duration)}</span>
      </div>
      <div className="volume-control">
        <button
          className="icon-button"
          aria-label={volume === 0 ? 'Unmute' : 'Mute'}
          onClick={() => setVolume(volume === 0 ? 0.8 : 0)}
        >
          {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <input
          aria-label="Volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>
      <button className="icon-button player-close" aria-label="Close player" onClick={onClose}>
        <X size={18} />
      </button>
    </section>
  );
}
