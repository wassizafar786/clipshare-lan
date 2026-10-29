import { createSocket, type Socket as DgramSocket } from "node:dgram";
import net, {
  createServer,
  type Server as NetServer,
  type Socket as NetSocket,
} from "node:net";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import {
  decryptPayload,
  deriveKeyFromPairingCode,
  encryptPayload,
  generatePairingCode,
} from "./crypto-util";
import {
  deviceKindFromPlatform,
  normalizeDeviceKind,
  type AppStateSnapshot,
  type DeviceKind,
  type PeerInfo,
  type WireMessage,
} from "./types";

const DISCOVERY_PORT = 41234;
const BROADCAST = "255.255.255.255";
/** Drop peers with no hello for this long (quit / left Wi‑Fi). */
const PEER_STALE_MS = 12_000;

function localIpv4s(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) {
      if ((n.family === "IPv4" || (n.family as unknown) === 4) && !n.internal) {
        out.push(n.address);
      }
    }
  }
  return out;
}

function ipv4Broadcast(address: string, netmask: string): string | null {
  const a = address.split(".").map((x) => Number(x));
  const m = netmask.split(".").map((x) => Number(x));
  if (a.length !== 4 || m.length !== 4 || a.some((n) => Number.isNaN(n)) || m.some((n) => Number.isNaN(n))) {
    return null;
  }
  return a.map((octet, i) => (octet | (~m[i] & 255)) & 255).join(".");
}

/** Global + per-NIC directed broadcasts (helps installed apps on multi-homed PCs). */
function discoveryBroadcastTargets(): string[] {
  const targets = new Set<string>([BROADCAST]);
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) {
      if ((n.family !== "IPv4" && (n.family as unknown) !== 4) || n.internal) continue;
      if (n.netmask) {
        const b = ipv4Broadcast(n.address, n.netmask);
        if (b) targets.add(b);
      }
    }
  }
  return [...targets];
}

function parseLine(raw: string): WireMessage | null {
  try {
    return JSON.parse(raw) as WireMessage;
  } catch {
    return null;
  }
}

export type ClipHandler = (text: string, fromPeer: string) => void;

export class ClipMeshNetwork {
  readonly deviceId: string;
  deviceName: string;
  readonly deviceKind: DeviceKind;
  listenPort = 0;
  syncEnabled = true;

  private pairingCode: string | null = null;
  private pairingSalt: Buffer | null = null;
  private pairingKey: Buffer | null = null;
  private pairingActive = false;
  private seq = 0;
  private lastAppliedHash = "";
  private suppressingEchoUntil = 0;

  private peers = new Map<string, PeerInfo>();
  private sessionKeys = new Map<string, Buffer>();
  private sockets = new Map<string, NetSocket>();

  private udp: DgramSocket | null = null;
  private tcp: NetServer | null = null;
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private onClip: ClipHandler;
  private onChange: () => void;

  constructor(opts: {
    deviceId: string;
    deviceName: string;
    onClip: ClipHandler;
    onChange: () => void;
  }) {
    this.deviceId = opts.deviceId;
    this.deviceName = opts.deviceName;
    this.deviceKind = deviceKindFromPlatform();
    this.onClip = opts.onClip;
    this.onChange = opts.onChange;
  }

  snapshot(): AppStateSnapshot {
    return {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      listenPort: this.listenPort,
      deviceKind: this.deviceKind,
      localAddresses: localIpv4s().slice().sort(),
      pairingCode: this.pairingCode,
      pairingActive: this.pairingActive,
      peers: [...this.peers.values()].sort((a, b) => a.name.localeCompare(b.name)),
      lastClipPreview: null,
      syncEnabled: this.syncEnabled,
      // Filled by main enrichSnapshot
      appVersion: "",
      updateAvailable: false,
      updateVersion: null,
      updateUrl: null,
    };
  }

  /** Drop session with a peer (local unpair). */
  unpairPeer(peerId: string): void {
    this.sessionKeys.delete(peerId);
    const socket = this.sockets.get(peerId);
    if (socket) {
      socket.destroy();
      this.sockets.delete(peerId);
    }
    const p = this.peers.get(peerId);
    if (p) {
      p.paired = false;
      p.connected = false;
      this.peers.set(peerId, p);
    }
    this.onChange();
  }

  async start(): Promise<void> {
    await this.startTcp();
    this.startUdp();
    this.helloTimer = setInterval(() => this.broadcastHello(), 2000);
    this.pruneTimer = setInterval(() => this.pruneStalePeers(), 2000);
    this.broadcastHello();
  }

