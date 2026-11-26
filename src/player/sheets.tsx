// The player's side sheets: subtitles (with timing), audio, picture, speed, episodes and options.
import { useEffect, useState } from 'preact/hooks';
import { openSheet, replaceSheet, closeSheet, closeAllSheets, SheetItem, toast } from '../ui/overlays';
import { Icon } from '../ui/icons';
import * as P from './controller';
import { settings, updateSettings, isFavourite, toggleFavourite, itemIndex } from '../sources/library';
import { RATE_PRESETS } from '../services/subtitles';
import { osAvailable, searchSubtitles, downloadSubtitle, hashRemote, type SubtitleResult } from '../services/opensubtitles';
import { tmdbLookup } from '../services/tmdb';
import { cleanTitle } from '../core/names';
import { friendlyError } from '../core/http';
import { PLATFORM } from '../core/platform';
import { episodeList, episodePlayable } from './playables';
import type { Aspect } from '../sources/library';
import type { Movie } from '../sources/types';

const ASPECT_LABEL: Record<Aspect, string> = { fit: 'Fit', fill: 'Fill (crop)', stretch: 'Stretch', '16:9': '16:9', '4:3': '4:3' };
const fmtDelay = (s: number) => (s === 0 ? '0.0 s' : `${s > 0 ? '+' : '−'}${Math.abs(s).toFixed(1)} s`);

/* ------------------------------ subtitles ------------------------------ */

export function openSubtitles() {
  openSheet('Subtitles', () => <SubtitlesBody />);
}

function SubtitlesBody() {
  const text = P.tracks.value.filter(t => t.type === 'text');
  const ext = P.external.value;
  const anyOn = !!ext || text.some(t => t.selected);
  const cur = P.current.value;
  const vod = cur && cur.kind !== 'live';
  const s = settings.value;
  return (
    <>
      <SheetItem label="Off" checked={!anyOn} onClick={() => { P.subtitlesOff(); }} autofocus />
      {text.map(t => <SheetItem key={t.id} label={t.label} sub="In the stream" checked={t.selected && !ext} onClick={() => P.selectEmbeddedSubtitles(t.id)} />)}
      {ext && <SheetItem label={ext.label} sub="Loaded file" checked onClick={() => {}} />}
      {vod && osAvailable() && <SheetItem icon={<Icon name="search" />} label="Find on OpenSubtitles" sub={`Language: ${s.subLang}`} onClick={() => openSheet('OpenSubtitles', () => <OpenSubtitlesBody />)} />}
      {vod && !osAvailable() && <SheetItem icon={<Icon name="search" />} label="Find on OpenSubtitles" sub="Add a free API key in Settings → Subtitles first" onClick={() => toast('Add an OpenSubtitles API key in Settings → Subtitles.')} />}
      {PLATFORM !== 'android' && <SheetItem icon={<Icon name="file" />} label="Open a subtitle file" sub=".srt or .vtt" onClick={pickFile} />}

      {anyOn && (
        <>
          <div class="sheet-label">Timing: if words appear before they are spoken, press +</div>
          <div class="stepper">
            <button class="btn icon" aria-label="Show subtitles earlier" onClick={() => P.nudgeSubtitles(-0.1)}><Icon name="minus" /></button>
            <output aria-live="polite">{fmtDelay(P.subDelay.value)}</output>
            <button class="btn icon" aria-label="Show subtitles later" onClick={() => P.nudgeSubtitles(0.1)}><Icon name="plus" /></button>
          </div>
          <div class="row" style={{ padding: '0.3rem 0.9rem', gap: '0.5rem' }}>
            <button class="chip" onClick={() => P.nudgeSubtitles(-1)}>−1 s</button>
            <button class="chip" onClick={() => P.nudgeSubtitles(1)}>+1 s</button>
            <button class="chip" onClick={() => { P.subDelay.value = 0; }}>Reset</button>
          </div>
          {ext && (
            <>
              <div class="sheet-label">Drifting further out as the film goes on? Correct the frame rate</div>
              {RATE_PRESETS.map(r => <SheetItem key={r.label} label={r.label} checked={Math.abs(P.subRate.value - r.rate) < 1e-6} onClick={() => { P.subRate.value = r.rate; }} />)}
            </>
          )}
        </>
      )}
      <div class="sheet-label">Size</div>
      <div class="choice" style={{ padding: '0 0.9rem' }}>
        {[80, 100, 125, 150].map(n => <button key={n} class={`chip${s.subSize === n ? ' on' : ''}`} onClick={() => updateSettings({ subSize: n })}>{n}%</button>)}
      </div>
      <SheetItem label="Dark box behind subtitles" value={s.subBackground ? 'On' : 'Off'} onClick={() => updateSettings({ subBackground: !s.subBackground })} />
    </>
  );
}

function pickFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.srt,.vtt,text/vtt,application/x-subrip';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const n = P.loadExternalSubtitles(await f.text(), f.name.replace(/\.\w+$/, ''));
      toast(`Subtitles loaded (${n} lines)`);
      closeSheet();
    } catch (e) { toast(friendlyError(e), true); }
  };
  input.click();
}

const LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ar', 'tr', 'ro', 'sv', 'el', 'hi', 'ur'];

function OpenSubtitlesBody() {
  const cur = P.current.value!;
  const [lang, setLang] = useState(settings.value.subLang);
  const [state, setState] = useState<{ busy: string; results: SubtitleResult[]; error: string }>({ busy: 'Checking the video…', results: [], error: '' });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const url = cur.resolve ? await cur.resolve() : cur.url;
        setState(s => ({ ...s, busy: 'Matching subtitles to this file…' }));
        const hash = await hashRemote(url);
        const isEp = cur.kind === 'episode' && cur.series && cur.episode;
        const name = isEp ? cur.series!.name : cur.title;
        let tmdbId: number | undefined;
        try { tmdbId = (await tmdbLookup(isEp ? 'series' : 'movie', name, (itemIndex.value.get(cur.key) as Movie | undefined)?.year ?? 0))?.id; } catch {}
        setState(s => ({ ...s, busy: 'Searching OpenSubtitles…' }));
        const fileName = decodeURIComponent(url.split('?')[0].split('/').pop() ?? '');
        const results = await searchSubtitles({ query: cleanTitle(name).title, language: lang, hash, tmdbId, season: isEp ? cur.episode!.season : undefined, episode: isEp ? cur.episode!.episode : undefined }, `${name} ${fileName}`);
        if (live) setState({ busy: '', results, error: results.length ? '' : 'No subtitles found in this language.' });
      } catch (e) {
        if (live) setState({ busy: '', results: [], error: friendlyError(e) });
      }
    })();
    return () => { live = false; };
  }, [lang]);

  const pick = async (r: SubtitleResult) => {
    toast('Downloading subtitles…');
    try {
      const text = await downloadSubtitle(r.fileId);
      P.loadExternalSubtitles(text, r.release);
      toast(r.hashMatch ? 'Subtitles made for this exact file' : 'Subtitles loaded. Adjust the timing in Subtitles if needed.');
      closeAllSheets();
      openSubtitles();
    } catch (e) { toast(friendlyError(e), true); }
  };

  return (
    <>
      <div class="choice" style={{ padding: '0 0.9rem 0.6rem' }}>
        {LANGS.map(l => <button key={l} class={`chip${l === lang ? ' on' : ''}`} onClick={() => setLang(l)} data-autofocus={l === lang || undefined}>{l}</button>)}
      </div>
      {state.busy && <div class="sheet-item"><span class="spinner" />{state.busy}</div>}
      {state.error && <p class="hint" style={{ padding: '0.5rem 0.9rem' }}>{state.error}</p>}
      {state.results.slice(0, 40).map((r, i) => (
        <SheetItem key={r.fileId} autofocus={i === 0} onClick={() => pick(r)}
          label={<span class="clamp2">{r.release}</span>}
          sub={[r.hashMatch ? '✓ Made for this file' : '', `${r.downloads.toLocaleString()} downloads`, r.hearingImpaired ? 'SDH' : '', r.fps ? `${r.fps} fps` : ''].filter(Boolean).join('   ')} />
      ))}
    </>
  );
}

/* ------------------------------ audio, picture, speed ------------------------------ */

export function openAudio() {
  openSheet('Audio', () => {
    const list = P.tracks.value.filter(t => t.type === 'audio');
    return (
      <>
        {!list.length && <p class="hint" style={{ padding: '0 0.9rem' }}>This stream has one audio track.</p>}
        {list.map((t, i) => <SheetItem key={t.id} label={t.label} checked={t.selected} autofocus={t.selected || i === 0} onClick={() => P.selectAudio(t.id)} />)}
        <SheetItem icon={<Icon name={P.muted.value ? 'mute' : 'audio'} />} label={P.muted.value ? 'Turn sound on' : 'Mute'} onClick={P.toggleMute} />
      </>
    );
  });
}

