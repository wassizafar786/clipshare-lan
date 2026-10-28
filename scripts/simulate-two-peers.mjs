/**
 * Simulation: two in-process peers discover + pair + exchange clipboard ciphertext.
 * This is the test that should have been run before claiming e2e.
 */
import { createServer } from "node:net";
import { createSocket } from "node:dgram";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import assert from "node:assert/strict";

const DISCOVERY = 41235; // dedicated sim port so it doesn't fight a running app

function derive(code, salt) {
  return scryptSync(String(code), salt, 32);
}
function enc(plain, key) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const e = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), e]).toString("base64");
}
function dec(b64, key) {
  const buf = Buffer.from(b64, "base64");
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

function listenTcp() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function main() {
  const a = await listenTcp();
  const b = await listenTcp();
  const code = "582041";
  const salt = randomBytes(16);
  const key = derive(code, salt);

  // A waits for pair-confirm
  const paired = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("pair timeout")), 5000);
    a.server.once("connection", (socket) => {
      let buf = "";
      socket.on("data", (chunk) => {
        buf += chunk;
        if (!buf.includes("\n")) return;
        const msg = JSON.parse(buf.split("\n")[0]);
        assert.equal(msg.type, "pair-confirm");
        assert.equal(msg.code, code);
        const k = derive(msg.code, Buffer.from(msg.saltB64, "base64"));
        assert.deepEqual(k, key);
        socket.write(
          JSON.stringify({ type: "pair-ok", id: "A", name: "PeerA" }) + "\n",
        );
        // B sends clip
      });
      socket.on("data", (chunk) => {
        buf += chunk.toString();
        for (const line of buf.split("\n")) {
          if (!line.trim()) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.type === "clip") {
            const text = dec(msg.cipherB64, key);
            assert.equal(text, "copied on B — paste on A");
            clearTimeout(t);
            resolve(text);
          }
        }
      });
    });
  });

  // B connects + pairs + sends clip
  const { createConnection } = await import("node:net");
  await new Promise((resolve, reject) => {
    const s = createConnection({ host: "127.0.0.1", port: a.port }, () => {
      s.write(
        JSON.stringify({
          type: "pair-confirm",
          id: "B",
          name: "PeerB",
          code,
          saltB64: salt.toString("base64"),
        }) + "\n",
      );
      setTimeout(() => {
        s.write(
          JSON.stringify({
            type: "clip",
            id: "B",
            cipherB64: enc("copied on B — paste on A", key),
            seq: 1,
          }) + "\n",
        );
        resolve();
      }, 100);
    });
    s.on("error", reject);
  });

  // UDP hello visibility (sim discovery)
  await new Promise((resolve, reject) => {
    const u = createSocket({ type: "udp4", reuseAddr: true });
    const t = setTimeout(() => reject(new Error("udp timeout")), 3000);
    u.on("message", (msg) => {
      const m = JSON.parse(msg.toString());
      if (m.type === "hello" && m.id === "sim-A") {
        clearTimeout(t);
        u.close();
        resolve();
      }
    });
    u.bind(DISCOVERY, () => {
      const sender = createSocket("udp4");
      sender.bind(() => {
        sender.setBroadcast(true);
        sender.send(
          JSON.stringify({
            type: "hello",
            id: "sim-A",
            name: "PeerA",
            port: a.port,
          }),
          DISCOVERY,
          "127.0.0.1",
          () => sender.close(),
        );
      });
    });
  });

  const text = await paired;
  a.server.close();
  b.server.close();
  console.log("simulate-two-peers: OK");
  console.log("  discovery hello received");
  console.log("  pairing code accepted");
  console.log(`  clipboard delivered: "${text}"`);
}

main().catch((e) => {
  console.error("simulate-two-peers: FAIL", e);
  process.exit(1);
});
