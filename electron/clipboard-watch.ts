import { clipboard } from "electron";

export function startClipboardWatch(
  onLocalCopy: (text: string) => void,
  opts: { intervalMs?: number; shouldSkip?: () => boolean } = {},
): () => void {
  const intervalMs = opts.intervalMs ?? 500;
  let last = "";
  try {
    last = clipboard.readText();
  } catch {
    last = "";
  }

  const timer = setInterval(() => {
    if (opts.shouldSkip?.()) return;
    let text = "";
    try {
      text = clipboard.readText();
    } catch {
      return;
    }
    if (!text || text === last) return;
    last = text;
    onLocalCopy(text);
  }, intervalMs);

  return () => clearInterval(timer);
}

export function writeClipboardText(text: string): void {
  clipboard.writeText(text);
}
