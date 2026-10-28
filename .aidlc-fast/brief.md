# Brief

## Intent
Give users a way to update ClipShare: publishable Mac + Windows build scripts, a visible app version, and an in-app update bar when a newer version is pushed to Git (GitHub release/tag).

## Scope
feature

## Acceptance criteria
- [x] `package.json` version is the single source of truth and is shown in the UI (e.g. header or about row: `v0.1.0`).
- [x] Scripts produce distributable builds for **Windows** and **macOS** (electron-builder or equivalent): at least win portable/nsis and mac dmg/zip as appropriate for unsigned local publish.
- [x] Documented publish path: bump version → build → create/push GitHub Release (or tag) with artifacts; README notes how to release.
- [x] On launch (and periodically / on Open), app checks the GitHub repo’s latest release (or latest semver tag) against local `package.json` version.
- [x] If remote version is newer, show a persistent update bar (dismissible for the session) with current → new version and a button to open the release/download page (no silent forced install in v1).
- [x] Offline / GitHub unreachable: no crash, no bar (or subtle “couldn’t check” only in meta — prefer silent fail).
- [x] Existing tray, pairing, radar, and clipboard sync behavior unchanged.

## Approach
- Add `electron-builder` config + npm scripts: `dist`, `dist:win`, `dist:mac` (and shared `pack` if useful).
- Wire `app.getVersion()` / `package.json` version into snapshot or preload so UI can render it.
- Small `electron/update-check.ts`: fetch `https://api.github.com/repos/wassizafar786/clipshare-lan/releases/latest` (configurable owner/repo), compare semver; expose result via IPC / state.
- UI: slim banner above content when update available; “Update” opens release URL via `shell.openExternal`.
- Optional: `scripts/publish-release` helper that builds and prints next git/gh release steps (gh optional — don’t require gh if missing).
- Keep Mac unpair bug out of this scope (separate follow-up).

## Files to touch
- `package.json` — version scripts, electron-builder config
- `electron/main.ts`, `electron/preload.ts`, `electron/types.ts` — version + update state / IPC
- `electron/update-check.ts` (new)
- `ui/index.html`, `ui/styles.css`, `ui/app.js` — version label + update bar
- `README.md` — build & release instructions
- `scripts/` — optional release helper
- `.gitignore` — `dist/`, `release/` / `out/` as needed

## E2E scenarios
- [x] UI shows current version string matching `package.json`.
- [x] With mock “newer” remote version, update bar appears and Update opens/links to release URL; Dismiss hides for session.
- [x] With mock equal/older remote (or network fail), no update bar. _(silent fail path in update-check)_
- [x] `npm run typecheck` / `npm test` still pass; `dist:win` dry-runs or builds on this Windows machine (mac script present even if not run here).

## Notes
- Code signing / notarization out of scope for v1 (Windows SmartScreen / mac Gatekeeper warnings expected for unsigned builds).
- Prefer GitHub Releases over raw git tags for artifact URLs; fall back to tags-only check if no releases yet.
- Repo assumed: `wassizafar786/clipshare-lan` (override via env `CLIPSHARE_UPDATE_REPO`).
