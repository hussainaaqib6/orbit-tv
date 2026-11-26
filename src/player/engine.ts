// What every playback engine provides. The player controller and UI only talk to this.

export interface Rect { x: number; y: number; width: number; height: number }

export interface Track {
  id: string;
  type: 'audio' | 'text';
  label: string;
  language: string;
  selected: boolean;
}

export type EngineState = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';

export interface EngineEvents {
  state(s: EngineState): void;
  /** `frames`: video frames drawn so far, when the engine knows (native only). */
  time(t: { position: number; duration: number; live: boolean; seekable: boolean; frames?: number }): void;
  tracks(t: Track[]): void;
  /** Text of the embedded subtitle cue showing now ('' for none). */
  cue(text: string): void;
  error(message: string, detail?: { http?: number; code?: string }): void;
}

export interface LoadOptions {
  live: boolean;
  /** Seconds to start from (films/episodes). */
  start?: number;
  headers?: Record<string, string>;
}

export interface Engine {
  readonly name: 'native' | 'web';
  load(url: string, o: LoadOptions): void;
  play(): void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  /** Where the picture goes, in CSS pixels. null = full screen. */
  setRect(r: Rect | null): void;
  setAspect(mode: string, zoom: number): void;
  setSpeed(speed: number): void;
  setMuted(muted: boolean): void;
  selectTrack(type: 'audio' | 'text', id: string | null): void;
  /** Native engines draw the stream's own subtitles themselves; the web layer draws everything else. */
  readonly drawsEmbeddedSubtitles: boolean;
  setSubtitleStyle(scale: number, background: boolean, raised: boolean): void;
  destroy(): void;
}
