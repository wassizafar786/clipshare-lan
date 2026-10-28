export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  checkedAt: number | null;
}

const DEFAULT_REPO = "wassizafar786/clipshare-lan";

function updateRepo(): string {
  return (process.env.CLIPSHARE_UPDATE_REPO || DEFAULT_REPO).trim();
}

/** Strip leading v and compare a.b.c numerically. Returns 1 if a>b, -1 if a<b, 0 if equal. */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function normalizeTag(tag: string): string {
  return tag.replace(/^v/i, "").trim();
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ClipShare-LAN-UpdateCheck",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * Check GitHub latest release; if none, fall back to latest semver tag.
 * Failures return updateAvailable: false (silent).
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo> {
  const repo = updateRepo();
  const base: UpdateInfo = {
    currentVersion: normalizeTag(currentVersion),
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: `https://github.com/${repo}/releases`,
    checkedAt: Date.now(),
  };

  const release = (await fetchJson(
    `https://api.github.com/repos/${repo}/releases/latest`,
  )) as { tag_name?: string; html_url?: string } | null;

  let latest: string | null = null;
  let url: string | null = base.releaseUrl;

  if (release?.tag_name) {
    latest = normalizeTag(release.tag_name);
    url = release.html_url || url;
  } else {
    const tags = (await fetchJson(
      `https://api.github.com/repos/${repo}/tags?per_page=20`,
    )) as { name?: string }[] | null;
    if (Array.isArray(tags)) {
      for (const t of tags) {
        if (!t?.name) continue;
        const v = normalizeTag(t.name);
        if (!/^\d+\.\d+/.test(v)) continue;
        if (!latest || compareSemver(v, latest) > 0) latest = v;
      }
      if (latest) url = `https://github.com/${repo}/releases/tag/v${latest}`;
    }
  }

  if (!latest) return base;

  return {
    ...base,
    latestVersion: latest,
    releaseUrl: url,
    updateAvailable: compareSemver(latest, base.currentVersion) > 0,
  };
}
