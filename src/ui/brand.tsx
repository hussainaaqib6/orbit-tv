// The Matrix TV logo, set in the app's own typeface so it sits naturally in the interface at any
// size: MATRIX in chrome, with TV on a red tag. The monogram is the square version for tight spaces.
import { APP_NAME } from '../core/brand';

export const Wordmark = ({ class: cls }: { class?: string }) => (
  <span class={`wordmark ${cls ?? ''}`} role="img" aria-label={APP_NAME}>
    <span class="wm-word">MATRIX</span><span class="wm-tag">TV</span>
  </span>
);

export const Monogram = ({ class: cls }: { class?: string }) => (
  <span class={`monogram ${cls ?? ''}`} aria-hidden="true"><span class="mg-m">M</span><span class="mg-tag">TV</span></span>
);
