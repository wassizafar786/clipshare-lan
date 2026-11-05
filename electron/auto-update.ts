import { app } from "electron";
import { autoUpdater, type UpdateInfo as EuUpdateInfo } from "electron-updater";
import { checkForUpdate, compareSemver } from "./update-check";

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
let releasePinned = false;

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

  autoUpdater.on("update-not-available", (info: EuUpdateInfo) => {
    const latest = String(info?.version || state.currentVersion || "").replace(/^v/i, "");
    setState({
      status: "idle",
      updateAvailable: false,
      latestVersion: latest || state.currentVersion,
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
    if (releasePinned && state.status !== "downloading") return;
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
  releasePinned = false;
  setState({ status: "checking", error: null, progress: null });
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = autoUpdater.checkForUpdates().catch((err) => {
    if (!finished) throw err;
  });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Update check timed out. Try again.")), 20_000);
  });
  try {
    await Promise.race([check, timeout]);
  } catch (err) {
    setState({
      status: "error",
      error: String((err as Error)?.message || err),
    });
  } finally {
    finished = true;
    if (timer) clearTimeout(timer);
  }
  await applyReleaseFallback();
  return getAutoUpdateState();
}

/** GitHub Releases is the result the button must show when the updater channel fails. */
async function applyReleaseFallback(): Promise<void> {
  if (state.status === "available" || state.status === "downloaded" || state.status === "downloading") {
    return;
  }
  const gh = await checkForUpdate(state.currentVersion);
  if (gh.updateAvailable && gh.latestVersion) {
    releasePinned = true;
    setState({
      status: "available",
      latestVersion: gh.latestVersion,
      updateAvailable: true,
      updateUrl: gh.releaseUrl || releasesPage(),
      error: null,
      progress: null,
    });
    return;
  }
  if (state.status === "error") return;
  const latest = gh.latestVersion || state.currentVersion;
  setState({
    status: "idle",
    latestVersion: latest,
    updateAvailable: false,
    error: null,
    progress: null,
  });
}

/** Download the available update (packaged only). */
export async function downloadAutoUpdate(): Promise<AutoUpdateState> {
  if (!app.isPackaged) {
    setState({ status: "dev", error: "Updates install only in the packaged app." });
    return getAutoUpdateState();
  }
  wireUpdater();
  releasePinned = false;
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
