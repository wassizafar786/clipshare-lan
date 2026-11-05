import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  nativeTheme,
  shell,
  dialog,
  clipboard,
} from "electron";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { ClipMeshNetwork } from "./net";
import { HistoryStore } from "./history-store";
import { startClipboardWatch, writeClipboardText } from "./clipboard-watch";
import { notifyOnce, notifyPeerEvent } from "./notify";
import {
  checkAutoUpdate,
  downloadAutoUpdate,
  getAutoUpdateState,
  initAutoUpdate,
  onAutoUpdateChange,
  quitAndInstallUpdate,
} from "./auto-update";
import type { AppStateSnapshot, PeerInfo } from "./types";

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let net: ClipMeshNetwork | null = null;
let history: HistoryStore | null = null;
let stopWatch: (() => void) | null = null;
let netPollTimer: ReturnType<typeof setInterval> | null = null;
let updatePollTimer: ReturnType<typeof setInterval> | null = null;

/** Last known peer link state for transition notifications. */
const peerLink = new Map<string, { paired: boolean; connected: boolean; name: string }>();
let lastLanKey = "";
let notifyReady = false;

const storePath = () => join(app.getPath("userData"), "device.json");

function loadOrCreateDevice(): { id: string; name: string } {
  try {
    const raw = readFileSync(storePath(), "utf8");
    return JSON.parse(raw) as { id: string; name: string };
  } catch {
    const data = {
      id: randomUUID(),
      name: hostname() || "ClipShare device",
    };
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(storePath(), JSON.stringify(data, null, 2));
    return data;
  }
}

function saveDevice(data: { id: string; name: string }): void {
  writeFileSync(storePath(), JSON.stringify(data, null, 2));
}

function pushState(): void {
  if (!net) return;
  const snap = enrichSnapshot(net.snapshot());
  watchTransitions(snap);
  win?.webContents.send("state", snap);
}

function enrichSnapshot(s: AppStateSnapshot): AppStateSnapshot {
  const u = getAutoUpdateState();
  return {
    ...s,
    appVersion: u.currentVersion || app.getVersion(),
    updateAvailable: u.updateAvailable || u.status === "downloaded" || u.status === "available",
    updateVersion: u.latestVersion,
    updateUrl: u.updateUrl,
    updateStatus: u.status,
    updateProgress: u.progress,
    updateError: u.error,
    history: history?.list() ?? [],
  };
}

function receiveDir(): string {
  return join(app.getPath("downloads"), "ClipShare");
}

async function refreshUpdateInfo(): Promise<void> {
  await checkAutoUpdate();
  pushState();
}

function lanKey(addresses: string[]): string {
  return addresses.slice().sort().join(",");
}

function watchTransitions(snap: AppStateSnapshot): void {
  const nextLan = lanKey(snap.localAddresses);
  if (notifyReady && lastLanKey && nextLan !== lastLanKey) {
    notifyOnce(
      `lan:${lastLanKey}->${nextLan}`,
      "ClipShare · Network changed",
      nextLan
        ? `Now on ${snap.localAddresses.join(", ")}`
        : "No active LAN address — reconnect to Wi‑Fi",
    );
  }
  lastLanKey = nextLan;

  const seen = new Set<string>();
  for (const peer of snap.peers) {
    seen.add(peer.id);
    maybeNotifyPeer(peer);
  }
  // Peers removed from the map (unpaired “seen” only) — no unpaired toast
  for (const [id, prev] of peerLink) {
    if (seen.has(id)) continue;
    if (prev.paired && prev.connected) {
      notifyPeerEvent(
        id,
        "offline",
        "ClipShare · Device offline",
        `${prev.name} went offline`,
      );
    }
    peerLink.delete(id);
  }
}

function maybeNotifyPeer(peer: PeerInfo): void {
  const prev = peerLink.get(peer.id);
  peerLink.set(peer.id, {
    paired: peer.paired,
    connected: peer.connected,
    name: peer.name,
  });
  if (!notifyReady || !prev) return;

  if (!prev.paired && peer.paired) {
    notifyPeerEvent(
      peer.id,
      "paired",
      "ClipShare · Device paired",
      `${peer.name} is paired`,
    );
    return;
  }
  if (prev.paired && !peer.paired) {
    notifyPeerEvent(
      peer.id,
      "unpaired",
      "ClipShare · Device unpaired",
      `${peer.name} was unpaired`,
    );
    return;
  }
  if (prev.paired && peer.paired && prev.connected && !peer.connected) {
    notifyPeerEvent(
      peer.id,
      "offline",
      "ClipShare · Device offline",
      `${peer.name} went offline`,
    );
    return;
  }
  if (prev.paired && peer.paired && !prev.connected && peer.connected) {
    notifyPeerEvent(
      peer.id,
      "reconnected",
      "ClipShare · Device reconnected",
      `${peer.name} is back online`,
    );
  }
}

