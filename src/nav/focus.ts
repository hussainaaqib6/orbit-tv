// Spatial focus navigation for remotes, plus "layers" (screen, player, side sheet, dialog) so focus
// never escapes behind whatever is on top, and Back always closes the top-most thing first.
import { actionForKey, emitAction, NATIVE_KEY_MAP, type Action } from './keys';

/* ------------------------------ layers ------------------------------ */

interface Layer { el: HTMLElement; onBack?: () => void; restore: Element | null }
const layers: Layer[] = [];

/** The element that owns focus right now (top-most layer). */
export const activeRoot = (): HTMLElement => layers[layers.length - 1]?.el ?? document.body;

function markActive() {
  document.querySelectorAll('[data-layer-active]').forEach(e => e.removeAttribute('data-layer-active'));
  activeRoot().setAttribute('data-layer-active', '');
}

/**
 * Registers `el` as the top layer. Returns a function that removes it and puts focus back where it was.
 * `onBack` runs on an unhandled Back (normally it closes the layer).
 */
export function pushLayer(el: HTMLElement, onBack?: () => void): () => void {
  const layer: Layer = { el, onBack, restore: document.activeElement };
  layers.push(layer);
  markActive();
  return () => {
    const i = layers.indexOf(layer);
    if (i < 0) return;
    layers.splice(i, 1);
    markActive();
    if (i !== layers.length) return;
    // Wait a frame: the layer underneath may only just have stopped being inert.
    requestAnimationFrame(() => {
      if (activeRoot().contains(document.activeElement) && document.activeElement !== document.body) return;
      if (layer.restore instanceof HTMLElement && layer.restore.isConnected && activeRoot().contains(layer.restore)) focusEl(layer.restore);
      else focusFirst(activeRoot());
    });
  };
}

/** Handler for Back on the base layer (no overlays open). Set by the app shell. */
let baseBack: () => void = () => {};
export const setBaseBack = (fn: () => void) => { baseBack = fn; };

