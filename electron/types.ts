/** Coarse device class advertised over LAN discovery. */
export type DeviceKind = "pc" | "mac" | "linux" | "mobile" | "iphone" | "unknown";

export interface PeerInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  lastSeen: number;
  paired: boolean;
  connected: boolean;
  kind: DeviceKind;
}

export type WireMessage =
  | { type: "hello"; id: string; name: string; port: number; kind?: DeviceKind }
  | { type: "pair-offer"; id: string; name: string; codeHint: string }
  | {
      type: "pair-confirm";
      id: string;
      name: string;
      code: string;
      saltB64: string;
    }
  | { type: "pair-ok"; id: string; name: string }
  | { type: "pair-reject"; id: string; reason: string }
  | { type: "clip"; id: string; cipherB64: string; seq: number }
  | { type: "ping"; id: string }
  | { type: "pong"; id: string };

export interface AppStateSnapshot {
  deviceId: string;
  deviceName: string;
  listenPort: number;
  deviceKind: DeviceKind;
  /** Sorted non-internal IPv4 addresses used for LAN identity / change detection. */
  localAddresses: string[];
  pairingCode: string | null;
  pairingActive: boolean;
  peers: PeerInfo[];
  lastClipPreview: string | null;
  syncEnabled: boolean;
  /** From package.json / electron app.getVersion(). */
  appVersion: string;
  updateAvailable: boolean;
  updateVersion: string | null;
  updateUrl: string | null;
}

export function deviceKindFromPlatform(platform = process.platform): DeviceKind {
  switch (platform) {
    case "win32":
      return "pc";
    case "darwin":
      return "mac";
    case "linux":
      return "linux";
    case "android":
      return "mobile";
    default:
      return "unknown";
  }
}

export function normalizeDeviceKind(raw: unknown): DeviceKind {
  const k = String(raw ?? "");
  if (k === "pc" || k === "mac" || k === "linux" || k === "mobile" || k === "iphone") {
    return k;
  }
  return "unknown";
}

export interface ManualPeerInput {
  host: string;
  port: number;
  name?: string;
}
