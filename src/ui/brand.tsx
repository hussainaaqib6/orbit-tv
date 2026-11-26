// The Matrix 8K Player logo, set in the app's own typeface so it sits naturally in the interface at
// any size: MATRIX in chrome, 8K on a red tag, PLAYER spaced out underneath (optional). The monogram
// is the square version for tight spaces. The same design is used for the app icon and splash.
import { APP_NAME } from '../core/brand';

export const Wordmark = ({ class: cls, player = true }: { class?: string; player?: boolean }) => (
  <span class={`wordmark ${cls ?? ''}`} role="img" aria-label={APP_NAME}>
    <span class="wm-row"><span class="wm-word">MATRIX</span><span class="wm-tag">8K</span></span>
    {player && <span class="wm-player">PLAYER</span>}
  </span>
);

export const Monogram = ({ class: cls }: { class?: string }) => (
  <span class={`monogram ${cls ?? ''}`} aria-hidden="true"><span class="mg-m">M</span><span class="mg-tag">8K</span></span>
);
