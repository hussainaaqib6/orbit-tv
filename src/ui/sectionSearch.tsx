// Search inside one section (Live TV, Movies or Series): a box in the screen's header that filters
// everything in that section by name as you type. Names are folded (lower case, no accents) once per
// list, and filtering waits for a short pause in typing, so a 200,000-film list stays responsive.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';

export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The search text (as typed) and the filtered list (null while there is no search). */
export function useSectionSearch<T>(items: T[], nameOf: (x: T) => string) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(fold(text.trim())), 250);
    return () => clearTimeout(t);
  }, [text]);
  const folded = useMemo(() => (query ? items.map(x => fold(nameOf(x))) : null), [items, !!query]);
  const results = useMemo(() => {
    if (!query || !folded) return null;
    const words = query.split(/\s+/).filter(Boolean);
    const out: T[] = [];
    for (let i = 0; i < items.length; i++) {
      const n = folded[i];
      if (words.every(w => n.includes(w))) out.push(items[i]);
    }
    return out;
  }, [query, folded, items]);
  return { text, setText, query, results, clear: () => { setText(''); setQuery(''); } };
}

export function SearchBox({ text, onText, placeholder }: { text: string; onText: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label class="sec-search">
      <Icon name="search" />
      <input ref={ref} class="input" value={text} placeholder={placeholder} aria-label={placeholder} spellcheck={false} autocomplete="off"
        onInput={e => onText((e.target as HTMLInputElement).value)} />
      {text && <button type="button" class="sec-search-clear" aria-label="Clear search" onClick={() => { onText(''); ref.current?.focus(); }}><Icon name="close" /></button>}
    </label>
  );
}
