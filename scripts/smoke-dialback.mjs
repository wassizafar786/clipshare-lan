/**
 * Mac cannot dial Windows, but Windows can dial the Mac.
 * Pairing must still finish when outbound TCP is blocked.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const built = spawnSync("npx", ["tsc", "-p", "tsconfig.json"], {
  cwd: root,
  stdio: "inherit",
});
if (built.status !== 0) process.exit(built.status ?? 1);

const require = createRequire(import.meta.url);
const { ClipMeshNetwork } = require("../dist/net.js");

const unreachable = Object.assign(new Error("connect EHOSTUNREACH"), {
  code: "EHOSTUNREACH",
});
const original = ClipMeshNetwork.prototype.connectOnce;
ClipMeshNetwork.prototype.connectOnce = function (peer) {
  if (this.deviceName === "mac") return Promise.reject(unreachable);
  return original.call(this, peer);
};

function mesh(name) {
  return new ClipMeshNetwork({
    deviceId: name,
    deviceName: name,
    receiveDir: mkdtempSync(join(tmpdir(), `clipshare-${name}-`)),
    onClip() {},
    onFileReceived() {},
    onChange() {},
  });
}

function waitFor(fn, ms = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (fn()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > ms) {
        clearInterval(timer);
        reject(new Error("timed out"));
      }
    }, 50);
  });
}

const mac = mesh("mac");
const win = mesh("win");

try {
  await mac.start();
  await win.start();
  await waitFor(
    () =>
      mac.snapshot().peers.some((p) => p.id === "win") &&
      win.snapshot().peers.some((p) => p.id === "mac"),
  );
  const code = win.beginPairing();
  await mac.pairWithCode("win", code);
  await waitFor(() => {
    const onWin = win.snapshot().peers.find((p) => p.id === "mac");
    const onMac = mac.snapshot().peers.find((p) => p.id === "win");
    return Boolean(onWin?.paired && onWin.connected && onMac?.connected);
  });
  console.log("smoke-dialback: OK");
} finally {
  mac.stop();
  win.stop();
}
