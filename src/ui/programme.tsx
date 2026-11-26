// Extra programme details from the guide, where the guide has them: episode, episode title,
// category, age rating and artwork. Nothing is shown when the guide doesn't say.
import type { Programme } from '../sources/types';
import { Img } from './Img';

export function ProgrammeMeta({ p }: { p: Programme }) {
  const line = [p.ep, p.sub && p.sub !== p.title ? p.sub : ''].filter(Boolean).join(' · ');
  if (!line && !p.cat && !p.rating) return null;
  return (
    <div class="pmeta">
      {line && <span class="pmeta-ep clip">{line}</span>}
      {p.cat && <span class="tag">{p.cat}</span>}
      {p.rating && <span class="tag rating">{p.rating}</span>}
    </div>
  );
}

export function ProgrammeImage({ p, class: cls }: { p: Programme; class?: string }) {
  if (!p.img) return null;
  return <span class={`pimg ${cls ?? ''}`}><Img src={p.img} alt="" fit="cover" /></span>;
}
