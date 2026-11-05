import { app } from "electron";
import { autoUpdater, type UpdateInfo as EuUpdateInfo } from "electron-updater";
import { compareSemver } from "./update-check";

export type UpdateUiStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error"
  | "dev";

export interface AutoUpdateState {
  status: UpdateUiStatus;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  updateUrl: string | null;
  progress: number | null;
  error: string | null;
}

type Listener = () => void;

const DEFAULT_RELEASES = "https://github.com/wassizafar786/clipshare-lan/releases";

let listener: Listener | null = null;
let wired = false;

const state: AutoUpdateState = {
  status: "idle",
  currentVersion: "0.0.0",
  latestVersion: null,
  updateAvailable: false,
  updateUrl: DEFAULT_RELEASES,
  progress: null,
  error: null,
};

function emit(): void {
  listener?.();
}

function setState(partial: Partial<AutoUpdateState>): void {
  Object.assign(state, partial);
  emit();
}

export function getAutoUpdateState(): AutoUpdateState {
  return { ...state };
}

export function onAutoUpdateChange(cb: Listener): void {
  listener = cb;
}

function releasesPage(): string {
  return DEFAULT_RELEASES;
}

function wireUpdater(): void {
  if (wired) return;
  wired = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Unsigned GitHub builds — still allow update channel
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("checking-for-update", () => {
    setState({ status: "checking", error: null });
  });

  autoUpdater.on("update-available", (info: EuUpdateInfo) => {
    const latest = String(info.version || "").replace(/^v/i, "");
    setState({
      status: "available",
      latestVersion: latest,
      updateAvailable: compareSemver(latest, state.currentVersion) > 0,
      updateUrl: releasesPage(),
      error: null,
      progress: null,
    });
  });

  autoUpdater.on("update-not-available", () => {
    setState({
      status: "idle",
      updateAvailable: false,
      latestVersion: null,
      progress: null,
      error: null,
    });
  });

  autoUpdater.on("download-progress", (p) => {
    setState({
      status: "downloading",
      progress: Math.max(0, Math.min(100, Math.round(p.percent || 0))),
      error: null,
    });
  });

  autoUpdater.on("update-downloaded", (info: EuUpdateInfo) => {
    const latest = String(info.version || state.latestVersion || "").replace(/^v/i, "");
    setState({
      status: "downloaded",
      latestVersion: latest || state.latestVersion,
      updateAvailable: true,
      progress: 100,
      error: null,
    });
  });

  autoUpdater.on("error", (err) => {
    setState({
      status: "error",
      error: String(err?.message || err || "Update failed"),
      progress: null,
    });
  });
}

/** Start listening; safe to call once after app ready. */
export function initAutoUpdate(): void {
  state.currentVersion = app.getVersion();
  if (!app.isPackaged) {
    setState({ status: "dev", updateAvailable: false, error: null });
    return;
  }
  wireUpdater();
}

export async function checkAutoUpdate(): Promise<AutoUpdateState> {
  state.currentVersion = app.getVersion();
  if (!app.isPackaged) {
    setState({ status: "dev", updateAvailable: false });
    return getAutoUpdateState();
  }
  wireUpdater();
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setState({
      status: "error",
      error: String((err as Error)?.message || err),
    });
  }
  return getAutoUpdateState();
}

/** Download the available update (packaged only). */
export async function downloadAutoUpdate(): Promise<AutoUpdateState> {
  if (!app.isPackaged) {
    setState({ status: "dev", error: "Updates install only in the packaged app." });
    return getAutoUpdateState();
  }
  wireUpdater();
  try {
    setState({ status: "downloading", progress: 0, error: null });
    await autoUpdater.downloadUpdate();
  } catch (err) {
    setState({
      status: "error",
      error: String((err as Error)?.message || err),
      progress: null,
    });
  }
  return getAutoUpdateState();
}

/** Quit and install after download. */
export function quitAndInstallUpdate(): void {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall(false, true);
}
