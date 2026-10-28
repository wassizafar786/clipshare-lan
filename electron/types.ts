export interface PeerInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  lastSeen: number;
  paired: boolean;
  connected: boolean;
}

export type WireMessage =
  | { type: "hello"; id: string; name: string; port: number }
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
  pairingCode: string | null;
  pairingActive: boolean;
  peers: PeerInfo[];
  lastClipPreview: string | null;
  syncEnabled: boolean;
}

export interface ManualPeerInput {
  host: string;
  port: number;
  name?: string;
}
