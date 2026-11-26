// The start-up screen: "Update Media Contents". Four columns (Live TV, Movies, Series, Guide) each
// say Waiting, Updating or Completed as that part of the playlist downloads, with a line saying what
// is happening now. OK skips ahead; loading carries on in the background.
import { useEffect, useRef, useState } from 'preact/hooks';
import { parts, booting, bootFinished, type Part, type PartState } from '../sources/loadState';
import { sources } from '../sources/library';
import { Wordmark } from '../ui/brand';
import { pushLayer, focusEl } from '../nav/focus';

/** Shown in the order the reference layout uses: channels, films, series, then the guide. */
const ORDER: Part[] = ['live', 'movies', 'series', 'guide'];
const META: Record<Part, { label: string; doing: string; unit: [string, string] }> = {
  live: { label: 'Live TV', doing: 'Live TV channels', unit: ['channel', 'channels'] },
  movies: { label: 'Movies', doing: 'movies', unit: ['film', 'films'] },
  series: { label: 'Series', doing: 'series', unit: ['series', 'series'] },
  guide: { label: 'Guide', doing: 'TV guide', unit: ['channel with listings', 'channels with listings'] },
};

const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(0, Math.round(b / 1e3))} KB`);

function Column({ part, st }: { part: Part; st: PartState }) {
  const m = META[part];
  const frac = st.status === 'done' ? 1 : st.total > 0 ? Math.min(1, st.bytes / st.total) : -1;
  const status = st.status === 'done' ? 'Completed!' : st.status === 'error' ? 'Not loaded' : st.status === 'loading' ? 'Updating…' : 'Waiting…';
  let detail = '';
  if (st.status === 'done') detail = st.note || (st.count ? `${st.count.toLocaleString()} ${m.unit[st.count === 1 ? 0 : 1]}` : 'None in this playlist');
  else if (st.status === 'error') detail = st.note || 'Something went wrong';
  else if (st.status === 'loading') detail = st.bytes ? `${mb(st.bytes)}${st.total > 0 ? ` of ${mb(st.total)}` : ''}` : part === 'guide' && st.count ? `${st.count.toLocaleString()} programmes` : '';
  return (
    <div class={`upd-col ${st.status}`}>
      <div class="upd-head">{m.label}</div>
      <div class="upd-status">{status}</div>
      <div class="upd-detail tnum clip">{detail || ' '}</div>
      <div class={`boot-bar${frac < 0 && st.status === 'loading' ? ' busy' : ''}`}>
        <i style={{ transform: `scaleX(${frac < 0 ? (st.status === 'loading' ? 0.3 : 0) : frac})` }} />
      </div>
    </div>
  );
}

export function Startup() {
  const p = parts.value;
  const [leaving, setLeaving] = useState(false);
  const shown = useRef(Date.now());
  const skip = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);

  // Its own focus layer: the app underneath can't take the remote while this is up. Back does nothing.
  useEffect(() => {
    const pop = pushLayer(root.current!, () => {});
    requestAnimationFrame(() => skip.current && focusEl(skip.current));
    return pop;
  }, []);
  useEffect(() => {
    if (!bootFinished.value) return;
    const wait = Math.max(500, 1000 - (Date.now() - shown.current));
    const a = setTimeout(() => setLeaving(true), wait);
    const b = setTimeout(() => { booting.value = false; console.info(`[orbit] startup finished in ${Math.round((Date.now() - shown.current) / 1000)}s`); }, wait + 250);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [bootFinished.value]);

  const names = sources.value.filter(s => s.enabled).map(s => s.name).join(', ');
  const failed = (['live', 'movies', 'series'] as Part[]).every(k => p[k].status === 'error');
  const current = ORDER.find(k => p[k].status === 'loading');
  const line = failed ? 'Your playlist could not be loaded. Check the login details in Settings.'
    : bootFinished.value ? 'All done.'
    : current ? `Now updating ${META[current].doing}. Please wait…`
    : `Connecting to ${names || 'your playlist'}…`;
  return (
    <div class={`boot${leaving ? ' leaving' : ''}`} ref={root}>
      <Wordmark class="boot-mark" />
      <div class="upd">
        <div class="upd-title">Update Media Contents</div>
        <div class="upd-grid">{ORDER.map(k => <Column key={k} part={k} st={p[k]} />)}</div>
        <p class="upd-line">{!bootFinished.value && !failed && <span class="spinner" />}{line}</p>
        <button ref={skip} class="upd-skip" onClick={() => { booting.value = false; console.info('[orbit] startup skipped'); }}>
          {bootFinished.value || failed ? 'Continue' : 'Please wait… (OK to skip and keep loading in the background)'}
        </button>
      </div>
    </div>
  );
}
