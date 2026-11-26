// The start-up screen: four boxes (Live TV, TV Guide, Movies, Series) that fill as each part of the
// playlist downloads, then the app fades in. OK skips ahead; loading carries on in the background.
import { useEffect, useRef, useState } from 'preact/hooks';
import { parts, PARTS, booting, bootFinished, type Part, type PartState } from '../sources/loadState';
import { sources } from '../sources/library';
import { Icon, type IconName } from '../ui/icons';
import { Wordmark } from '../ui/brand';
import { pushLayer, focusEl } from '../nav/focus';

const META: Record<Part, { label: string; icon: IconName; unit: [string, string] }> = {
  live: { label: 'Live TV', icon: 'live', unit: ['channel', 'channels'] },
  guide: { label: 'TV Guide', icon: 'guide', unit: ['channel with listings', 'channels with listings'] },
  movies: { label: 'Movies', icon: 'movies', unit: ['film', 'films'] },
  series: { label: 'Series', icon: 'series', unit: ['series', 'series'] },
};

const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(0, Math.round(b / 1e3))} KB`);

function Box({ part, st }: { part: Part; st: PartState }) {
  const m = META[part];
  const frac = st.status === 'done' ? 1 : st.total > 0 ? Math.min(1, st.bytes / st.total) : -1;
  let main: string, sub: string;
  if (st.status === 'done') {
    main = st.count ? st.count.toLocaleString() : 'None';
    sub = st.note || (st.count ? m.unit[st.count === 1 ? 0 : 1] : 'in this playlist');
  } else if (st.status === 'error') {
    main = 'Not loaded';
    sub = st.note || 'Something went wrong';
  } else if (st.status === 'loading') {
    main = st.bytes ? mb(st.bytes) : 'Starting';
    sub = st.total > 0 ? `of ${mb(st.total)}` : part === 'guide' && st.count ? `${st.count.toLocaleString()} programmes read` : 'Downloading';
  } else {
    main = 'Waiting';
    sub = part === 'guide' ? 'Starts after the channels' : 'In the queue';
  }
  return (
    <div class={`boot-box ${st.status}`}>
      <div class="boot-icon"><Icon name={st.status === 'done' ? 'check' : m.icon} /></div>
      <div class="boot-label">{m.label}</div>
      <div class="boot-main tnum">{main}</div>
      <div class="boot-sub">{sub}</div>
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
    const wait = Math.max(700, 1400 - (Date.now() - shown.current));
    const a = setTimeout(() => setLeaving(true), wait);
    const b = setTimeout(() => { booting.value = false; console.info('[orbit] startup finished'); }, wait + 320);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [bootFinished.value]);

  const names = sources.value.filter(s => s.enabled).map(s => s.name).join(', ');
  const failed = (['live', 'movies', 'series'] as Part[]).every(k => p[k].status === 'error');
  return (
    <div class={`boot${leaving ? ' leaving' : ''}`} ref={root}>
      <Wordmark class="boot-mark" />
      <p class="boot-line">{failed ? 'Your playlist could not be loaded' : bootFinished.value ? 'Ready' : `Getting ${names || 'your playlist'} ready`}</p>
      <div class="boot-row">{PARTS.map(k => <Box key={k} part={k} st={p[k]} />)}</div>
      <button ref={skip} class="btn boot-skip" onClick={() => { booting.value = false; console.info('[orbit] startup skipped'); }}>
        {bootFinished.value ? 'Continue' : 'Skip – keep loading in the background'}
      </button>
    </div>
  );
}
