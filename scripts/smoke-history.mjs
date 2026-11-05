/**
 * History store prune / CRUD smoke (no Electron).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_ENTRIES = 200;
const dir = mkdtempSync(join(tmpdir(), "clipshare-hist-"));
const path = join(dir, "history.json");

class HistoryStore {
  constructor(filePath) {
    this.path = filePath;
    this.entries = [];
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw);
      this.entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
      this.entries = [];
    }
  }
  add(partial) {
    const entry = { id: randomUUID(), createdAt: Date.now(), ...partial };
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(0, MAX_ENTRIES);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({ version: 1, entries: this.entries }));
    return entry;
  }
  delete(id) {
    const n = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    writeFileSync(this.path, JSON.stringify({ version: 1, entries: this.entries }));
    return this.entries.length !== n;
  }
  clear() {
    this.entries = [];
    writeFileSync(this.path, JSON.stringify({ version: 1, entries: [] }));
  }
  list() {
    return this.entries.slice();
  }
}

const store = new HistoryStore(path);
const a = store.add({ kind: "text", direction: "out", peerId: "p1", peerName: "A", text: "hi" });
store.add({ kind: "file", direction: "in", peerId: "p2", peerName: "B", fileName: "x.png", size: 10 });
assert.equal(store.list().length, 2);
assert.equal(store.delete(a.id), true);
assert.equal(store.list().length, 1);
store.clear();
assert.equal(store.list().length, 0);

for (let i = 0; i < 210; i++) {
  store.add({ kind: "text", direction: "in", peerId: "p", peerName: "P", text: String(i) });
}
assert.equal(store.list().length, MAX_ENTRIES);

rmSync(dir, { recursive: true, force: true });
console.log("smoke-history: OK");
console.log("  CRUD + prune to max entries");
