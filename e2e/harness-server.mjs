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
    pairingCode: null,
    pairingActive: false,
    peers: [
      { id: "peer-1", name: "MacBook", host: "192.168.1.20", port: 5556, lastSeen: Date.now(), paired: false, connected: false, kind: "mac" },
      { id: "peer-2", name: "Office PC", host: "192.168.1.30", port: 5557, lastSeen: Date.now(), paired: true, connected: true, kind: "pc" },
      { id: "peer-3", name: "Pixel", host: "192.168.1.40", port: 5558, lastSeen: Date.now(), paired: false, connected: false, kind: "mobile" }
    ],
    lastClipPreview: null,
    syncEnabled: true
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
