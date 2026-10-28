import { Notification } from "electron";

const lastShown = new Map<string, number>();
const COOLDOWN_MS = 15_000;

/** OS notification with per-key debounce so the same event does not spam. */
export function notifyOnce(key: string, title: string, body: string): void {
  const now = Date.now();
  const prev = lastShown.get(key) ?? 0;
  if (now - prev < COOLDOWN_MS) return;
  lastShown.set(key, now);
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.show();
}