export function openPicture() {
  openSheet('Picture', () => (
    <>
      {P.ASPECTS.map(a => <SheetItem key={a} label={ASPECT_LABEL[a]} checked={P.aspect.value === a} autofocus={P.aspect.value === a} onClick={() => P.setAspect(a)} />)}
      <div class="sheet-label">Zoom</div>
      <div class="stepper">
        <button class="btn icon" aria-label="Zoom out" onClick={() => P.setZoom(P.zoom.value - 0.05)}><Icon name="minus" /></button>
        <output>{Math.round(P.zoom.value * 100)}%</output>
        <button class="btn icon" aria-label="Zoom in" onClick={() => P.setZoom(P.zoom.value + 0.05)}><Icon name="plus" /></button>
      </div>
      <SheetItem label={`Use ${ASPECT_LABEL[P.aspect.value]} for all ${P.isLive.value ? 'channels' : 'films and episodes'}`} onClick={() => {
        updateSettings(P.isLive.value ? { aspectLive: P.aspect.value } : { aspectVod: P.aspect.value });
        toast('Saved');
      }} />
    </>
  ));
}

export function openSpeed() {
  openSheet('Playback speed', () => (
    <>{[0.5, 0.75, 1, 1.25, 1.5, 2].map(s => <SheetItem key={s} label={s === 1 ? 'Normal' : `${s}×`} checked={P.speed.value === s} autofocus={P.speed.value === s} onClick={() => { P.setSpeed(s); closeSheet(); }} />)}</>
  ));
}

export function openEpisodes() {
  const cur = P.current.value;
  if (!cur?.series) return;
  const list = episodeList(cur.series);
  openSheet(cur.series.name, () => (
    <>{list.map(e => (
      <SheetItem key={e.key} label={`S${e.season} E${e.episode} · ${e.title}`} checked={e.key === cur.episode?.key} autofocus={e.key === cur.episode?.key}
        onClick={() => { closeAllSheets(); P.play(episodePlayable(cur.series!, e)); }} />
    ))}</>
  ));
}

/* ------------------------------ options ------------------------------ */

export function openOptions() {
  openSheet('Options', () => {
    const cur = P.current.value;
    if (!cur) return null;
    const live = cur.kind === 'live';
    const favKey = cur.channel?.key ?? (cur.series?.key || cur.key);
    const audio = P.tracks.value.filter(t => t.type === 'audio');
    const sel = audio.find(t => t.selected);
    return (
      <>
        <SheetItem icon={<Icon name="cc" />} label="Subtitles" value={P.external.value ? 'File' : P.tracks.value.some(t => t.type === 'text' && t.selected) ? 'On' : 'Off'} onClick={() => replaceSheet('Subtitles', () => <SubtitlesBody />)} autofocus />
        <SheetItem icon={<Icon name="audio" />} label="Audio" value={sel?.label ?? ''} onClick={() => { closeSheet(); openAudio(); }} />
        <SheetItem icon={<Icon name="aspect" />} label="Picture" value={ASPECT_LABEL[P.aspect.value]} onClick={() => { closeSheet(); openPicture(); }} />
        {!live && <SheetItem icon={<Icon name="speed" />} label="Playback speed" value={P.speed.value === 1 ? 'Normal' : `${P.speed.value}×`} onClick={() => { closeSheet(); openSpeed(); }} />}
        {cur.series && <SheetItem icon={<Icon name="episodes" />} label="Episodes" onClick={() => { closeSheet(); openEpisodes(); }} />}
        {!live && <SheetItem icon={<Icon name="restart" />} label="Play from the start" onClick={() => { closeSheet(); P.seekTo(0); }} />}
        <SheetItem icon={<Icon name="star" />} label={isFavourite(favKey) ? 'Remove from favourites' : 'Add to favourites'} onClick={() => { toast(toggleFavourite(favKey) ? 'Added to favourites' : 'Removed from favourites'); }} />
        {PLATFORM === 'android' && (
          <SheetItem icon={<Icon name="tv" />} label="Player engine" sub={settings.value.engine === 'native' ? 'ExoPlayer (recommended)' : 'Web player'} value="Switch"
            onClick={() => { updateSettings({ engine: settings.value.engine === 'native' ? 'web' : 'native' }); closeSheet(); P.retry(); }} />
        )}
        <SheetItem icon={<Icon name="info" />} label="Stream info" onClick={() => replaceSheet('Stream info', () => <StreamInfo />)} />
        <SheetItem icon={<Icon name="close" />} label="Stop watching" onClick={() => { closeAllSheets(); P.exitFull(); }} />
      </>
    );
  });
}

function StreamInfo() {
  const cur = P.current.value;
  const rows: [string, string][] = [
    ['Engine', P.engineName.value === 'native' ? 'ExoPlayer' : 'Web player'],
    ['Format', cur && /\.m3u8(\?|$)/i.test(cur.url) ? 'HLS' : 'MPEG-TS / file'],
    ['State', P.state.value],
    ...P.tracks.value.map(t => [t.type === 'audio' ? 'Audio' : 'Subtitles', `${t.label}${t.selected ? ' (on)' : ''}`] as [string, string]),
  ];
  return <>{rows.map(([k, v], i) => <SheetItem key={i} label={k} value={v} onClick={() => {}} autofocus={i === 0} />)}</>;
}
