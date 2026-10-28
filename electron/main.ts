import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  nativeTheme,
} from "electron";
import { hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ClipMeshNetwork } from "./net";
import { startClipboardWatch, writeClipboardText } from "./clipboard-watch";
import type { AppStateSnapshot } from "./types";

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let net: ClipMeshNetwork | null = null;
let stopWatch: (() => void) | null = null;

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
  win?.webContents.send("state", snap);
}

function enrichSnapshot(s: AppStateSnapshot): AppStateSnapshot {
  return s;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 380,
    height: 520,
    show: false,
    resizable: true,
    title: "ClipShare LAN",
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
        win?.show();
        win?.focus();
      },
    },
    {
      label: "Start pairing",
      click: () => {
        net?.beginPairing();
        win?.show();
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
      win?.show();
      win?.focus();
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
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    app.dock?.hide();
  }
  nativeTheme.themeSource = "system";

  const device = loadOrCreateDevice();
  net = new ClipMeshNetwork({
    deviceId: device.id,
    deviceName: device.name,
    onClip: (text) => {
      writeClipboardText(text);
      net?.markLocalClipboard(text);
    },
    onChange: () => pushState(),
  });
  await net.start();

  createWindow();
  buildTray();
  wireIpc();

  stopWatch = startClipboardWatch(
    (text) => {
      void net?.broadcastClipboard(text);
    },
    {
      shouldSkip: () => !net || net.isSuppressingEcho(),
    },
  );
});

app.on("before-quit", () => {
  stopWatch?.();
  net?.stop();
});

app.on("window-all-closed", () => {
  // Stay alive in the tray / menu bar
});
