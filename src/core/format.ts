// Small formatting helpers shared by every screen.
export const pad2 = (n: number) => String(n).padStart(2, '0');

export const clock = (t: number | Date) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const dayLabel = (t: number) => {
  const d = new Date(t), today = new Date();
  const diff = Math.round((new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 86400e3);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

/** 75 -> "1:15", 3725 -> "1:02:05" */
export function duration(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** 95 -> "1h 35m" */
export function minutesLabel(min: number): string {
  if (!min || min < 1) return '';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const num = (v: unknown) => { const n = parseFloat(String(v ?? '')); return isFinite(n) ? n : 0; };
