// An image that falls back to initials when the provider's artwork is missing or broken.
import { useState } from 'preact/hooks';
import { initials } from '../core/names';

export function Img({ src, alt, fit }: { src?: string; alt: string; fit?: 'contain' | 'cover' }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <div class="initials">{initials(alt)}</div>;
  return <img src={src} alt="" loading="lazy" decoding="async" style={fit ? { objectFit: fit } : undefined} onError={() => setBad(true)} />;
}
