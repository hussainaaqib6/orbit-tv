// Where Orbit is running, and the native bridges available there.
import { Capacitor } from '@capacitor/core';

export type Platform = 'android' | 'ios' | 'electron' | 'web';

/** Bridge exposed by desktop/preload.js in the Electron build. */
export interface DesktopBridge {
  request(o: { url: string; method: string; headers: Record<string, string>; body?: string; type: 'text' | 'bytes' }): Promise<{ status: number; data: string | Uint8Array; headers: Record<string, string> }>;
  setFullscreen(on: boolean): Promise<void>;
  isFullscreen(): Promise<boolean>;
  quit(): void;
}

declare global {
  interface Window { orbitDesktop?: DesktopBridge; ORBIT_DEFAULTS?: { osKey?: string } }
}

export const NATIVE = Capacitor.isNativePlatform();
export const PLATFORM: Platform = NATIVE
  ? (Capacitor.getPlatform() as 'android' | 'ios')
  : typeof window !== 'undefined' && window.orbitDesktop ? 'electron' : 'web';

/** Many IPTV panels refuse browser user agents, so Orbit presents itself as a media player. */
export const PLAYER_UA = 'VLC/3.0.21 LibVLC/3.0.21';

/** True on phones (touch, small screen). TVs and desktops use the TV layout. */
export const IS_PHONE = typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 600 && navigator.maxTouchPoints > 0;

export const defaults = (typeof window !== 'undefined' && window.ORBIT_DEFAULTS) || {};
