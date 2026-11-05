import { Notification } from "electron";

const lastShown = new Map<string, number>();
const COOLDOWN_MS = 10_000;
/** Ensure peer toasts don't fire in the same instant (offline+reconnected race). */
let chain: Promise<void> = Promise.resolve();
const PEER_GAP_MS = 800;

function showNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.show();
}

/** OS notification with per-key debounce so the same event does not spam. */
export function notifyOnce(key: string, title: string, body: string): void {
  const now = Date.now();
  const prev = lastShown.get(key) ?? 0;
  if (now - prev < COOLDOWN_MS) return;
  lastShown.set(key, now);
  showNotification(title, body);
}

export type PeerNotifyEvent = "paired" | "unpaired" | "offline" | "reconnected";

/**
 * One notification per peer transition. Same peer+event is debounced;
 * different events are queued a short gap apart so they appear one at a time.
 */
export function notifyPeerEvent(
  peerId: string,
  event: PeerNotifyEvent,
  title: string,
  body: string,
): void {
  const now = Date.now();
  const key = `peer:${peerId}:${event}`;
  const prevSame = lastShown.get(key) ?? 0;
  if (now - prevSame < COOLDOWN_MS) return;
  lastShown.set(key, now);

  chain = chain
    .then(
      () =>
        new Promise<void>((resolve) => {
          showNotification(title, body);
          setTimeout(resolve, PEER_GAP_MS);
        }),
    )
    .catch(() => {
      /* ignore */
    });
}
