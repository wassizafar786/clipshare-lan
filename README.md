# ClipShare LAN

Share clipboard **text** between **macOS** (menu bar) and **Windows** (system tray) on the **same Wi‑Fi**.

Inspired by ideas from [ClipPair](https://clippair.app/), [ClipNSync](https://clipnsync.com/), [DeskJoin](https://deskjoin.app/clipboard/copy-paste-between-windows-and-mac/), and [CopyBridge](https://github.com/flamesxxx/copybridge): tray-first, LAN-only, pairing codes, encrypted payloads, device list — no cloud account.

## Features (v0.1)

- Background tray / menu-bar app + small UI
- Radar-style LAN discovery + start-pairing flow
- UDP LAN discovery + TCP sync
- 6-digit pairing code → AES-256-GCM session key
- Connected / paired device list
- Desktop notifications when Wi‑Fi / LAN address changes or a paired device unpairs / goes offline
- In-app version label + update bar when a newer GitHub Release exists
- Echo protection
- Built with **aidlc-fast** workflow

## Run

```bash
npm install
npm start
```

Run the same app on a Mac and a Windows PC on the same Wi‑Fi:

1. On device A: **Start pairing** (code appears in the radar center)
2. On device B: tap A on the radar → **Enter code**
3. Copy text on one → paste on the other

Allow **local network / private network** firewall access when prompted. Allow **notifications** for ClipShare / Electron so unpair and network-change alerts can appear.

## Build & release (Mac + Windows)

Version comes from `package.json` (`version` field). Bump it before publishing.

```bash
# Windows installers / portable → release/
npm run dist:win

# macOS dmg + zip → release/  (run on a Mac)
npm run dist:mac

# Or helper (builds for this OS and prints git/gh steps)
npm run release:build
# npm run release:build -- --win
# npm run release:build -- --mac
```

Publish so clients can see the update bar:

1. Commit the version bump
2. `git tag v0.1.0` (match `package.json`)
3. `git push origin main --tags`
4. Create a [GitHub Release](https://github.com/wassizafar786/clipshare-lan/releases) for that tag and upload files from `release/`

The app checks `releases/latest` on launch (and every 6 hours). Override repo with `CLIPSHARE_UPDATE_REPO=owner/name`. Unsigned builds may trigger SmartScreen / Gatekeeper warnings.

If Windows packaging fails extracting `winCodeSign` (symlink privilege errors), enable Windows **Developer Mode**, or keep `signAndEditExecutable: false` in `package.json` (already set for unsigned local builds).

## Verify (headless)

```bash
npm test
# or
node scripts/smoke-protocol.mjs
node scripts/smoke-semver.mjs
```

## aidlc-fast

```bash
bun ../aidlc-fast/src/cli.ts status
```

## Out of scope (v1)

Images/files, cloud relay, mouse/keyboard sharing, silent auto-install / code signing.