/* ------------------------------ focusables ------------------------------ */

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function visible(el: HTMLElement): boolean {
  if (el.closest('[inert],[hidden]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none';
}

export function focusables(root: Element = activeRoot()): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(e => !e.hasAttribute('data-nofocus') && visible(e));
}

export function focusEl(el: HTMLElement | null | undefined, scroll = true) {
  if (!el) return;
  el.focus({ preventScroll: true });
  if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  rememberInGroup(el);
}

export function focusFirst(root: Element = activeRoot()) {
  const pref = root.querySelector<HTMLElement>('[data-autofocus]');
  if (pref && visible(pref)) return focusEl(pref);
  focusEl(focusables(root)[0]);
}

/* ------------------------------ groups ------------------------------ */
// A `data-nav-group` remembers its last focused child, so moving back into a column lands where you left it.

const groupMemory = new WeakMap<Element, HTMLElement>();
function rememberInGroup(el: HTMLElement) {
  const g = el.closest('[data-nav-group]');
  if (g) groupMemory.set(g, el);
}
document.addEventListener('focusin', e => { if (e.target instanceof HTMLElement) rememberInGroup(e.target); });

/* ------------------------------ spatial movement ------------------------------ */

type Dir = 'up' | 'down' | 'left' | 'right';

/** Picks the best element in `dir` from `from`, the way a TV remote is expected to move. */
export function nextInDirection(from: DOMRect, dir: Dir, candidates: { el: HTMLElement; r: DOMRect }[]): HTMLElement | null {
  const horiz = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  let best: HTMLElement | null = null, bestScore = Infinity;
  for (const { el, r } of candidates) {
    // Distance along the direction, edge to edge.
    const main = horiz
      ? (sign > 0 ? r.left - from.right : from.left - r.right)
      : (sign > 0 ? r.top - from.bottom : from.top - r.bottom);
    if (main < -4) continue; // behind us
    const centreMain = horiz ? (r.left + r.right) / 2 - (from.left + from.right) / 2 : (r.top + r.bottom) / 2 - (from.top + from.bottom) / 2;
    if (centreMain * sign <= 0) continue;
    // Sideways offset; zero if the two overlap on the cross axis.
    const cross = horiz
      ? Math.max(0, Math.max(r.top, from.top) - Math.min(r.bottom, from.bottom))
      : Math.max(0, Math.max(r.left, from.left) - Math.min(r.right, from.right));
    const overlap = cross === 0;
    const crossCentre = horiz ? Math.abs((r.top + r.bottom) / 2 - (from.top + from.bottom) / 2) : Math.abs((r.left + r.right) / 2 - (from.left + from.right) / 2);
    const score = Math.max(0, main) + (overlap ? crossCentre * 0.1 : cross * 3 + crossCentre * 0.5 + 1000);
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

export function moveFocus(dir: Dir, root: Element = activeRoot()): boolean {
  const cur = document.activeElement as HTMLElement | null;
  const all = focusables(root);
  if (!cur || cur === document.body || !root.contains(cur)) { focusFirst(root); return true; }
  // A scope keeps focus inside (e.g. a row of player buttons) unless it says which way it may leave.
  const scope = cur.closest<HTMLElement>('[data-nav-scope]');
  let pool = all.filter(e => e !== cur);
  if (scope && root.contains(scope)) {
    const exits = (scope.dataset.navScope || '').split(/\s+/);
    const inside = pool.filter(e => scope.contains(e));
    if (!exits.includes(dir)) pool = inside;
  }
  const target = nextInDirection(cur.getBoundingClientRect(), dir, pool.map(el => ({ el, r: el.getBoundingClientRect() })));
  if (!target) return false;
  // Entering a remembered group: go to its remembered child instead.
  const g = target.closest('[data-nav-group]');
  if (g && !g.contains(cur)) {
    const mem = groupMemory.get(g);
    if (mem && mem.isConnected && visible(mem)) { focusEl(mem); return true; }
  }
  focusEl(target);
  return true;
}

/* ------------------------------ default handling ------------------------------ */

function defaultAction(action: Action) {
  const cur = document.activeElement as HTMLElement | null;
  switch (action) {
    case 'up': case 'down': case 'left': case 'right':
      moveFocus(action);
      return;
    case 'ok':
      if (cur && cur !== document.body) {
        if (cur instanceof HTMLInputElement || cur instanceof HTMLTextAreaElement) { cur.focus(); cur.click(); }
        else if (cur instanceof HTMLSelectElement) cur.click();
        else cur.click();
      } else focusFirst();
      return;
    case 'hold-ok': case 'info': case 'menu':
      // Long-press on something without its own menu: treat as a normal press.
      if (action === 'hold-ok' && cur && cur !== document.body) cur.click();
      return;
    case 'back': {
      const top = layers[layers.length - 1];
      if (top) { top.onBack?.(); return; }
      baseBack();
      return;
    }
    case 'pageup': case 'pagedown':
      for (let i = 0; i < 6; i++) moveFocus(action === 'pageup' ? 'up' : 'down');
      return;
  }
}

const describe = (el: Element | null) => !el || el === document.body ? 'body' : `${el.tagName.toLowerCase()}.${String(el.className).split(' ').join('.')} "${(el.textContent || '').trim().slice(0, 24)}"`;

export function dispatch(action: Action, repeat = false) {
  if (!emitAction(action, repeat)) defaultAction(action);
  // Only debug builds send console output to the Android log; the device test reads it.
  if (!repeat) requestAnimationFrame(() => console.debug(`[orbit] ${action} -> ${describe(document.activeElement)}`));
}

/* ------------------------------ input wiring ------------------------------ */

const HOLD_MS = 550;
let okDownAt = 0, okTimer = 0, okConsumed = false;

const inTextField = () => {
  const a = document.activeElement;
  return a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button'].includes(a.type));
};

function onKeyDown(e: KeyboardEvent) {
  const text = inTextField();
  const action = actionForKey(e, text);
  if (!action) return;
  if (text) {
    const input = document.activeElement as HTMLInputElement;
    // Let the caret move inside text; leave the field only from its ends.
    if (action === 'left' && (input.selectionStart ?? 0) > 0) return;
    if (action === 'right' && (input.selectionEnd ?? 0) < input.value.length) return;
    if (action === 'ok') return; // submit / IME
  }
  if (action === 'ok') {
    e.preventDefault();
    if (e.repeat) return;
    okDownAt = Date.now(); okConsumed = false;
    clearTimeout(okTimer);
    okTimer = window.setTimeout(() => { okConsumed = true; dispatch('hold-ok'); }, HOLD_MS);
    return;
  }
  e.preventDefault();
  dispatch(action, e.repeat);
}

function onKeyUp(e: KeyboardEvent) {
  if (actionForKey(e, inTextField()) !== 'ok' || !okDownAt) return;
  e.preventDefault();
  clearTimeout(okTimer);
  okDownAt = 0;
  if (!okConsumed) dispatch('ok');
}

let installed = false;
export function installKeyHandling() {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  // Debug builds only (see dispatch): every focus change, to trace where focus goes.
  document.addEventListener('focusin', e => console.debug(`[orbit] focus ${describe(e.target as Element)}`));
  // Right-click on desktop = hold OK.
  document.addEventListener('contextmenu', e => {
    if (!(e.target instanceof Element) || inTextField()) return;
    const f = (e.target as Element).closest<HTMLElement>(FOCUSABLE);
    if (!f) return;
    e.preventDefault();
    focusEl(f, false);
    dispatch('hold-ok');
  });
  // Mouse users: keep focus with the pointer so key handling and hover agree.
  document.addEventListener('mousedown', e => {
    const f = e.target instanceof Element ? e.target.closest<HTMLElement>(FOCUSABLE) : null;
    if (f && !(f instanceof HTMLInputElement)) rememberInGroup(f);
  });
}

/** Keys forwarded by the Android activity (they never reach the WebView as key events). */
export function handleNativeKey(key: string, action: 'down' | 'up', repeat: number) {
  if (action !== 'down') return;
  const a = NATIVE_KEY_MAP[key] as Action | undefined;
  if (a) dispatch(a, repeat > 0);
}
