// Turns keyboard, remote and native Android key presses into one set of actions.
// An action is first offered to the focused element as a bubbling `orbit-action` DOM event, so any
// component can handle it (a list moving its own cursor, the player seeking). Whatever nobody handles
// falls through to the defaults: spatial focus movement, click on OK, and Back.

export type Action =
  | 'up' | 'down' | 'left' | 'right' | 'ok' | 'hold-ok' | 'back' | 'menu' | 'info' | 'guide'
  | 'playpause' | 'play' | 'pause' | 'stop' | 'ff' | 'rw' | 'next' | 'prev' | 'chup' | 'chdown'
  | 'pageup' | 'pagedown' | 'red' | 'green' | 'yellow' | 'blue' | 'subtitle' | 'audio' | 'zoom'
  | 'search' | 'fav' | 'mute' | 'fullscreen' | 'last'
  | `digit${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

export interface ActionDetail { action: Action; repeat: boolean }
export type ActionEvent = CustomEvent<ActionDetail>;

/** KeyboardEvent.key (and a few legacy keyCodes) -> action. */
const KEY_MAP: Record<string, Action> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Up: 'up', Down: 'down', Left: 'left', Right: 'right',
  Enter: 'ok', Select: 'ok', ' ': 'playpause',
  Escape: 'back', GoBack: 'back', BrowserBack: 'back', Backspace: 'back', XF86Back: 'back',
  ContextMenu: 'menu', Menu: 'menu', Info: 'info', Settings: 'menu', Guide: 'guide',
  MediaPlayPause: 'playpause', MediaPlay: 'play', MediaPause: 'pause', MediaStop: 'stop',
  MediaFastForward: 'ff', MediaRewind: 'rw', FastFwd: 'ff', Rewind: 'rw',
  MediaTrackNext: 'next', MediaTrackPrevious: 'prev', MediaSkipForward: 'ff', MediaSkipBackward: 'rw',
  ChannelUp: 'chup', ChannelDown: 'chdown', PageUp: 'pageup', PageDown: 'pagedown',
  ColorF0Red: 'red', ColorF1Green: 'green', ColorF2Yellow: 'yellow', ColorF3Blue: 'blue',
  Subtitle: 'subtitle', ClosedCaptionToggle: 'subtitle', AudioTrack: 'audio', ZoomToggle: 'zoom',
  F11: 'fullscreen',
};

/** Desktop keyboard shortcuts (only when no text field has focus). */
const LETTERS: Record<string, Action> = { l: 'last', f: 'fav', m: 'mute', c: 'subtitle', a: 'audio', z: 'zoom', g: 'guide', i: 'info', '/': 'search', x: 'stop' };

export function actionForKey(e: Pick<KeyboardEvent, 'key' | 'keyCode'>, inText: boolean): Action | null {
  if (/^[0-9]$/.test(e.key) && !inText) return `digit${+e.key}` as Action;
  if (inText) {
    // Inside a text field only navigation and Escape leave the field; everything else is typing.
    if (e.key === 'Backspace' || e.key === ' ') return null;
    // On-screen keyboard input (key "Unidentified"/"Process", keyCode 229) is always typing.
    if (e.keyCode === 229 || e.key === 'Unidentified' || e.key === 'Process') return null;
  } else {
    const l = LETTERS[e.key.toLowerCase()];
    if (l && e.key.length === 1) return l;
  }
  const mapped = KEY_MAP[e.key];
  if (mapped) return mapped;
  // Older Android WebViews report some remote keys only by keyCode. Printable characters never
  // count: their key codes collide with letters (85 is "u", 89 is "y").
  if (e.key.length === 1) return null;
  switch (e.keyCode) {
    case 4: return 'back';            // KEYCODE_BACK when the WebView receives it directly
    case 82: return 'menu';           // KEYCODE_MENU
    case 85: case 179: return 'playpause';
    case 89: case 227: return 'rw';
    case 90: case 228: return 'ff';
    case 166: case 427: return 'chup';
    case 167: case 428: return 'chdown';
    case 403: return 'red'; case 404: return 'green'; case 405: return 'yellow'; case 406: return 'blue';
    case 461: return 'back';          // webOS / some Android TV remotes
    // 229 is never a remote button here: browsers report every character typed with an on-screen
    // keyboard as keyCode 229 ("IME is composing"). Mapping it to Last channel made typing in a
    // search box jump to the last channel. The real Last channel button arrives as the native key
    // LAST_CHANNEL (NATIVE_KEY_MAP).
  }
  return null;
}

/** Native Android key names (OrbitPlayerPlugin) -> action. */
export const NATIVE_KEY_MAP: Record<string, Action> = {
  BACK: 'back', MENU: 'menu', INFO: 'info', GUIDE: 'guide', SETTINGS: 'menu',
  MEDIA_PLAY_PAUSE: 'playpause', MEDIA_PLAY: 'play', MEDIA_PAUSE: 'pause', MEDIA_STOP: 'stop',
  MEDIA_FAST_FORWARD: 'ff', MEDIA_REWIND: 'rw', MEDIA_NEXT: 'next', MEDIA_PREVIOUS: 'prev',
  MEDIA_SKIP_FORWARD: 'ff', MEDIA_SKIP_BACKWARD: 'rw', MEDIA_STEP_FORWARD: 'ff', MEDIA_STEP_BACKWARD: 'rw',
  CHANNEL_UP: 'chup', CHANNEL_DOWN: 'chdown', PAGE_UP: 'pageup', PAGE_DOWN: 'pagedown',
  PROG_RED: 'red', PROG_GREEN: 'green', PROG_YELLOW: 'yellow', PROG_BLUE: 'blue',
  CAPTIONS: 'subtitle', MEDIA_AUDIO_TRACK: 'audio', LAST_CHANNEL: 'last', TV_ZOOM_MODE: 'zoom', SEARCH: 'search', BOOKMARK: 'fav',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`NUMPAD_${i}`, `digit${i}`])),
};

/** Sends an action to the focused element (or `target`). Returns true if something handled it. */
export function emitAction(action: Action, repeat = false, target?: Element | null): boolean {
  const el = target ?? (document.activeElement && document.activeElement !== document.body ? document.activeElement : document.querySelector('[data-layer-active]')) ?? document.body;
  const ev = new CustomEvent<ActionDetail>('orbit-action', { detail: { action, repeat }, bubbles: true, cancelable: true });
  return !el.dispatchEvent(ev);
}

/** Helper for components: `onAction(el, (a, e) => { ...; return true to consume })`. */
export function onAction(el: EventTarget, fn: (action: Action, detail: ActionDetail) => boolean | void): () => void {
  const h = (e: Event) => {
    const d = (e as ActionEvent).detail;
    if (fn(d.action, d) === true) { e.preventDefault(); e.stopPropagation(); }
  };
  el.addEventListener('orbit-action', h);
  return () => el.removeEventListener('orbit-action', h);
}
