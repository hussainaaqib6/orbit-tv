// The Android plugin that lives in android/app/src/main/java/tv/orbit/player/OrbitPlayerPlugin.java.
// It plays video with ExoPlayer on a surface behind the (transparent) WebView, and forwards remote
// keys the WebView never sees (Back, Menu, media and channel keys, colour buttons).
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeKeyEvent { key: string; action: 'down' | 'up'; repeat: number }
export interface NativeRect { x: number; y: number; width: number; height: number }
export interface NativeTrack { id: string; type: 'audio' | 'text' | 'video'; label: string; language: string; selected: boolean; codec?: string; width?: number; height?: number }
export interface NativeState { state: 'idle' | 'buffering' | 'ready' | 'ended'; playing: boolean }
export interface NativeProgress { id: string; bytes: number; total: number; items: number; file?: number; files?: number }
export interface NativeTime { position: number; duration: number; buffered: number; live: boolean; seekable: boolean; frames?: number }

export interface OrbitPlayerPlugin {
  load(o: { url: string; headers?: Record<string, string>; startPosition?: number; live?: boolean; rect?: NativeRect | null }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seekTo(o: { position: number }): Promise<void>;
  setRect(o: { rect: NativeRect | null }): Promise<void>;
  /** Draw the preview above the app (Android). */
  setOnTop(o: { onTop: boolean }): Promise<void>;
  setAspect(o: { mode: string; zoom: number }): Promise<void>;
  setSpeed(o: { speed: number }): Promise<void>;
  setMuted(o: { muted: boolean }): Promise<void>;
  selectTrack(o: { type: 'audio' | 'text'; id: string | null }): Promise<void>;
  setSubtitleStyle(o: { scale: number; background: boolean; raised: boolean }): Promise<void>;
  exitApp(): Promise<void>;
  /** Serves `page` on the home network while the add-playlist screen is open; see PairingPanel. */
  startPairing(o: { page: string }): Promise<{ url: string }>;
  stopPairing(): Promise<void>;
  /** Downloads to the app cache; read the file with fetch(Capacitor.convertFileSrc(path)). */
  download(o: { url: string; name: string; headers?: Record<string, string>; timeoutMs?: number; progressId?: string }): Promise<{ status: number; path: string; size: number; contentType?: string }>;
  /** Streams XMLTV guides into an on-device database (Android). Reports progress with id "guide". */
  guideBuild(o: { urls: string[]; ids: string[]; names: string[]; offsetHours: number; from: number; to: number; maxDesc?: number }): Promise<{ programmes: number; channels: number; errors: string[]; indexPath: string }>;
  guideInfo(): Promise<{ exists: boolean; indexPath: string }>;
  guideQuery(o: { ids: string[]; from: number; to: number }): Promise<{ json: string }>;
  guideSearch(o: { q: string; from: number; limit?: number }): Promise<{ json: string }>;
  addListener(ev: 'progress', fn: (e: NativeProgress) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'key', fn: (e: NativeKeyEvent) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'pairing', fn: (e: Record<string, string>) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'state', fn: (e: NativeState) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'time', fn: (e: NativeTime) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'tracks', fn: (e: { tracks: NativeTrack[] }) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'cues', fn: (e: { text: string }) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'error', fn: (e: { message: string; code: string; http?: number }) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'videoSize', fn: (e: { width: number; height: number }) => void): Promise<PluginListenerHandle>;
}

export const OrbitPlayer = registerPlugin<OrbitPlayerPlugin>('OrbitPlayer');
