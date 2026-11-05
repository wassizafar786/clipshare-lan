import { createSocket, type Socket as DgramSocket } from "node:dgram";
import net, {
  createServer,
  type Server as NetServer,
  type Socket as NetSocket,
} from "node:net";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import {
  decryptBytes,
  decryptPayload,
  deriveKeyFromPairingCode,
  encryptBytes,
  encryptPayload,
  generatePairingCode,
} from "./crypto-util";
import {
  deviceKindFromPlatform,
  FILE_CHUNK_BYTES,
  MAX_FILE_BYTES,
  normalizeDeviceKind,
  type AppStateSnapshot,
  type DeviceKind,
  type PeerInfo,
  type TransferProgress,
  type WireMessage,
} from "./types";

const DISCOVERY_PORT = 41234;
const BROADCAST = "255.255.255.255";
/** Mark unpaired “seen” peers stale / paired peers offline after this quiet period. */
const PEER_STALE_MS = 12_000;
/** Min gap between auto-reconnect attempts for a paired peer. */
const RECONNECT_COOLDOWN_MS = 3_000;
/**
 * macOS returns EHOSTUNREACH immediately when ARP for a Wi-Fi peer is still
 * incomplete (Windows radio asleep / just appeared). A later attempt succeeds.
 */
const CONNECT_TIMEOUT_MS = 2_000;
const CONNECT_RETRY_DELAYS_MS = [0, 400, 900, 1600, 2800, 4500];

type IncomingFile = {
  peerId: string;
  peerName: string;
  name: string;
  size: number;
  mime: string;
  totalChunks: number;
  received: number;
  nextIndex: number;
  tempPath: string;
  stream: ReturnType<typeof createWriteStream>;
};

type PendingAck = {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

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

/** Failures worth retrying: neighbor still waking, or the TCP port not ready yet. */
export function isTransientConnectError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code || "";
  if (
    code === "EHOSTUNREACH" ||
    code === "EHOSTDOWN" ||
    code === "ENETUNREACH" ||
    code === "ENETDOWN" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }
  return String((err as Error | undefined)?.message || err || "").includes("connect timeout");
}

function connectFailureMessage(peer: PeerInfo, err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code || "";
  const where = `${peer.name} (${peer.host}:${peer.port})`;
  if (code === "EHOSTUNREACH" || code === "EHOSTDOWN" || code === "ENETUNREACH" || code === "ENETDOWN") {
    return `Can't reach ${where}. It is on the Wi-Fi list but not answering. Wake that PC, turn off any VPN, then try pairing again.`;
  }
  if (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    String((err as Error | undefined)?.message || "").includes("connect timeout")
  ) {
    return `Can't connect to ${where}. On Windows, allow ClipShare LAN through the firewall for private networks, then try again.`;
  }
  const raw = err instanceof Error ? err.message : String(err);
  return `Can't connect to ${where}. ${raw}`;
}

export type ClipHandler = (text: string, fromPeer: string) => void;
export type FileReceivedHandler = (info: {
  peerId: string;
  peerName: string;
  fileName: string;
  filePath: string;
  size: number;
  mime: string;
}) => void;

export class ClipMeshNetwork {
  readonly deviceId: string;
  deviceName: string;
  readonly deviceKind: DeviceKind;
  listenPort = 0;
  syncEnabled = true;
  /** Directory for received files (Downloads/ClipShare). */
  receiveDir = "";

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
  private transfers = new Map<string, TransferProgress>();
  private incoming = new Map<string, IncomingFile>();
  private pendingAcks = new Map<string, PendingAck>();

  private udp: DgramSocket | null = null;
  private tcp: NetServer | null = null;
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttemptAt = new Map<string, number>();
  private onClip: ClipHandler;
  private onFileReceived: FileReceivedHandler;
  private onChange: () => void;

