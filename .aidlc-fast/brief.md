# Brief

## Intent
Fix post-install discovery and pairing UX, prune stale peers when a machine quits, add AsolutionsZ “powered by” branding, and ship a new version whose update bar downloads the correct Mac/Windows installer.

## Scope
bugfix

## Acceptance criteria
- [x] Packaged Mac + Windows apps discover each other on the same LAN more reliably (multi-homed broadcast / per-interface hello; document firewall for UDP `41234` + TCP listen port).
- [x] Manual pairing is obvious again: always-visible section to enter **pairing code** (and host:port fallback), not buried only in collapsed `<details>`.
- [x] Peers that stop advertising (app quit / offline) disappear from radar/list after a short stale timeout (and paired peers show offline then clear if gone).
- [x] UI shows company mark **AsolutionsZ** with “Powered by” (logo asset vendored in repo; LinkedIn URL used only to fetch once at build/dev time if needed).
- [x] Bump app version (e.g. `0.1.1` or `0.2.0`); update check offers platform-specific download from GitHub Release assets (Win `.exe` / Mac `.dmg|.zip`) via Update button — not only the release page when an asset URL is known.
- [x] Rebuild/publish path documented so both machines can install the new version and see the update bar from `0.1.0`.

## Approach
1. **Discovery:** Send UDP hello to `255.255.255.255` and each interface broadcast address; optionally bind/receive more robustly; surface listen port + “waiting for peers” + firewall hint in UI. Consider Windows firewall rule note in README/installer.
2. **Stale peers:** Track `lastSeen` from hellos; prune unpaired peers after ~10–15s without hello; mark paired as offline then remove blip or keep offline badge; on socket close already mark disconnected.
3. **Manual pin UX:** Promote “Enter code to pair” + peer picker or code+host fields above the fold; keep host:port as secondary but visible (not only nested details).
4. **Branding:** Add `assets/asolutionsz-logo.png` + footer “Powered by AsolutionsZ”; tray/window icon can stay ClipShare or use logo if suitable size.
5. **Updates:** Parse release asset list in `update-check.ts`; pick asset by `process.platform` / arch; `shell.openExternal(assetUrl)` (or download to Downloads). Bump `package.json` version for the next GitHub Release.

## Files to touch
- `electron/net.ts` — broadcast per NIC; peer TTL prune
- `electron/update-check.ts`, `electron/main.ts` — asset URL selection
- `ui/index.html`, `ui/styles.css`, `ui/app.js` — manual pair UX, branding, hints
- `assets/` — AsolutionsZ logo (+ copy via build)
- `package.json` — version bump
- `README.md` — firewall + release/update notes
- `scripts/copy-ui.mjs` — copy branding assets if needed

## E2E scenarios
- [x] Two instances (or harness + simulated peers) show on radar; stop one → disappears within stale window. _(prune + multi-broadcast implemented; live LAN confirm on install)_
- [x] Manual enter-code / host:port controls visible without expanding obscure details.
- [x] Footer shows Powered by AsolutionsZ + logo.
- [x] Update info with mocked newer release exposes platform download URL; Update opens/downloads it.
- [x] `npm test` / typecheck pass; `dist:win` builds new version (`0.2.0`).

## Notes
- LinkedIn CDN logo URL may expire — vendor a local PNG under `assets/`.
- True silent in-app installer replace is out of scope; “download update” = open correct release asset.
- Mac artifact still built on Mac; Windows on Windows; both attached to the new GitHub Release tag.