  stop(): void {
    if (this.helloTimer) clearInterval(this.helloTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.udp?.close();
    this.tcp?.close();
    for (const s of this.sockets.values()) s.destroy();
    this.sockets.clear();
  }

  beginPairing(): string {
    this.pairingCode = generatePairingCode();
    this.pairingSalt = randomBytes(16);
    this.pairingKey = deriveKeyFromPairingCode(this.pairingCode, this.pairingSalt);
    this.pairingActive = true;
    this.onChange();
    return this.pairingCode;
  }

  cancelPairing(): void {
    this.pairingActive = false;
    this.pairingCode = null;
    this.pairingSalt = null;
    this.pairingKey = null;
    this.onChange();
  }

  /** Enter code shown on the other device. */
  async pairWithCode(peerId: string, code: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error("Peer not found — wait for discovery");
    const salt = randomBytes(16);
    const key = deriveKeyFromPairingCode(code, salt);
    this.sessionKeys.set(peerId, key);
    await this.ensureConnected(peer);
    this.send(peerId, {
      type: "pair-confirm",
      id: this.deviceId,
      name: this.deviceName,
      code,
      saltB64: salt.toString("base64"),
    });
  }

  async broadcastClipboard(text: string): Promise<void> {
    if (!this.syncEnabled) return;
    if (Date.now() < this.suppressingEchoUntil) return;
    const hash = Buffer.from(text).toString("base64url").slice(0, 32);
    if (hash === this.lastAppliedHash) return;
    this.seq += 1;
    for (const [peerId, key] of this.sessionKeys) {
      const peer = this.peers.get(peerId);
      if (!peer?.paired) continue;
      try {
        await this.ensureConnected(peer);
        this.send(peerId, {
          type: "clip",
          id: this.deviceId,
          cipherB64: encryptPayload(text, key),
          seq: this.seq,
        });
      } catch {
        // peer offline
      }
    }
  }

  markLocalClipboard(text: string): void {
    this.lastAppliedHash = Buffer.from(text).toString("base64url").slice(0, 32);
  }

  setSyncEnabled(on: boolean): void {
    this.syncEnabled = on;
    this.onChange();
  }

  isSuppressingEcho(): boolean {
    return Date.now() < this.suppressingEchoUntil;
  }

  /** Manual host:port when UDP discovery is blocked. */
  addManualPeer(host: string, port: number, name?: string): string {
    const id = `manual:${host}:${port}`;
    this.upsertPeer({
      id,
      name: name?.trim() || `${host}:${port}`,
      host,
      port,
      lastSeen: Date.now(),
      paired: this.sessionKeys.has(id),
      connected: this.sockets.has(id),
      kind: "unknown",
    });
    return id;
  }

  private async startTcp(): Promise<void> {
    this.tcp = createServer((socket) => this.attachSocket(socket));
    await new Promise<void>((resolve, reject) => {
      this.tcp!.once("error", reject);
      this.tcp!.listen(0, "0.0.0.0", () => {
        const addr = this.tcp!.address();
        if (addr && typeof addr === "object") this.listenPort = addr.port;
        resolve();
      });
    });
  }

  private startUdp(): void {
    this.udp = createSocket({ type: "udp4", reuseAddr: true });
    this.udp.on("error", () => {
      /* bind/send errors should not crash the tray app */
    });
    this.udp.on("message", (msg, rinfo) => {
      const m = parseLine(msg.toString("utf8"));
      if (!m || m.type !== "hello") return;
      if (m.id === this.deviceId) return;
      if (localIpv4s().includes(rinfo.address) && m.port === this.listenPort) return;
      this.upsertPeer({
        id: m.id,
        name: m.name,
        host: rinfo.address,
        port: m.port,
        lastSeen: Date.now(),
        paired: this.sessionKeys.has(m.id),
        connected: this.sockets.has(m.id),
        kind: normalizeDeviceKind(m.kind),
      });
    });
    this.udp.bind(DISCOVERY_PORT, "0.0.0.0", () => {
      try {
        this.udp!.setBroadcast(true);
      } catch {
        /* ignore */
      }
      this.broadcastHello();
    });
  }

  private broadcastHello(): void {
    if (!this.udp || !this.listenPort) return;
    const payload = JSON.stringify({
      type: "hello",
      id: this.deviceId,
      name: this.deviceName,
      port: this.listenPort,
      kind: this.deviceKind,
    } satisfies WireMessage);
    for (const host of discoveryBroadcastTargets()) {
      try {
        this.udp.send(payload, DISCOVERY_PORT, host);
      } catch {
        /* ignore per-target failures */
      }
    }
  }

  /** Remove devices that stopped advertising (app quit / left network). Keep session keys. */
  private pruneStalePeers(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.peers) {
      // Manual entries stay while connected; otherwise same stale window
      if (id.startsWith("manual:") && this.sockets.has(id)) {
        peer.lastSeen = now;
        continue;
      }
      if (now - peer.lastSeen <= PEER_STALE_MS) continue;
      this.peers.delete(id);
      const sock = this.sockets.get(id);
      if (sock) {
        sock.destroy();
        this.sockets.delete(id);
      }
      changed = true;
    }
    if (changed) this.onChange();
  }