  constructor(opts: {
    deviceId: string;
    deviceName: string;
    receiveDir: string;
    onClip: ClipHandler;
    onFileReceived: FileReceivedHandler;
    onChange: () => void;
  }) {
    this.deviceId = opts.deviceId;
    this.deviceName = opts.deviceName;
    this.receiveDir = opts.receiveDir;
    this.deviceKind = deviceKindFromPlatform();
    this.onClip = opts.onClip;
    this.onFileReceived = opts.onFileReceived;
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
      updateStatus: "idle",
      updateProgress: null,
      updateError: null,
      transfers: [...this.transfers.values()],
      history: [],
    };
  }

  listTransfers(): TransferProgress[] {
    return [...this.transfers.values()];
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

  /** Send a local file to a paired peer (encrypted chunks + progress). */
  async sendFile(
    peerId: string,
    filePath: string,
    opts?: { size?: number; mime?: string; fileName?: string },
  ): Promise<TransferProgress> {
    const peer = this.peers.get(peerId);
    if (!peer?.paired) throw new Error("Peer is not paired");
    const key = this.sessionKeys.get(peerId);
    if (!key) throw new Error("No session key — re-pair the device");

    const fileName = opts?.fileName || basename(filePath);
    const size = opts?.size;
    if (size == null) throw new Error("File size required");
    if (size <= 0) throw new Error("Empty file");
    if (size > MAX_FILE_BYTES) {
      throw new Error(`File too large (max ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB)`);
    }

    const mime = opts?.mime || guessMime(fileName);
    const transferId = randomUUID();
    const totalChunks = Math.ceil(size / FILE_CHUNK_BYTES) || 1;

    const progress: TransferProgress = {
      transferId,
      peerId,
      peerName: peer.name,
      direction: "out",
      fileName,
      bytesDone: 0,
      bytesTotal: size,
      status: "active",
    };
    this.transfers.set(transferId, progress);
    this.onChange();

    try {
      await this.ensureConnected(peer);
      this.send(peerId, {
        type: "file-offer",
        id: this.deviceId,
        transferId,
        name: fileName,
        size,
        mime,
      });
      // Wait for ack index -1 meaning offer accepted (we use index -1)
      await this.waitAck(transferId, -1);

      const stream = createReadStream(filePath, { highWaterMark: FILE_CHUNK_BYTES });
      let index = 0;
      let sent = 0;
      for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        this.send(peerId, {
          type: "file-chunk",
          id: this.deviceId,
          transferId,
          index,
          total: totalChunks,
          cipherB64: encryptBytes(buf, key),
        });
        await this.waitAck(transferId, index);
        sent += buf.length;
        index += 1;
        progress.bytesDone = sent;
        this.transfers.set(transferId, { ...progress });
        this.onChange();
      }

      this.send(peerId, {
        type: "file-done",
        id: this.deviceId,
        transferId,
      });
      progress.bytesDone = size;
      progress.status = "done";
      this.transfers.set(transferId, { ...progress });
      this.onChange();
      return progress;
    } catch (err) {
      const reason = String((err as Error)?.message || err);
      progress.status = "error";
      progress.error = reason;
      this.transfers.set(transferId, { ...progress });
      try {
        this.send(peerId, {
          type: "file-error",
          id: this.deviceId,
          transferId,
          reason,
        });
      } catch {
        /* offline */
      }
      this.onChange();
      throw err;
    }
  }

  markLocalClipboard(text: string): void {
    this.lastAppliedHash = Buffer.from(text).toString("base64url").slice(0, 32);
  }

  private waitAck(transferId: string, index: number): Promise<void> {
    const key = `${transferId}:${index}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(key);
        reject(new Error("Transfer timed out waiting for ack"));
      }, 30_000);
      this.pendingAcks.set(key, { resolve, reject, timer });
    });
  }

  private resolveAck(transferId: string, index: number): void {
    const key = `${transferId}:${index}`;
    const pending = this.pendingAcks.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingAcks.delete(key);
    pending.resolve();
  }

  private uniqueReceivePath(fileName: string): string {
    mkdirSync(this.receiveDir, { recursive: true });
    const safe = fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 180) || "file";
    let candidate = join(this.receiveDir, safe);
    if (!existsSafe(candidate)) return candidate;
    const ext = extname(safe);
    const base = basename(safe, ext);
    for (let i = 1; i < 10_000; i++) {
      candidate = join(this.receiveDir, `${base} (${i})${ext}`);
      if (!existsSafe(candidate)) return candidate;
    }
    return join(this.receiveDir, `${base}-${randomUUID()}${ext}`);
  }

  private abortIncoming(transferId: string, reason: string): void {
    const inc = this.incoming.get(transferId);
    if (inc) {
      try {
        inc.stream.destroy();
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(inc.tempPath);
      } catch {
        /* ignore */
      }
      this.incoming.delete(transferId);
    }
    const t = this.transfers.get(transferId);
    if (t) {
      t.status = "error";
      t.error = reason;
      this.transfers.set(transferId, { ...t });
      this.onChange();
    }
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
      this.maybeReconnectPaired(m.id);
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

  private helloPayload(): string {
    return JSON.stringify({
      type: "hello",
      id: this.deviceId,
      name: this.deviceName,
      port: this.listenPort,
      kind: this.deviceKind,
    } satisfies WireMessage);
  }

  private broadcastHello(): void {
    if (!this.udp || !this.listenPort) return;
    const payload = this.helloPayload();
    for (const host of discoveryBroadcastTargets()) {
      try {
        this.udp.send(payload, DISCOVERY_PORT, host);
      } catch {
        /* ignore per-target failures */
      }
    }
  }

  /** Unicast hello so a sleeping Wi-Fi peer answers ARP before we open TCP. */
  private nudgePeer(host: string): void {
    if (!this.udp || !this.listenPort) return;
    try {
      this.udp.send(this.helloPayload(), DISCOVERY_PORT, host);
    } catch {
      /* ignore */
    }
  }

  /**
   * Unpaired “seen” peers: drop when hellos stop.
   * Paired peers: keep in the list as offline (session key retained) so reconnect
   * does not look like unpaired / require a new code.
   */
  private pruneStalePeers(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.peers) {
      if (id.startsWith("manual:") && this.sockets.has(id)) {
        peer.lastSeen = now;
        continue;
      }
      if (now - peer.lastSeen <= PEER_STALE_MS) continue;

      const hasSession = this.sessionKeys.has(id) || peer.paired;
      if (hasSession) {
        const sock = this.sockets.get(id);
        if (sock) {
          sock.destroy();
          this.sockets.delete(id);
        }
        if (peer.connected) {
          peer.connected = false;
          peer.paired = true;
          this.peers.set(id, peer);
          changed = true;
        }
        continue;
      }

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

  /** Re-open TCP to a paired peer when they reappear on the LAN. */
  private maybeReconnectPaired(peerId: string): void {
    if (!this.sessionKeys.has(peerId)) return;
    if (this.sockets.has(peerId)) return;
    const peer = this.peers.get(peerId);
    if (!peer) return;
    const now = Date.now();
    const last = this.reconnectAttemptAt.get(peerId) ?? 0;
    if (now - last < RECONNECT_COOLDOWN_MS) return;
    this.reconnectAttemptAt.set(peerId, now);
    void this.ensureConnected(peer).catch(() => {
      /* peer may still be coming online */
    });
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

  private connectOnce(peer: PeerInfo): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.sockets.has(peer.id)) {
        resolve();
        return;
      }
      const socket = new net.Socket();
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error("connect timeout")), CONNECT_TIMEOUT_MS);
      socket.once("error", (err) => fail(err));
      socket.connect(peer.port, peer.host, () => {
        if (settled) {
          socket.destroy();
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.sockets.set(peer.id, socket);
        this.attachSocket(socket, peer.id);
        peer.connected = true;
        this.peers.set(peer.id, peer);
        this.onChange();
        resolve();
      });
    });
  }

  private async ensureConnected(peer: PeerInfo): Promise<void> {
    if (this.sockets.has(peer.id)) return;
    let lastErr: unknown = new Error("connect timeout");
    for (let i = 0; i < CONNECT_RETRY_DELAYS_MS.length; i++) {
      if (this.sockets.has(peer.id)) return;
      const delay = CONNECT_RETRY_DELAYS_MS[i] ?? 0;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (this.sockets.has(peer.id)) return;
      this.nudgePeer(peer.host);
      try {
        await this.connectOnce(peer);
        return;
      } catch (err) {
        lastErr = err;
        if (!isTransientConnectError(err)) break;
      }
    }
    throw new Error(connectFailureMessage(peer, lastErr));
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

    if (msg.type === "file-offer") {
      await this.handleFileOffer(msg, socket);
      return;
    }
    if (msg.type === "file-chunk") {
      await this.handleFileChunk(msg);
      return;
    }
    if (msg.type === "file-ack") {
      this.resolveAck(msg.transferId, msg.index);
      return;
    }
    if (msg.type === "file-done") {
      // sender finished; receiver already finalized on last chunk
      return;
    }
    if (msg.type === "file-error") {
      this.abortIncoming(msg.transferId, msg.reason);
      const out = this.transfers.get(msg.transferId);
      if (out && out.direction === "out") {
        out.status = "error";
        out.error = msg.reason;
        this.transfers.set(msg.transferId, { ...out });
        this.onChange();
      }
    }
  }

  private async handleFileOffer(
    msg: Extract<WireMessage, { type: "file-offer" }>,
    socket: NetSocket,
  ): Promise<void> {
    const key = this.sessionKeys.get(msg.id);
    if (!key) {
      socket.write(
        JSON.stringify({
          type: "file-error",
          id: this.deviceId,
          transferId: msg.transferId,
          reason: "not paired",
        }) + "\n",
      );
      return;
    }
    if (msg.size <= 0 || msg.size > MAX_FILE_BYTES) {
      this.send(msg.id, {
        type: "file-error",
        id: this.deviceId,
        transferId: msg.transferId,
        reason: "file size rejected",
      });
      return;
    }

    mkdirSync(this.receiveDir, { recursive: true });
    const tempPath = join(this.receiveDir, `.partial-${msg.transferId}`);
    const stream = createWriteStream(tempPath);
    const peerName = this.peers.get(msg.id)?.name || msg.id.slice(0, 8);
    const totalChunks = Math.ceil(msg.size / FILE_CHUNK_BYTES) || 1;
    this.incoming.set(msg.transferId, {
      peerId: msg.id,
      peerName,
      name: msg.name,
      size: msg.size,
      mime: msg.mime,
      totalChunks,
      received: 0,
      nextIndex: 0,
      tempPath,
      stream,
    });
    this.transfers.set(msg.transferId, {
      transferId: msg.transferId,
      peerId: msg.id,
      peerName,
      direction: "in",
      fileName: msg.name,
      bytesDone: 0,
      bytesTotal: msg.size,
      status: "active",
    });
    this.onChange();
    this.send(msg.id, {
      type: "file-ack",
      id: this.deviceId,
      transferId: msg.transferId,
      index: -1,
    });
  }

  private async handleFileChunk(
    msg: Extract<WireMessage, { type: "file-chunk" }>,
  ): Promise<void> {
    const key = this.sessionKeys.get(msg.id);
    const inc = this.incoming.get(msg.transferId);
    if (!key || !inc) return;
    if (msg.index !== inc.nextIndex) {
      this.abortIncoming(msg.transferId, "out-of-order chunk");
      this.send(msg.id, {
        type: "file-error",
        id: this.deviceId,
        transferId: msg.transferId,
        reason: "out-of-order chunk",
      });
      return;
    }
    try {
      const plain = decryptBytes(msg.cipherB64, key);
      if (!inc.stream.write(plain)) {
        await new Promise<void>((resolve, reject) => {
          const onDrain = () => {
            inc.stream.off("error", onErr);
            resolve();
          };
          const onErr = (err: Error) => {
            inc.stream.off("drain", onDrain);
            reject(err);
          };
          inc.stream.once("drain", onDrain);
          inc.stream.once("error", onErr);
        });
      }
      inc.received += plain.length;
      inc.nextIndex += 1;
      const progress = this.transfers.get(msg.transferId);
      if (progress) {
        progress.bytesDone = Math.min(inc.received, inc.size);
        this.transfers.set(msg.transferId, { ...progress });
        this.onChange();
      }
      this.send(msg.id, {
        type: "file-ack",
        id: this.deviceId,
        transferId: msg.transferId,
        index: msg.index,
      });

      if (inc.nextIndex >= inc.totalChunks || inc.received >= inc.size) {
        await new Promise<void>((resolve, reject) => {
          inc.stream.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
        });
        const finalPath = this.uniqueReceivePath(inc.name);
        renameSync(inc.tempPath, finalPath);
        this.incoming.delete(msg.transferId);
        const done: TransferProgress = {
          transferId: msg.transferId,
          peerId: inc.peerId,
          peerName: inc.peerName,
          direction: "in",
          fileName: inc.name,
          bytesDone: inc.size,
          bytesTotal: inc.size,
          status: "done",
          savedPath: finalPath,
        };
        this.transfers.set(msg.transferId, done);
        this.onChange();
        this.onFileReceived({
          peerId: inc.peerId,
          peerName: inc.peerName,
          fileName: inc.name,
          filePath: finalPath,
          size: inc.size,
          mime: inc.mime,
        });
      }
    } catch (err) {
      const reason = String((err as Error)?.message || err);
      this.abortIncoming(msg.transferId, reason);
      try {
        this.send(msg.id, {
          type: "file-error",
          id: this.deviceId,
          transferId: msg.transferId,
          reason,
        });
      } catch {
        /* ignore */
      }
    }
  }
}

function existsSafe(path: string): boolean {
  return existsSync(path);
}

function guessMime(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".zip": "application/zip",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
  };
  return map[ext] || "application/octet-stream";
}

/** Pure helpers exported for smoke tests (no sockets). */
export const protocolTest = {
  deriveKeyFromPairingCode,
  encryptPayload,
  decryptPayload,
  encryptBytes,
  decryptBytes,
  generatePairingCode,
  localIpv4s,
  isTransientConnectError,
  MAX_FILE_BYTES,
  FILE_CHUNK_BYTES,
};
