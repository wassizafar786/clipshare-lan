/**
 * Serves dist/ui with a mocked clipshare bridge for agent-browser / Playwright.
 */
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..", "dist", "ui");
const port = Number(process.env.E2E_PORT || 4173);

const mock = `
window.clipshare = {
  _state: {
    deviceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    deviceName: "E2E Device",
    listenPort: 5555,
    deviceKind: "pc",
    localAddresses: ["192.168.1.10"],
    appVersion: "0.4.0",
    updateAvailable: true,
    updateVersion: "0.4.1",
    updateUrl: "https://github.com/wassizafar786/clipshare-lan/releases",
    updateStatus: "available",
    updateProgress: null,
    updateError: null,
    pairingCode: null,
    pairingActive: false,
    peers: [
      { id: "peer-1", name: "MacBook", host: "192.168.1.20", port: 5556, lastSeen: Date.now(), paired: false, connected: false, kind: "mac" },
      { id: "peer-2", name: "Office PC", host: "192.168.1.30", port: 5557, lastSeen: Date.now(), paired: true, connected: true, kind: "pc" },
      { id: "peer-3", name: "Pixel", host: "192.168.1.40", port: 5558, lastSeen: Date.now(), paired: false, connected: false, kind: "mobile" }
    ],
    lastClipPreview: null,
    syncEnabled: true,
    transfers: [
      { transferId: "t1", peerId: "peer-2", peerName: "Office PC", direction: "out", fileName: "shot.png", bytesDone: 512, bytesTotal: 1024, status: "active" }
    ],
    history: [
      { id: "h1", kind: "text", direction: "out", peerId: "peer-2", peerName: "Office PC", createdAt: Date.now() - 60000, text: "hello history" },
      { id: "h2", kind: "file", direction: "in", peerId: "peer-2", peerName: "Office PC", createdAt: Date.now() - 30000, fileName: "doc.pdf", filePath: "C:/tmp/doc.pdf", size: 2048 }
    ]
  },
  getState() { return Promise.resolve(structuredClone(this._state)); },
  beginPairing() {
    this._state.pairingActive = true;
    this._state.pairingCode = "482913";
    return Promise.resolve(this._state.pairingCode);
  },
  cancelPairing() {
    this._state.pairingActive = false;
    this._state.pairingCode = null;
    return Promise.resolve();
  },
  pairWith() { return Promise.resolve(); },
  setSync(on) { this._state.syncEnabled = on; return Promise.resolve(); },
  setName(n) { this._state.deviceName = n; return Promise.resolve(); },
  addManualPeer() { return Promise.resolve("manual"); },
  unpairPeer(id) {
    const p = this._state.peers.find((x) => x.id === id);
    if (p) { p.paired = false; p.connected = false; }
    return Promise.resolve();
  },
  checkUpdate() { return Promise.resolve({ updateAvailable: true, status: "available" }); },
  downloadUpdate() {
    this._state.updateStatus = "downloaded";
    this._state.updateProgress = 100;
    return Promise.resolve(this._state);
  },
  installUpdate() { window.__installUpdate = true; return Promise.resolve(); },
  openUpdate() { window.__openedUpdate = true; return Promise.resolve(); },
  pickFiles() { return Promise.resolve([]); },
  sendFiles() { return Promise.resolve([]); },
  listHistory() { return Promise.resolve(this._state.history); },
  deleteHistory(id) {
    this._state.history = this._state.history.filter((e) => e.id !== id);
    return Promise.resolve(true);
  },
  clearHistory() { this._state.history = []; return Promise.resolve(); },
  copyHistory() { return Promise.resolve(true); },
  openHistoryFile() { return Promise.resolve(true); },
  showHistoryFile() { return Promise.resolve(true); },
  openReceiveFolder() { return Promise.resolve(); },
  onState(cb) { this._cb = cb; return () => {}; }
};
`;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  if (url === "/mock-clipshare.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end(mock);
    return;
  }
  let path = url === "/" ? "/index.html" : url;
  const file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404);
    res.end("missing");
    return;
  }
  let body = readFileSync(file);
  if (path.endsWith(".html")) {
    let html = body.toString("utf8");
    html = html.replace(
      "<script src=\"app.js\"></script>",
      "<script src=\"/mock-clipshare.js\"></script><script src=\"app.js\"></script>",
    );
    body = Buffer.from(html);
  }
  res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
  res.end(body);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`e2e-harness http://127.0.0.1:${port}/`);
});
