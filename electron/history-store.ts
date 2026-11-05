import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { HistoryEntry } from "./types";

const MAX_ENTRIES = 200;
const MAX_TEXT_CHARS = 8_000;

export class HistoryStore {
  private entries: HistoryEntry[] = [];
  private path: string;

  constructor(filePath: string) {
    this.path = filePath;
    this.load();
  }

  list(): HistoryEntry[] {
    return this.entries.slice();
  }

  add(partial: Omit<HistoryEntry, "id" | "createdAt"> & { createdAt?: number }): HistoryEntry {
    const entry: HistoryEntry = {
      id: randomUUID(),
      createdAt: partial.createdAt ?? Date.now(),
      kind: partial.kind,
      direction: partial.direction,
      peerId: partial.peerId,
      peerName: partial.peerName,
      text:
        partial.text != null
          ? partial.text.slice(0, MAX_TEXT_CHARS)
          : undefined,
      fileName: partial.fileName,
      filePath: partial.filePath,
      size: partial.size,
      mime: partial.mime,
    };
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(0, MAX_ENTRIES);
    }
    this.save();
    return entry;
  }

  delete(id: string): boolean {
    const next = this.entries.filter((e) => e.id !== id);
    if (next.length === this.entries.length) return false;
    this.entries = next;
    this.save();
    return true;
  }

  clear(): void {
    this.entries = [];
    this.save();
  }

  get(id: string): HistoryEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  private load(): void {
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as { entries?: HistoryEntry[] };
      this.entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      JSON.stringify({ version: 1, entries: this.entries }, null, 2),
      "utf8",
    );
  }
}

export const historyLimits = { MAX_ENTRIES, MAX_TEXT_CHARS };