function appIcon(): Electron.NativeImage {
  return nativeImage.createFromPath(join(__dirname, "assets", "icon.png"));
}

function showMainWindow(): void {
  if (process.platform === "darwin") {
    const icon = appIcon();
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
  }
  win?.show();
  win?.focus();
}

function createWindow(): void {
  const icon = appIcon();
  win = new BrowserWindow({
    width: 420,
    height: 720,
    minWidth: 360,
    minHeight: 480,
    show: false,
    resizable: true,
    autoHideMenuBar: true,
    title: "ClipShare LAN",
    icon: icon.isEmpty() ? undefined : icon,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, "ui", "index.html"));
  win.on("close", (e) => {
    // Keep running in tray
    e.preventDefault();
    win?.hide();
  });
}

function trayIcon(): Electron.NativeImage {
  const assets = join(__dirname, "assets");
  if (process.platform === "darwin") {
    const template = nativeImage.createFromPath(join(assets, "tray-template.png"));
    template.setTemplateImage(true);
    return template.isEmpty()
      ? nativeImage.createFromPath(join(assets, "tray-icon.png"))
      : template;
  }
  // Windows needs an opaque colored icon (template/transparent glyphs vanish in the tray)
  const icon = nativeImage.createFromPath(join(assets, "tray-icon.png"));
  if (!icon.isEmpty()) return icon;
  // Last-resort visible square so the tray entry never disappears
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGD4z0AEYBxVSFGAuQEjI8MoGEA1gJGRgfE/MgCqYBRDDGQcVQMRAwMAnG4EBZ7nY4YAAAAASUVORK5CYII=",
    "base64",
  );
  return nativeImage.createFromBuffer(png);
}

function buildTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip("ClipShare LAN");
  if (process.platform === "win32") {
    // Ensure the icon stays visible even when Windows collapses overflow
    tray.setIgnoreDoubleClickEvents(true);
  }
  const context = Menu.buildFromTemplate([
    {
      label: "Open ClipShare",
      click: () => {
        showMainWindow();
      },
    },
    {
      label: "Start pairing",
      click: () => {
        net?.beginPairing();
        showMainWindow();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        win?.destroy();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(context);
  tray.on("click", () => {
    // Windows: left-click opens UI
    if (process.platform === "win32") {
      showMainWindow();
    }
  });
  // macOS: prefer menu-bar status item behavior (tray near clock area via system tray)
}

function wireIpc(): void {
  ipcMain.handle("state:get", () => (net ? enrichSnapshot(net.snapshot()) : null));
  ipcMain.handle("pair:begin", () => net?.beginPairing() ?? "");
  ipcMain.handle("pair:cancel", () => net?.cancelPairing());
  ipcMain.handle("pair:with", async (_e, peerId: string, code: string) => {
    await net?.pairWithCode(peerId, code);
  });
  ipcMain.handle("sync:set", (_e, on: boolean) => net?.setSyncEnabled(on));
  ipcMain.handle("name:set", (_e, name: string) => {
    if (!net) return;
    net.deviceName = name;
    const d = loadOrCreateDevice();
    d.name = name;
    saveDevice(d);
    pushState();
  });
  ipcMain.handle(
    "peer:manual",
    (_e, host: string, port: number, name?: string) =>
      net?.addManualPeer(host, port, name) ?? "",
  );
  ipcMain.handle("peer:unpair", (_e, peerId: string) => net?.unpairPeer(peerId));
  ipcMain.handle("update:check", async () => {
    await refreshUpdateInfo();
    return getAutoUpdateState();
  });
  ipcMain.handle("update:download", async () => {
    await downloadAutoUpdate();
    pushState();
    return getAutoUpdateState();
  });
  ipcMain.handle("update:install", () => {
    quitAndInstallUpdate();
  });
  ipcMain.handle("update:open", async () => {
    const url = getAutoUpdateState().updateUrl;
    if (url) await shell.openExternal(url);
  });

  ipcMain.handle("files:pick", async () => {
    const opts: Electron.OpenDialogOptions = {
      properties: ["openFile", "multiSelections"],
      title: "Send with ClipShare",
    };
    const res = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (res.canceled) return [] as string[];
    return res.filePaths;
  });

  ipcMain.handle("files:send", async (_e, peerId: string, filePaths: string[]) => {
    if (!net) throw new Error("Network not ready");
    const results = [];
    for (const filePath of filePaths) {
      const st = statSync(filePath);
      const progress = await net.sendFile(peerId, filePath, {
        size: st.size,
        fileName: basename(filePath),
      });
      const peer = net.snapshot().peers.find((p) => p.id === peerId);
      history?.add({
        kind: "file",
        direction: "out",
        peerId,
        peerName: peer?.name || peerId.slice(0, 8),
        fileName: basename(filePath),
        filePath,
        size: st.size,
      });
      results.push(progress);
      pushState();
    }
    return results;
  });

  ipcMain.handle("history:list", () => history?.list() ?? []);
  ipcMain.handle("history:delete", (_e, id: string) => {
    const ok = history?.delete(id) ?? false;
    pushState();
    return ok;
  });
  ipcMain.handle("history:clear", () => {
    history?.clear();
    pushState();
  });
  ipcMain.handle("history:copy", (_e, id: string) => {
    const entry = history?.get(id);
    if (!entry?.text) return false;
    clipboard.writeText(entry.text);
    return true;
  });
  ipcMain.handle("history:open", async (_e, id: string) => {
    const entry = history?.get(id);
    if (!entry?.filePath) return false;
    const err = await shell.openPath(entry.filePath);
    return !err;
  });
  ipcMain.handle("history:show", (_e, id: string) => {
    const entry = history?.get(id);
    if (!entry?.filePath) return false;
    shell.showItemInFolder(entry.filePath);
    return true;
  });
  ipcMain.handle("history:openReceiveFolder", async () => {
    mkdirSync(receiveDir(), { recursive: true });
    await shell.openPath(receiveDir());
  });
}

app.whenReady().then(async () => {
  const icon = appIcon();
  if (process.platform === "darwin") {
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
    app.dock?.hide();
  }
  nativeTheme.themeSource = "system";

  const device = loadOrCreateDevice();
  history = new HistoryStore(join(app.getPath("userData"), "history.json"));
  mkdirSync(receiveDir(), { recursive: true });
  net = new ClipMeshNetwork({
    deviceId: device.id,
    deviceName: device.name,
    receiveDir: receiveDir(),
    onClip: (text, fromPeer) => {
      writeClipboardText(text);
      net?.markLocalClipboard(text);
      const peer = net?.snapshot().peers.find((p) => p.id === fromPeer);
      history?.add({
        kind: "text",
        direction: "in",
        peerId: fromPeer,
        peerName: peer?.name || fromPeer.slice(0, 8),
        text,
      });
      pushState();
    },
    onFileReceived: (info) => {
      history?.add({
        kind: "file",
        direction: "in",
        peerId: info.peerId,
        peerName: info.peerName,
        fileName: info.fileName,
        filePath: info.filePath,
        size: info.size,
        mime: info.mime,
      });
      notifyOnce(
        `file:${info.filePath}`,
        "ClipShare · File received",
        `${info.fileName} from ${info.peerName}`,
      );
      pushState();
    },
    onChange: () => pushState(),
  });
  await net.start();

  // Seed link/LAN state before enabling notifications (avoid startup spam)
  const seed = net.snapshot();
  lastLanKey = lanKey(seed.localAddresses);
  for (const peer of seed.peers) {
    peerLink.set(peer.id, {
      paired: peer.paired,
      connected: peer.connected,
      name: peer.name,
    });
  }
  notifyReady = true;

  initAutoUpdate();
  onAutoUpdateChange(() => pushState());

  createWindow();
  buildTray();
  wireIpc();

  // Poll LAN identity even when peer map is quiet
  netPollTimer = setInterval(() => {
    if (!net) return;
    watchTransitions(net.snapshot());
  }, 5000);

  void refreshUpdateInfo();
  updatePollTimer = setInterval(() => {
    void refreshUpdateInfo();
  }, 6 * 60 * 60 * 1000);

  stopWatch = startClipboardWatch(
    (text) => {
      void net?.broadcastClipboard(text).then(() => {
        const peers = net?.snapshot().peers.filter((p) => p.paired) ?? [];
        if (!peers.length) return;
        history?.add({
          kind: "text",
          direction: "out",
          peerId: peers.map((p) => p.id).join(","),
          peerName: peers.map((p) => p.name).join(", "),
          text,
        });
        pushState();
      });
    },
    {
      shouldSkip: () => !net || net.isSuppressingEcho(),
    },
  );
});

app.on("before-quit", () => {
  if (netPollTimer) clearInterval(netPollTimer);
  if (updatePollTimer) clearInterval(updatePollTimer);
  stopWatch?.();
  net?.stop();
});

app.on("window-all-closed", () => {
  // Stay alive in the tray / menu bar
});
