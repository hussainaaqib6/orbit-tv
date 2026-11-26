// An image that falls back to initials when the provider's artwork is missing or broken.
// `defer`: start loading only once the card has stayed on screen briefly. In a grid scrolled fast
// with a held key, cards that flash past never download or decode their (often large) artwork,
// which is one of the most expensive things a TV stick does.
import { useEffect, useState } from 'preact/hooks';
import { initials } from '../core/names';

const DEFER_MS = 140;

export function Img({ src, alt, fit, defer }: { src?: string; alt: string; fit?: 'contain' | 'cover'; defer?: boolean }) {
  const [bad, setBad] = useState(false);
  const [ready, setReady] = useState(!defer);
  useEffect(() => {
    if (!defer || !src) return;
    setReady(false);
    const t = setTimeout(() => setReady(true), DEFER_MS);
    return () => clearTimeout(t);
  }, [src, defer]);
  if (!src || bad) return <div class="initials">{initials(alt)}</div>;
  if (!ready) return <div class="initials img-wait" />;
  return <img src={src} alt="" loading="lazy" decoding="async" style={fit ? { objectFit: fit } : undefined} onError={() => setBad(true)} />;
}
