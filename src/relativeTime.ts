/**
 * Format a past timestamp (ms) as a compact relative string like "3m ago" or
 * "2d ago". Falls back to "just now" under a minute and an absolute date past a
 * month. Pure + dependency-free so it's trivial to copy.
 */
export function formatRelative(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < 0) return "just now";

  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;

  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;

  return new Date(ms).toLocaleDateString();
}