  private upsertPeer(peer: PeerInfo): void {
    const prev = this.peers.get(peer.id);
    this.peers.set(peer.id, {
      ...peer,
      kind:
        peer.kind && peer.kind !== "unknown"
          ? peer.kind
          : prev?.kind && prev.kind !== "unknown"
            ? prev.kind
            : peer.kind || "unknown",
      paired: prev?.paired || peer.paired || this.sessionKeys.has(peer.id),
      connected: this.sockets.has(peer.id),
    });
    this.onChange();
  }

  private attachSocket(socket: NetSocket, knownId?: string): void {
    let buf = "";
    let peerId = knownId ?? "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const msg = parseLine(line);
        if (!msg) continue;
        if ("id" in msg && msg.id) peerId = msg.id;
        void this.handleMessage(msg, socket, peerId);
      }
    });
    socket.on("close", () => {
      if (peerId) {
        this.sockets.delete(peerId);
        const p = this.peers.get(peerId);
        if (p) {
          p.connected = false;
          this.peers.set(peerId, p);
          this.onChange();
        }
      }
    });
  }

  private async ensureConnected(peer: PeerInfo): Promise<void> {
    if (this.sockets.has(peer.id)) return;
    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("connect timeout"));
      }, 4000);
      socket.connect(peer.port, peer.host, () => {
        clearTimeout(timer);
        this.sockets.set(peer.id, socket);
        this.attachSocket(socket, peer.id);
        peer.connected = true;
        this.peers.set(peer.id, peer);
        this.onChange();
        resolve();
      });
      socket.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private send(peerId: string, msg: WireMessage): void {
    const socket = this.sockets.get(peerId);
    if (!socket) throw new Error("not connected");
    socket.write(JSON.stringify(msg) + "\n");
  }

  private async handleMessage(
    msg: WireMessage,
    socket: NetSocket,
    peerId: string,
  ): Promise<void> {
    if (msg.type === "hello") return;

    if (msg.type === "pair-confirm") {
      if (!this.pairingActive || !this.pairingCode || !this.pairingSalt) {
        socket.write(
          JSON.stringify({
            type: "pair-reject",
            id: this.deviceId,
            reason: "pairing not active",
          }) + "\n",
        );
        return;
      }
      if (msg.code !== this.pairingCode) {
        socket.write(
          JSON.stringify({
            type: "pair-reject",
            id: this.deviceId,
            reason: "bad code",
          }) + "\n",
        );
        return;
      }
      // Prefer initiator salt so both derive the same key from the code+salt they exchange
      const salt = Buffer.from(msg.saltB64, "base64");
      const key = deriveKeyFromPairingCode(msg.code, salt);
      this.sessionKeys.set(msg.id, key);
      this.sockets.set(msg.id, socket);
      this.upsertPeer({
        id: msg.id,
        name: msg.name,
        host: socket.remoteAddress?.replace("::ffff:", "") ?? "unknown",
        port: socket.remotePort ?? 0,
        lastSeen: Date.now(),
        paired: true,
        connected: true,
        kind: this.peers.get(msg.id)?.kind ?? "unknown",
      });
      this.send(msg.id, { type: "pair-ok", id: this.deviceId, name: this.deviceName });
      this.cancelPairing();
      return;
    }

    if (msg.type === "pair-ok") {
      this.sessionKeys.set(msg.id, this.sessionKeys.get(msg.id)!);
      const p = this.peers.get(msg.id);
      if (p) {
        p.paired = true;
        p.connected = true;
        this.peers.set(msg.id, p);
      }
      this.sockets.set(msg.id, socket);
      this.onChange();
      return;
    }

    if (msg.type === "clip") {
      const key = this.sessionKeys.get(msg.id);
      if (!key) return;
      try {
        const text = decryptPayload(msg.cipherB64, key);
        this.suppressingEchoUntil = Date.now() + 1500;
        this.lastAppliedHash = Buffer.from(text).toString("base64url").slice(0, 32);
        this.onClip(text, msg.id);
      } catch {
        // bad key / tamper
      }
      return;
    }
  }
}

/** Pure helpers exported for smoke tests (no sockets). */
export const protocolTest = {
  deriveKeyFromPairingCode,
  encryptPayload,
  decryptPayload,
  generatePairingCode,
  localIpv4s,
};
